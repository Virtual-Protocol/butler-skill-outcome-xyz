#!/usr/bin/env node
// SIGNS WITH THE WALLET. Retire the trading key: delete it from the Butler's vault, then
// make Hyperliquid drop it by approving a throwaway address under the same agent name
// (Hyperliquid has no agent delete; the throwaway key is discarded at once).
//
//   node revoke_agent.mjs --idempotency-key <key>
//   node revoke_agent.mjs --resume <key>      (after pending_owner_signature)
//
// status: done | pending_owner_signature
// Resumable: the vault key is already gone when the signature card waits, so
// {nonce, throwawayAddress, agentName, oldAgentAddress} is saved under the key.

import {
  runScript,
  parseArgs,
  okEnvelope,
  loadSigner,
  viemAccounts,
  agentNameFor,
  waitUntilGone,
  idempotencyKeyFrom,
  scriptDeadline,
  savePending,
  loadPending,
  clearPending,
  rethrowWithResume,
  SkillError,
  RESUME_FLAGS,
  AGENT_KEY_LABEL,
} from "./lib/common.mjs";

const SCRIPT = "revoke_agent";

runScript(async () => {
  const args = parseArgs(process.argv.slice(2), RESUME_FLAGS);
  const signerMod = await loadSigner();
  const key = idempotencyKeyFrom(args, SCRIPT, { isDev: Boolean(signerMod.isDev) });
  const signer = await signerMod.mainSigner({ idempotencyKey: key, deadline: scriptDeadline() });
  const main = signer.address;
  const { getAgentApprovalTypedData, submitAgentApproval, nextNonce } = await import("@outcome.xyz/hip4");

  let rec;
  if (args.resume) {
    rec = loadPending(key, SCRIPT);
  } else {
    const accounts = await viemAccounts();
    const agent = await signerMod.agentKey({ label: AGENT_KEY_LABEL, accounts, create: false, deadline: scriptDeadline() });
    if (!agent) return okEnvelope("done", { revoked: false, reason: "no key", mainWallet: main });
    const agentName = agent.agentName ?? agentNameFor(signerMod);
    const oldAgentAddress = agent.address;
    await agent.forget();
    rec = {
      script: SCRIPT,
      mainWallet: main,
      nonce: nextNonce(),
      throwawayAddress: accounts.privateKeyToAccount(accounts.generatePrivateKey()).address,
      agentName,
      oldAgentAddress,
    };
    savePending(key, rec);
  }

  const typedData = getAgentApprovalTypedData(rec.throwawayAddress, rec.agentName, rec.nonce, true);
  let signature;
  try {
    signature = await signer.signTypedData(typedData);
  } catch (err) {
    rethrowWithResume(err, key);
  }

  const res = await submitAgentApproval(signature, rec.throwawayAddress, rec.agentName, rec.nonce, true);
  clearPending(key);
  if (!res.success) {
    throw new SkillError("APPROVE_FAILED", `Hyperliquid refused the replacement approval: ${res.error ?? "unknown error"}`, {
      hint: "The key is already gone from the vault. Run status.mjs; the old address may still be listed until it expires.",
      data: { oldAgentAddress: rec.oldAgentAddress, agentName: rec.agentName, raw: res.error ?? null },
    });
  }

  const gone = await waitUntilGone(main, rec.oldAgentAddress);
  return okEnvelope("done", {
    revoked: true,
    goneFromHyperliquid: Boolean(gone),
    resumed: Boolean(args.resume),
    mainWallet: main,
    oldAgentAddress: rec.oldAgentAddress,
    agentName: rec.agentName,
  });
});
