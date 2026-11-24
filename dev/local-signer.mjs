// Local stand-in for the container's bevo-signer.mjs. DEV ONLY: never published
// by the hub (it lives outside scripts/). Same contract as production
// (virtuals-agent docs/skills-contract.md, "The signer"):
//
//   export const isDev = true
//   export const AGENT_KEY_STORE = 'vault'
//   mainSigner({ idempotencyKey, approval })
//     -> { address, walletScope, approval, signTypedData(...) -> 0x, sendTransaction({chainId,to,data,value}) -> { hash|null, status } }
//   agentKey({ label, accounts, rotate, create, display, agentName })
//     -> { id, label, address, signerWallet, walletScope, approval, agentName, createdAt, approvedAt, validUntil,
//          approved, generated, getAddress(), signTypedData(...), toViemAccount(), markApproved({validUntil, agentName}),
//          forget(), pending } | null (create:false and no key)
//   getSecret / saveSecret / updateSecret / deleteSecret / venueCredentialName / VaultError
//   signTypedData accepts (domain, types, value) AND ({ domain, types, primaryType, message }).
//
// The vault is the file dev/.vault.json (mode 0600, gitignored) with the same etag and
// compare-and-swap rules as the container's vault socket. The item outcome.<wallet> holds
// {"agent_key": {secret, address, agentName, createdAt, approvedAt, validUntil}}. A name that
// ever held an item is never seeded again, so a revoked key does not come back from the env.
//
// Local signing never waits for an owner, so it never throws PendingOwnerAction
// and `pending` stays null. Every main-wallet signature and transaction is idempotent per
// `${idempotencyKey}:${n}` (dev/.ledger.json), as bevo-server's ledger is: the same
// key with the same payload replays, with a different payload (a re-run's new nonce)
// it is refused IDEMPOTENCY_KEY_REUSED, so a re-run with an old key never bets twice.
//
// Keys come only from env vars, dev/.vault.json or the old dev/.agent-key.json (all
// gitignored). Nothing here ever prints a key.
//
// Env:
//   OUTCOME_MAIN_WALLET        main wallet address (required)
//   DEV_MAIN_PRIVATE_KEY       optional; without it deposit/approve cannot be signed locally
//   OUTCOME_AGENT_PRIVATE_KEY  optional; seeds the vault once when the item never existed
//   DEV_AGENT_NAME             agent name recorded on a seeded key (default bevo)
//   ARBITRUM_RPC_URL           default https://arb1.arbitrum.io/rpc
//   DEV_SIGNER_LEDGER          ledger path override (tests); default dev/.ledger.json
//   DEV_SIGNER_VAULT           vault path override (tests); default dev/.vault.json
//   DEV_SIGNER_KEY_FILE        old key file path override (tests); default dev/.agent-key.json

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// dev/ has no node_modules of its own: resolve viem from the skill root install.
const requireFromRoot = createRequire(new URL("../package.json", import.meta.url));
const load = (spec) => import(pathToFileURL(requireFromRoot.resolve(spec)).href);
const { privateKeyToAccount } = await load("viem/accounts");
const { createWalletClient, http, getAddress, hashTypedData } = await load("viem");
const { arbitrum } = await load("viem/chains");

export const isDev = true;
export const AGENT_KEY_STORE = "vault";

const KEY_FILE = process.env.DEV_SIGNER_KEY_FILE || fileURLToPath(new URL("./.agent-key.json", import.meta.url));
const LEDGER_FILE = process.env.DEV_SIGNER_LEDGER || fileURLToPath(new URL("./.ledger.json", import.meta.url));
const VAULT_FILE = process.env.DEV_SIGNER_VAULT || fileURLToPath(new URL("./.vault.json", import.meta.url));

function signerError(code, message, hint) {
  const err = new Error(message);
  err.code = code;
  err.hint = hint ?? null;
  return err;
}

