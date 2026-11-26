#!/usr/bin/env node
// AGENT-SIGNED, same-account move. Make sure the perps balance (what a withdrawal
// pays out of) covers --amount by moving only the gap from spot to perps ("")
// with agentSendAsset (destination = the same main wallet). Mirror of
// ensure_spot.mjs. Never changes the account mode; in unified mode there is
// nothing to move.
//
//   node ensure_perps.mjs --amount <usd> [--idempotency-key <key>]
//
// status: done | needs_agent | authorization_timeout
// Not resumable: a card for repairing a lapsed key that times out is reported as
// authorization_timeout (nothing moved); re-run to file a new card.

import {
  runScript,
  parseArgs,
  okEnvelope,
  loadSigner,
  parseUsdAmount,
  readHlBalances,
  ensureAgent,
  moveUsdcInAccount,
  pendingTrap,
  ceilCents,
  round6,
  sleep,
  SkillError,
  SIGNER_FLAGS,
  idempotencyKeyFrom,
  scriptDeadline,
} from "./lib/common.mjs";

runScript(async () => {
  const args = parseArgs(process.argv.slice(2), { ...SIGNER_FLAGS, amount: { type: "string", required: true } });
  const amount = parseUsdAmount(args.amount, "amount");
  const signerMod = await loadSigner();
  const idempotencyKey = idempotencyKeyFrom(args, "ensure_perps", { isDev: Boolean(signerMod.isDev) });
  const signer = await signerMod.mainSigner({ idempotencyKey, deadline: scriptDeadline() });
  const main = signer.address;

  const hl = await readHlBalances(main);
  const base = { mainWallet: main, target: amount, abstraction: hl.abstraction };
  if (hl.unified) {
    if (hl.spotUsdcFree >= amount) return okEnvelope("done", { ...base, moved: 0, perpsWithdrawable: hl.spotUsdcFree, note: "Unified account: spot and perps are one balance." });
    throw insufficient(amount, hl.spotUsdcFree, base);
  }
  if (hl.perpsWithdrawable >= amount) return okEnvelope("done", { ...base, moved: 0, perpsWithdrawable: hl.perpsWithdrawable });

  const gap = ceilCents(amount - hl.perpsWithdrawable);
  if (hl.spotUsdcFree < gap) throw insufficient(amount, round6(hl.spotUsdcFree + hl.perpsWithdrawable), base);

  const { agent } = await ensureAgent({ signerMod, signer });

  await moveUsdcInAccount({
    agent,
    trap: pendingTrap(),
    main,
    sourceDex: "spot",
    destinationDex: "",
    amount: gap,
    errorData: { gap },
  });

  let after = null;
  for (let i = 0; i < 5; i++) {
    after = await readHlBalances(main);
    if (after.perpsWithdrawable >= amount - 0.000001) break;
    await sleep(1_500);
  }
  return okEnvelope("done", { ...base, moved: gap, idempotencyKey, spotUsdcFree: after.spotUsdcFree, perpsWithdrawable: after.perpsWithdrawable });
});

function insufficient(amount, available, base) {
  return new SkillError("INSUFFICIENT_HL_BALANCE", `Hyperliquid holds $${available} USDC available; $${amount} is needed.`, {
    hint: "Move at most what status.mjs shows, or deposit first.",
    data: base,
  });
}
