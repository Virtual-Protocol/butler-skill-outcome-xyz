// Contract tests for dev/local-signer.mjs. No network: the agent key comes from a
// throwaway key generated here, and the real dev vault and key files are never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const req = createRequire(new URL("package.json", root));
const { generatePrivateKey, privateKeyToAccount } = await import(pathToFileURL(req.resolve("viem/accounts")).href);
const { recoverTypedDataAddress } = await import(pathToFileURL(req.resolve("viem")).href);

const throwaway = generatePrivateKey();
const MAIN = privateKeyToAccount(generatePrivateKey()).address;
process.env.OUTCOME_MAIN_WALLET = MAIN;
delete process.env.DEV_MAIN_PRIVATE_KEY;
delete process.env.OUTCOME_AGENT_PRIVATE_KEY;
const { mkdtempSync, statSync, readFileSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const tmp = mkdtempSync(join(tmpdir(), "local-signer-"));
process.env.DEV_SIGNER_LEDGER = join(tmp, "ledger.json");
const VAULT = join(tmp, "vault.json");
const KEY_FILE = join(tmp, "agent-key.json");
process.env.DEV_SIGNER_VAULT = VAULT;
process.env.DEV_SIGNER_KEY_FILE = KEY_FILE;

const signer = await import(fileURLToPath(new URL("dev/local-signer.mjs", root)));
const accounts = { generatePrivateKey, privateKeyToAccount };
const common = await import(fileURLToPath(new URL("scripts/lib/common.mjs", root)));

async function withWallet(fn, { agentEnv = undefined } = {}) {
  const address = privateKeyToAccount(generatePrivateKey()).address;
  const prevWallet = process.env.OUTCOME_MAIN_WALLET;
  const prevEnv = process.env.OUTCOME_AGENT_PRIVATE_KEY;
  process.env.OUTCOME_MAIN_WALLET = address;
  if (agentEnv === undefined) delete process.env.OUTCOME_AGENT_PRIVATE_KEY;
  else process.env.OUTCOME_AGENT_PRIVATE_KEY = agentEnv;
  try {
    await fn(address, `outcome.${address.toLowerCase()}`);
  } finally {
    process.env.OUTCOME_MAIN_WALLET = prevWallet;
    if (prevEnv === undefined) delete process.env.OUTCOME_AGENT_PRIVATE_KEY;
    else process.env.OUTCOME_AGENT_PRIVATE_KEY = prevEnv;
  }
}

const storedItem = (name) => JSON.parse(readFileSync(VAULT, "utf8")).items[name];

const TD = {
  domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" },
  types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
  message: { source: "a", connectionId: "0x" + "ab".repeat(32) },
};

test("contract surface", async () => {
  assert.equal(signer.isDev, true);
  const main = await signer.mainSigner({ idempotencyKey: "t" });
  assert.equal(main.address, MAIN);
  assert.equal(typeof main.signTypedData, "function");
  assert.equal(typeof main.sendTransaction, "function");
});

test("session wallet: no flag needed, scope main, constant exported", async () => {
  assert.equal(signer.SESSION_WALLET_DEFAULT, true);
  const main = await signer.mainSigner({ signByDutyWallet: undefined, idempotencyKey: "scope" });
  assert.equal(main.walletScope, "main");
  assert.equal(main.address, MAIN);
  const bare = await signer.mainSigner();
  assert.equal(bare.walletScope, "main");
});

test("main wallet without DEV_MAIN_PRIVATE_KEY -> MAIN_SIGNER_UNAVAILABLE", async () => {
  const main = await signer.mainSigner({});
  await assert.rejects(main.signTypedData({ ...TD, primaryType: "Agent" }), (e) => e.code === "MAIN_SIGNER_UNAVAILABLE");
});

test("contract surface: AGENT_KEY_STORE and the vault functions", () => {
  assert.equal(signer.AGENT_KEY_STORE, "vault");
  for (const fn of ["getSecret", "saveSecret", "updateSecret", "deleteSecret", "venueCredentialName", "agentKey"]) {
    assert.equal(typeof signer[fn], "function", fn);
  }
  assert.equal(signer.venueCredentialName("outcome", "0x6DCF5C604B5E6B8C28A6BE1C629387485037BEAC"), "outcome.0x6dcf5c604b5e6b8c28a6be1c629387485037beac");
  assert.equal(signer.venueCredentialName("Outcome", "0xabc"), null);
});

test("agentKey needs the accounts option", async () => {
  await withWallet(async () => {
    await assert.rejects(signer.agentKey({ create: false }), (e) => e.code === "accounts_required");
  });
});

test("get-or-generate: one venue_credentials item, then the same key; vault file is 0600", async () => {
  await withWallet(async (address, name) => {
    assert.equal(await signer.agentKey({ accounts, create: false }), null);
    const first = await signer.agentKey({ accounts, agentName: "bevo" });
    assert.equal(first.generated, true);
    assert.equal(first.id, name);
    assert.equal(first.signerWallet, address);
    assert.equal(first.walletScope, "main");
    assert.equal(first.approval, "auto");
    assert.equal(first.approved, false);
    assert.equal(first.pending, null);
    const item = storedItem(name);
    assert.equal(item.kind, "venue_credentials");
    assert.match(item.label, /^outcome · 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/);
    assert.equal(JSON.parse(item.value).agent_key.address, first.address);
    assert.equal(statSync(VAULT).mode & 0o777, 0o600);
    const second = await signer.agentKey({ accounts });
    assert.equal(second.address, first.address);
    assert.equal(second.generated, false);
    const read = await signer.agentKey({ accounts, create: false });
    assert.equal(read.address, first.address);
  });
});

test("rotate writes a new key and reports it generated", async () => {
  await withWallet(async () => {
    const first = await signer.agentKey({ accounts });
    const rotated = await signer.agentKey({ accounts, rotate: true });
    assert.equal(rotated.generated, true);
    assert.notEqual(rotated.address, first.address);
    assert.equal((await signer.agentKey({ accounts, create: false })).address, rotated.address);
  });
});

test("saveSecret: a stale ifMatch is a conflict, ifMatch null means the item must not exist", async () => {
  await withWallet(async (_address, name) => {
    const saved = await signer.saveSecret(name, "{}", { label: "l", kind: "venue_credentials", ifMatch: null });
    await assert.rejects(signer.saveSecret(name, "{}", { ifMatch: null }), (e) => e.code === "conflict");
    await assert.rejects(signer.saveSecret(name, "{\"a\":1}", { ifMatch: "0".repeat(64) }), (e) => e.code === "conflict");
    await signer.saveSecret(name, "{\"a\":1}", { label: "l", kind: "venue_credentials", ifMatch: saved.etag });
    await assert.rejects(signer.getSecret("grab_password"), (e) => e.code === "forbidden");
  });
});

test("markApproved records approvedAt and validUntil and keeps other top-level keys", async () => {
  await withWallet(async (_address, name) => {
    const agent = await signer.agentKey({ accounts });
    const got = await signer.getSecret(name);
    await signer.saveSecret(name, JSON.stringify({ ...JSON.parse(got.value), other: { x: 1 } }), { label: got.label, kind: got.kind, ifMatch: got.etag });
    await agent.markApproved({ validUntil: "2027-01-01T00:00:00.000Z", agentName: "bevo" });
    const value = JSON.parse(storedItem(name).value);
    assert.equal(value.other.x, 1);
    assert.equal(value.agent_key.validUntil, "2027-01-01T00:00:00.000Z");
    assert.equal(value.agent_key.agentName, "bevo");
    assert.ok(value.agent_key.approvedAt);
    assert.equal(agent.approved, true);
    const again = await signer.agentKey({ accounts, create: false });
    assert.equal(again.approved, true);
    assert.equal(again.validUntil, "2027-01-01T00:00:00.000Z");
  });
});

test("forget deletes the item when agent_key was its only key, else only the key", async () => {
  await withWallet(async (_address, name) => {
    const agent = await signer.agentKey({ accounts });
    await agent.forget();
    assert.equal(storedItem(name), undefined);
    assert.equal(await signer.agentKey({ accounts, create: false }), null);
  });
  await withWallet(async (_address, name) => {
    const agent = await signer.agentKey({ accounts });
    const got = await signer.getSecret(name);
    await signer.saveSecret(name, JSON.stringify({ ...JSON.parse(got.value), other: 2 }), { label: got.label, kind: got.kind, ifMatch: got.etag });
    await agent.forget();
    assert.deepEqual(JSON.parse(storedItem(name).value), { other: 2 });
  });
});

test("seeding: OUTCOME_AGENT_PRIVATE_KEY seeds once, a forgotten key is not seeded back", async () => {
  await withWallet(
    async (_address, name) => {
      const seeded = await signer.agentKey({ accounts, create: false });
      assert.equal(seeded.address, privateKeyToAccount(throwaway).address);
      assert.equal(seeded.generated, false);
      assert.equal(seeded.approved, false);
      assert.equal(JSON.parse(storedItem(name).value).agent_key.agentName, process.env.DEV_AGENT_NAME || "bevo");
      await seeded.forget();
      assert.equal(await signer.agentKey({ accounts, create: false }), null);
    },
    { agentEnv: throwaway },
  );
});

test("seeding: an old dev/.agent-key.json wins over the env key", async () => {
  await withWallet(
    async (address) => {
      const fileKey = generatePrivateKey();
      writeFileSync(KEY_FILE, JSON.stringify({ label: "outcome", main: address, address: privateKeyToAccount(fileKey).address, privateKey: fileKey, approved: true, approvedAt: "2026-11-01T00:00:00.000Z", createdAt: "2026-10-30T00:00:00.000Z" }));
      try {
        const agent = await signer.agentKey({ accounts, create: false });
        assert.equal(agent.address, privateKeyToAccount(fileKey).address);
        assert.equal(agent.approved, true);
        assert.equal(agent.createdAt, "2026-10-30T00:00:00.000Z");
      } finally {
        writeFileSync(KEY_FILE, "{}");
      }
    },
    { agentEnv: throwaway },
  );
});

test("agent signTypedData: hip4 3-arg and viem object shapes agree, BigInts survive, signature recovers to the key", async () => {
  await withWallet(async () => {
    const agent = await signer.agentKey({ accounts });
    const domain = { ...TD.domain, chainId: 1337n };
    const a = await agent.signTypedData(domain, TD.types, TD.message);
    const b = await agent.signTypedData({ domain, types: TD.types, primaryType: "Agent", message: { ...TD.message, extra: "dropped" } });
    assert.equal(a, b);
    const viem = agent.toViemAccount();
    assert.equal(viem.signTypedData.length, 1);
    assert.equal(await viem.signTypedData({ domain, types: { EIP712Domain: [], ...TD.types }, primaryType: "Agent", message: TD.message }), a);
    assert.equal(await recoverTypedDataAddress({ domain, types: TD.types, primaryType: "Agent", message: TD.message, signature: a }), agent.address);
    assert.equal(JSON.stringify(agent).includes(JSON.parse(storedItem(agent.id).value).agent_key.secret), false);
  });
});

test("a full bootstrap prints addresses only: the output never holds a 64-hex string", async () => {
  await withMainKey(async (address) => {
    const name = `outcome.${address.toLowerCase()}`;
    const realFetch = globalThis.fetch;
    let approved = null;
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      if (String(url).endsWith("/exchange")) {
        approved = body.action.agentAddress;
        return new Response(JSON.stringify({ status: "ok" }));
      }
      if (body.type === "extraAgents") {
        return new Response(JSON.stringify(approved ? [{ address: approved, name: "bevo", validUntil: Date.now() + 90 * 86_400_000 }] : []));
      }
      return new Response("null");
    };
    try {
      const main = await signer.mainSigner({ idempotencyKey: "boot-1" });
      const done = await common.bootstrapAgent({ signerMod: signer, signer: main, key: null });
      const envelope = common.okEnvelope("done", {
        alreadyApproved: done.adopted,
        generated: done.agent.generated === true,
        mainWallet: main.address,
        agentAddress: done.agent.address,
        agentName: done.approval.name,
        validUntilIso: done.approval.validUntilIso,
        keyId: done.agent.id,
      });
      const out = common.toJson(envelope) + JSON.stringify(done.agent);
      assert.doesNotMatch(out, /0x[0-9a-fA-F]{64}/);
      assert.equal(done.agent.address.toLowerCase(), approved);
      const value = JSON.parse(storedItem(name).value);
      assert.ok(value.agent_key.approvedAt);
      assert.equal(value.agent_key.address, done.agent.address);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

const WITHDRAW_TYPES = {
  "HyperliquidTransaction:Withdraw": [
    { name: "hyperliquidChain", type: "string" },
    { name: "destination", type: "string" },
    { name: "amount", type: "string" },
    { name: "time", type: "uint64" },
  ],
};
const HL_DOMAIN = { name: "HyperliquidSignTransaction", version: "1", chainId: 42161, verifyingContract: "0x0000000000000000000000000000000000000000" };

async function withMainKey(fn) {
  const mainKey = generatePrivateKey();
  const prevWallet = process.env.OUTCOME_MAIN_WALLET;
  const prevKey = process.env.DEV_MAIN_PRIVATE_KEY;
  const address = privateKeyToAccount(mainKey).address;
  process.env.OUTCOME_MAIN_WALLET = address;
  process.env.DEV_MAIN_PRIVATE_KEY = mainKey;
  try {
    await fn(address);
  } finally {
    process.env.OUTCOME_MAIN_WALLET = prevWallet;
    if (prevKey === undefined) delete process.env.DEV_MAIN_PRIVATE_KEY;
    else process.env.DEV_MAIN_PRIVATE_KEY = prevKey;
  }
}

const withdrawTd = (destination) => ({
  domain: HL_DOMAIN,
  types: WITHDRAW_TYPES,
  primaryType: "HyperliquidTransaction:Withdraw",
  message: { hyperliquidChain: "Mainnet", destination, amount: "5", time: 1_800_000_000_000 },
});

test("main wallet signs a Withdraw to itself", async () => {
  await withMainKey(async (address) => {
    const main = await signer.mainSigner({ idempotencyKey: "wd-self" });
    const td = withdrawTd(address.toLowerCase());
    const sig = await main.signTypedData(td);
    assert.match(sig, /^0x[0-9a-f]+$/i);
    assert.equal(await recoverTypedDataAddress({ ...td, signature: sig }), address);
    const replay = await (await signer.mainSigner({ idempotencyKey: "wd-self" })).signTypedData(td);
    assert.equal(replay, sig);
  });
});

test("main wallet refuses a Withdraw to another address", async () => {
  await withMainKey(async () => {
    const main = await signer.mainSigner({ idempotencyKey: "wd-other" });
    const other = privateKeyToAccount(generatePrivateKey()).address;
    await assert.rejects(main.signTypedData(withdrawTd(other)), (e) => e.code === "SIGN_TYPE_REFUSED");
  });
});

test("main wallet refuses UsdSend and other HyperliquidTransaction types", async () => {
  await withMainKey(async (address) => {
    const main = await signer.mainSigner({ idempotencyKey: "wd-usdsend" });
    const usdSend = {
      domain: HL_DOMAIN,
      types: {
        "HyperliquidTransaction:UsdSend": [
          { name: "hyperliquidChain", type: "string" },
          { name: "destination", type: "string" },
          { name: "amount", type: "string" },
          { name: "time", type: "uint64" },
        ],
      },
      primaryType: "HyperliquidTransaction:UsdSend",
      message: { hyperliquidChain: "Mainnet", destination: address, amount: "5", time: 1_800_000_000_000 },
    };
    await assert.rejects(main.signTypedData(usdSend), (e) => e.code === "SIGN_TYPE_REFUSED");
  });
});