/** Root type = the declared type no other type references (EIP712Domain excluded). */
function rootType(types) {
  const names = Object.keys(types).filter((n) => n !== "EIP712Domain");
  const referenced = new Set();
  for (const n of names) for (const f of types[n]) referenced.add(f.type.replace(/\[\d*\]$/, ""));
  const roots = names.filter((n) => !referenced.has(n));
  if (roots.length !== 1) throw signerError("BAD_TYPED_DATA", `typed data must have exactly one root type, found ${roots.length}`);
  return roots[0];
}

/** Accept hip4's (domain, types, value) and viem's ({domain, types, primaryType, message}). */
function normalizeTypedData(args) {
  let td;
  if (args.length >= 3) td = { domain: args[0], types: args[1], message: args[2] };
  else if (args.length === 1 && args[0] && typeof args[0] === "object") td = { ...args[0] };
  else throw signerError("BAD_TYPED_DATA", "signTypedData takes (domain, types, value) or one typed-data object");
  const { EIP712Domain: _ignored, ...types } = td.types ?? {};
  const primaryType = td.primaryType ?? rootType(types);
  const fields = types[primaryType];
  if (!fields) throw signerError("BAD_TYPED_DATA", `primaryType ${primaryType} is not declared`);
  const message = {};
  for (const f of fields) message[f.name] = td.message[f.name];
  return { domain: td.domain, types, primaryType, message };
}

function mainAddress() {
  const raw = process.env.OUTCOME_MAIN_WALLET;
  if (!raw) throw signerError("MAIN_WALLET_UNSET", "OUTCOME_MAIN_WALLET is not set.", "See dev/README.md.");
  try {
    return getAddress(raw.trim());
  } catch {
    throw signerError("MAIN_WALLET_UNSET", "OUTCOME_MAIN_WALLET is not a valid address.");
  }
}

function normalizeKey(pk) {
  const k = pk.trim();
  return k.startsWith("0x") ? k : `0x${k}`;
}

