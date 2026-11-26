#!/usr/bin/env node
// Read-only. One wallet's Outcome (Hyperliquid HIP-4) bets as portfolio/v1.
//
//   node portfolio.mjs --address 0x...              full envelope, bets only
//   node portfolio.mjs positions --address 0x...    bets held
//   node portfolio.mjs orders --address 0x...       open outcome orders (chat only)
//   node portfolio.mjs balances --address 0x...     Hyperliquid spot USDC (chat only)
//   The Butler also passes --wallet-id <walletId>; --wallet 0x... (deprecated) still reads that address.

import { runScript, okEnvelope, errorEnvelope, parseArgs, SkillError } from "./lib/common.mjs";
import { assertWallet, readAddress, getBalances, getOpenOrders, getPositions, mapVenueError, readPortfolio } from "./lib/portfolio.mjs";

const SUBCOMMANDS = new Set(["positions", "orders", "balances"]);

await runScript(async () => {
  const argv = process.argv.slice(2);
  const sub = argv[0] && !argv[0].startsWith("-") ? argv.shift() : null;
  if (sub && !SUBCOMMANDS.has(sub)) throw new SkillError("BAD_ARGS", `unknown subcommand ${sub}`);
  const args = parseArgs(argv, { "wallet-id": { type: "string" }, wallet: { type: "string" }, address: { type: "string" } });
  const wallet = assertWallet(readAddress(args));
  try {
    if (sub === "positions") return okEnvelope("done", { wallet, asOf: new Date().toISOString(), positions: await getPositions(wallet) });
    if (sub === "orders") {
      return okEnvelope("done", { wallet, asOf: new Date().toISOString(), note: "Outcome open orders only", orders: await getOpenOrders(wallet) });
    }
    if (sub === "balances") {
      return okEnvelope("done", { wallet, asOf: new Date().toISOString(), note: "Hyperliquid spot USDC, not part of the Outcome portfolio value", balances: await getBalances(wallet) });
    }
    const { status, data } = await readPortfolio(wallet);
    return okEnvelope(status, data);
  } catch (err) {
    const e = mapVenueError(err);
    if (e.code === "BAD_ARGS") throw e;
    return errorEnvelope(e.code, e.message, { hint: e.hint });
  }
});
process.exitCode = 0;
