#!/usr/bin/env node
// SIGNS WITH THE WALLET. Make (or replace) the trading key, keep it in the Butler's vault
// and approve it on Hyperliquid with an ApproveAgent signature from the wallet.
//
//   node setup_agent.mjs [--rotate] [--idempotency-key <key>]
//   node setup_agent.mjs --resume <key>      (after pending_owner_signature)
//
// status: done | needs_deposit | pending_owner_signature
// A stored key Hyperliquid lists and approves is only confirmed (nothing signed). A missing
// key, or one Hyperliquid no longer lists, is replaced by a fresh one; --rotate forces that.
// An address Hyperliquid stopped listing is never re-approved.
// Resumable: {nonce, agentAddress, agentName} is saved under the key; --resume rebuilds the
// identical typed data and repeats the signer call with the same idempotency key.

import {
  runScript,
  parseArgs,
  okEnvelope,
  loadSigner,
  viemAccounts,
  agentHealth,
  recordApproval,
  bootstrapAgent,
  hlInfo,
  idempotencyKeyFrom,
  scriptDeadline,
  loadPending,
  SkillError,
  RESUME_FLAGS,
  AGENT_KEY_LABEL,
} from "./lib/common.mjs";

const SCRIPT = "setup_agent";

runScript(async () => {
  const args = parseArgs(process.argv.slice(2), { ...RESUME_FLAGS, rotate: { type: "boolean" } });
  if (args.resume && args.rotate) throw new SkillError("BAD_ARGS", "--resume and --rotate cannot be combined");
  const signerMod = await loadSigner();
  const key = idempotencyKeyFrom(args, SCRIPT, { isDev: Boolean(signerMod.isDev) });
  const signer = await signerMod.mainSigner({ idempotencyKey: key, deadline: scriptDeadline() });
  const main = signer.address;

  const role = await hlInfo({ type: "userRole", user: main });
  if (role?.role === "missing") {
    throw new SkillError("NEEDS_DEPOSIT", "This wallet has never deposited to Hyperliquid, so it cannot approve a trading key yet.", {
      hint: "Run deposit.mjs --amount 5 (or more) first.",
      status: "needs_deposit",
    });
  }

  let rec = null;
  if (args.resume) {
    rec = loadPending(key, SCRIPT);
  } else if (!args.rotate) {
    const stored = await signerMod.agentKey({
      label: AGENT_KEY_LABEL,
      accounts: await viemAccounts(),
      create: false,
      deadline: scriptDeadline(),
    });
    if (stored) {
      const before = await agentHealth(main, stored.address);
      if (before.valid) {
        await recordApproval(stored, before);
        return okEnvelope("done", {
          alreadyApproved: true,
          mainWallet: main,
          agentAddress: stored.address,
          agentName: before.name,
          validUntilIso: before.validUntilIso ?? null,
          daysLeft: before.daysLeft,
          expiringSoon: before.expiringSoon,
          mustRotate: before.mustRotate,
          health: before.code,
        });
      }
    }
  }

  const done = await bootstrapAgent({ signerMod, signer, key, rec });
  return okEnvelope("done", {
    alreadyApproved: done.adopted,
    generated: done.agent.generated === true,
    resumed: done.resumed,
    mainWallet: main,
    agentAddress: done.agent.address,
    agentName: done.approval.name,
    validUntilIso: done.approval.validUntilIso ?? null,
    daysLeft: done.approval.daysLeft,
    expiringSoon: done.approval.expiringSoon,
    mustRotate: done.approval.mustRotate,
  });
});