function mainAccount(address) {
  const pk = process.env.DEV_MAIN_PRIVATE_KEY;
  if (!pk) {
    throw signerError(
      "MAIN_SIGNER_UNAVAILABLE",
      "deposit/approve need the main wallet key; set DEV_MAIN_PRIVATE_KEY or test via bevo-server",
      "Export DEV_MAIN_PRIVATE_KEY for local tests, or run this step through bevo-server (L2).",
    );
  }
  const account = privateKeyToAccount(normalizeKey(pk));
  if (account.address.toLowerCase() !== address.toLowerCase()) {
    throw signerError("MAIN_SIGNER_MISMATCH", "DEV_MAIN_PRIVATE_KEY does not belong to OUTCOME_MAIN_WALLET.", "Fix the env vars; refusing to sign with the wrong wallet.");
  }
  return account;
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Per-call idempotency keys `${base}:${n}`, like the production signer. */
function keyCounter(base) {
  let n = 0;
  return () => (base ? `${base}:${++n}` : null);
}

const keyReused = (callKey) =>
  signerError(
    "IDEMPOTENCY_KEY_REUSED",
    `Idempotency key ${callKey.replace(/^agent_key\|/, "")} was already used for a different request.`,
    "This key already ran; read status/account before anything else."
  );

/** Mirrors bevo-signer's keyStatus over this signer's own ledger file. */
export async function keyStatus(key, { route = "execute" } = {}) {
  const ledger = readJson(LEDGER_FILE) ?? {};
  const stored = route === "agent_key" ? ledger[`agent_key|${key}`] : ledger[key];
  return { state: stored ? "executed" : "not_found" };
}

/** Sign once per call key: replay the stored signature, refuse a different payload. */
async function ledgeredSign(callKey, typedData, sign) {
  if (!callKey) return sign(typedData);
  const digest = hashTypedData(typedData);
  const ledger = readJson(LEDGER_FILE) ?? {};
  const prev = ledger[callKey];
  if (prev) {
    if (prev.digest !== digest) throw keyReused(callKey);
    return prev.signature;
  }
  const signature = await sign(typedData);
  writeJson(LEDGER_FILE, { ...ledger, [callKey]: { digest, signature, at: new Date().toISOString() } });
  return signature;
}

const HL_USER_SIGNED_PREFIX = "HyperliquidTransaction:";
const MAIN_MAY_SIGN = new Set([`${HL_USER_SIGNED_PREFIX}ApproveAgent`, `${HL_USER_SIGNED_PREFIX}Withdraw`]);

/** Mirror of the server rule: the main wallet signs only ApproveAgent and a Withdraw to itself. */
function assertMainMaySign(td, address) {
  if (!td.primaryType.startsWith(HL_USER_SIGNED_PREFIX)) return;
  if (!MAIN_MAY_SIGN.has(td.primaryType)) {
    throw signerError("SIGN_TYPE_REFUSED", `Refusing to sign ${td.primaryType} with the main wallet.`, "Only ApproveAgent and a withdrawal to the wallet itself are allowed.");
  }
  if (td.primaryType.endsWith(":Withdraw") && String(td.message.destination ?? "").toLowerCase() !== address.toLowerCase()) {
    throw signerError("SIGN_TYPE_REFUSED", "Refusing a withdrawal to an address other than the signing wallet.", "A withdrawal always goes to the same wallet.");
  }
}

export const SESSION_WALLET_DEFAULT = true;

export async function mainSigner({ idempotencyKey } = {}) {
  const address = mainAddress();
  const nextKey = keyCounter(idempotencyKey);
  return {
    address,
    walletScope: "main",
    approval: "auto",
    async signTypedData(...args) {
      const td = normalizeTypedData(args);
      assertMainMaySign(td, address);
      return ledgeredSign(nextKey(), td, (t) => mainAccount(address).signTypedData(t));
    },
    async sendTransaction({ chainId, to, data, value = 0n }) {
      const callKey = nextKey();
      if (Number(chainId) !== arbitrum.id) {
        throw signerError("UNSUPPORTED_CHAIN", `Local signer only sends on Arbitrum (42161), got ${chainId}.`);
      }
      const ledger = readJson(LEDGER_FILE) ?? {};
      if (callKey && ledger[callKey]) {
        const prev = ledger[callKey];
        if (prev.to !== to || prev.data !== data) throw keyReused(callKey);
        return { hash: prev.hash, status: "replayed" };
      }
      const wallet = createWalletClient({
        account: mainAccount(address),
        chain: arbitrum,
        transport: http(process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc"),
      });
      const hash = await wallet.sendTransaction({ to, data, value: BigInt(value) });
      if (callKey) writeJson(LEDGER_FILE, { ...ledger, [callKey]: { to, data, hash, at: new Date().toISOString() } });
      return { hash, status: "submitted" };
    },
  };
}

export class VaultError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

const LABEL_RE = /^[a-z0-9_-]{1,40}$/;
const WALLET_PART_RE = /^[A-Za-z0-9]{1,64}$/;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const VENUE_KIND = "venue_credentials";

export function venueCredentialName(label, wallet) {
  if (!LABEL_RE.test(String(label))) return null;
  const part = EVM_ADDRESS_RE.test(String(wallet)) ? String(wallet).toLowerCase() : String(wallet);
  return WALLET_PART_RE.test(part) ? `${label}.${part}` : null;
}

const etagOf = (item) => createHash("sha256").update(JSON.stringify([item.label, item.kind, item.value])).digest("hex");

function readVault() {
  const doc = readJson(VAULT_FILE);
  return { items: doc?.items ?? {}, seen: doc?.seen ?? {} };
}

function writeVault(doc) {
  const tmp = `${VAULT_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, VAULT_FILE);
}

function assertVenueName(name) {
  if (typeof name !== "string" || !/^[a-z0-9_-]{1,40}\.[A-Za-z0-9]{1,64}$/.test(name)) {
    throw new VaultError("forbidden", "only a venue credential (<label>.<wallet>) is read here");
  }
}

const vaultPending = () => process.env.DEV_SIGNER_VAULT_STATE === "pending";
const presentOrAbsent = (got) => (got.status === "pending" ? { status: "not_found" } : got);

export async function getSecret(name) {
  assertVenueName(name);
  const item = readVault().items[name];
  if (!item) return { status: vaultPending() ? "pending" : "not_found" };
  return { status: "ok", value: item.value, label: item.label, kind: item.kind, updatedAt: item.updatedAt, etag: etagOf(item) };
}

export async function saveSecret(name, value, { label = "", kind = "secret", ifMatch } = {}) {
  assertVenueName(name);
  if (typeof value !== "string" || Buffer.byteLength(value) > 4096) {
    throw new VaultError("invalid", "a vault value is a string of at most 4096 bytes");
  }
  const doc = readVault();
  const current = doc.items[name];
  if (ifMatch !== undefined) {
    const currentEtag = current ? etagOf(current) : null;
    if (currentEtag !== ifMatch) throw new VaultError("conflict", "the item changed since it was read; read it again");
  }
  const item = { label, kind, value, updatedAt: new Date().toISOString() };
  doc.items[name] = item;
  doc.seen[name] = true;
  writeVault(doc);
  return { version: Object.keys(doc.items).length, state: "restored", etag: etagOf(item) };
}

export async function deleteSecret(name) {
  assertVenueName(name);
  const doc = readVault();
  if (!doc.items[name]) throw new VaultError("not_found", "no such item");
  delete doc.items[name];
  writeVault(doc);
  return { version: Object.keys(doc.items).length, state: "restored" };
}

export async function updateSecret(name, fn, { label, kind, tries = 3 } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const prev = presentOrAbsent(await getSecret(name));
    const next = await fn(prev.status === "ok" ? prev.value : null);
    if (next === undefined) return { status: "unchanged", value: prev.status === "ok" ? prev.value : null };
    if (next === null) {
      if (prev.status === "ok") await deleteSecret(name);
      return { status: "deleted" };
    }
    try {
      const saved = await saveSecret(name, next, {
        label: label ?? prev.label,
        kind: kind ?? prev.kind,
        ifMatch: prev.status === "ok" ? prev.etag : null,
      });
      return { status: "saved", ...saved };
    } catch (err) {
      if (err?.code !== "conflict") throw err;
    }
  }
  throw new VaultError("conflict", "the item kept changing; try again");
}

const shortWallet = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

function parseValue(got) {
  if (got.status !== "ok") return {};
  try {
    const parsed = JSON.parse(got.value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const storedKey = (parsed) => (/^0x[0-9a-fA-F]{64}$/.test(parsed?.agent_key?.secret ?? "") ? parsed.agent_key : null);

function seedKey(main, label) {
  const agentName = process.env.DEV_AGENT_NAME || "bevo";
  const file = readJson(KEY_FILE);
  if (file && file.label === label && file.main?.toLowerCase() === main.toLowerCase() && file.privateKey) {
    const secret = normalizeKey(file.privateKey);
    return {
      secret,
      address: file.address ?? privateKeyToAccount(secret).address,
      agentName,
      createdAt: file.createdAt ?? new Date().toISOString(),
      approvedAt: file.approved ? file.approvedAt ?? null : null,
      validUntil: null,
    };
  }
  if (process.env.OUTCOME_AGENT_PRIVATE_KEY) {
    const secret = normalizeKey(process.env.OUTCOME_AGENT_PRIVATE_KEY);
    return { secret, address: privateKeyToAccount(secret).address, agentName, createdAt: new Date().toISOString(), approvedAt: null, validUntil: null };
  }
  return null;
}

async function seedOnce(name, main, label, display) {
  const doc = readVault();
  if (doc.items[name] || doc.seen[name]) return;
  const seeded = seedKey(main, label);
  if (!seeded) return;
  await saveSecret(name, JSON.stringify({ agent_key: seeded }), { label: display, kind: VENUE_KIND, ifMatch: null });
}

function keyObject({ name, label, main, accounts, stored, generated }) {
  const account = accounts.privateKeyToAccount(stored.secret);
  const agent = {
    id: name,
    label,
    address: account.address,
    signerWallet: main,
    walletScope: "main",
    approval: "auto",
    agentName: stored.agentName ?? null,
    createdAt: stored.createdAt ?? null,
    approvedAt: stored.approvedAt ?? null,
    validUntil: stored.validUntil ?? null,
    approved: stored.approvedAt != null,
    generated,
    pending: null,
    getAddress: () => account.address,
    async signTypedData(...args) {
      return account.signTypedData(normalizeTypedData(args));
    },
    toViemAccount() {
      return {
        address: account.address,
        type: "local",
        signTypedData: async (typedData) => agent.signTypedData(typedData),
      };
    },
    async markApproved({ validUntil, agentName } = {}) {
      const now = new Date().toISOString();
      await updateSecret(name, (prev) => {
        const parsed = JSON.parse(prev ?? "{}");
        const current = storedKey(parsed);
        if (!current || current.address !== account.address) return undefined;
        return JSON.stringify({
          ...parsed,
          agent_key: { ...current, approvedAt: now, validUntil: validUntil ?? null, agentName: agentName ?? current.agentName },
        });
      });
      agent.approvedAt = now;
      agent.validUntil = validUntil ?? null;
      agent.agentName = agentName ?? agent.agentName;
      agent.approved = true;
    },
    async forget() {
      await updateSecret(name, (prev) => {
        if (prev === null) return undefined;
        const parsed = JSON.parse(prev);
        delete parsed.agent_key;
        return Object.keys(parsed).length ? JSON.stringify(parsed) : null;
      });
    },
  };
  return agent;
}

export async function agentKey({ label = "outcome", accounts, rotate = false, create = true, display, agentName } = {}) {
  if (typeof accounts?.generatePrivateKey !== "function" || typeof accounts?.privateKeyToAccount !== "function") {
    throw signerError("accounts_required", "agentKey needs the skill's viem/accounts as the accounts option.");
  }
  const main = mainAddress();
  const name = venueCredentialName(label, main);
  if (!name) throw signerError("invalid", `"${label}" is not a valid vault label.`);
  const displayName = display ?? `${label} · ${shortWallet(main)}`;
  if (!vaultPending()) await seedOnce(name, main, label, displayName);

  let got = presentOrAbsent(await getSecret(name));
  for (let attempt = 0; attempt < 3; attempt++) {
    const parsed = parseValue(got);
    const existing = storedKey(parsed);
    if (!create) return existing ? keyObject({ name, label, main, accounts, stored: existing, generated: false }) : null;
    if (existing && !rotate) return keyObject({ name, label, main, accounts, stored: existing, generated: false });

    const secret = accounts.generatePrivateKey();
    const fresh = {
      secret,
      address: accounts.privateKeyToAccount(secret).address,
      agentName: agentName ?? existing?.agentName ?? null,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      validUntil: null,
    };
    try {
      await saveSecret(name, JSON.stringify({ ...parsed, agent_key: fresh }), {
        label: displayName,
        kind: VENUE_KIND,
        ifMatch: got.status === "ok" ? got.etag : null,
      });
      return keyObject({ name, label, main, accounts, stored: fresh, generated: true });
    } catch (err) {
      if (err?.code !== "conflict") throw err;
      got = presentOrAbsent(await getSecret(name));
      const winner = storedKey(parseValue(got));
      if (winner && winner.address !== existing?.address) {
        return keyObject({ name, label, main, accounts, stored: winner, generated: false });
      }
    }
  }
  throw signerError("vault_conflict", "The vault item kept changing; try again.");
}
