#!/usr/bin/env node
// Duty-wallet teardown for the Butler (SKILL_STANDARD venue block). Prints ONE venue JSON object.
//
//   node venue.mjs precheck --walletid <id> --address <0x...> [--json]
//       read-only, by --address; no signer, no installed package
//   node venue.mjs withdraw --walletid <id> --address <0x...> (--all|--cash) [--json]
//       AGENT-SIGNED, only as the wallet the Butler pinned; --cash cancels open Outcome orders,
//       --all also sells every Outcome bet with one IOC at best bid x (1 - SELL_SLIPPAGE).
//       Never transfers: the cash stays in the Hyperliquid account.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MIN_ORDER_NOTIONAL,
  num,
  SkillError,
  classifyAgentHealth,
  classifyCancelStatuses,
  agentExchange,
  hlInfo,
  loadSigner,
  orderCloid,
  outcomeOrderWire,
  parseArgs,
  pendingTrap,
  placeOutcomeOrder,
  readStoredAgent,
  round6,
  toJson,
} from "./lib/common.mjs";

export const VENUE_ID = "outcomexyz";
export const SELL_SLIPPAGE = 0.05;
export const RUN_WINDOW_MS = 600_000;
export const MAX_HELD = 200;

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BET_COIN_RE = /^#\d{2,}$/;
const BALANCE_COIN_RE = /^\+\d{2,}$/;
const ARG_SPEC = {
  walletid: { type: "string" },
  address: { type: "string" },
  json: { type: "boolean" },
  all: { type: "boolean" },
  cash: { type: "boolean" },
};


export function emptyPrecheck() {
  return { venue: VENUE_ID, readable: true, reason: null, freeUsd: 0, inTransitUsd: 0, positions: [], orders: [], held: [] };
}

export function unreadablePrecheck(reason) {
  return { ...emptyPrecheck(), readable: false, reason: String(reason ?? "unreadable").slice(0, 200) };
}

export function withdrawResult(mode, { moved = [], kept = [] } = {}) {
  return { venue: VENUE_ID, mode, moved, pending: [], kept };
}

export function addressKind(address) {
  const a = String(address ?? "");
  if (EVM_RE.test(a)) return "evm";
  if (SOLANA_RE.test(a)) return "solana";
  return null;
}

function cleanName(name) {
  const s = String(name ?? "").trim();
  if (!s || s.startsWith("template:") || s.includes("{")) return null;
  return s;
}

export function titleBook(meta) {
  const byOutcome = new Map();
  for (const o of Array.isArray(meta?.outcomes) ? meta.outcomes : []) {
    byOutcome.set(Number(o.outcome), { name: cleanName(o.name), sides: (o.sideSpecs ?? []).map((s) => cleanName(s?.name)) });
  }
  return (coin) => {
    const digits = coin.slice(1);
    const outcomeId = Number(digits.slice(0, -1));
    const sideIndex = Number(digits.slice(-1));
    const entry = byOutcome.get(outcomeId);
    const market = entry?.name ?? `Outcome market ${outcomeId}`;
    const side = entry?.sides?.[sideIndex] ?? (sideIndex === 0 ? "Yes" : "No");
    return `${market} (${side})`.slice(0, 120);
  };
}

export function betCoin(balanceCoin) {
  return `#${balanceCoin.slice(1)}`;
}

export function sellPrice(bestBid) {
  const raw = Number(bestBid) * (1 - SELL_SLIPPAGE);
  if (!(raw > 0)) return 0;
  return Math.floor(raw * 1e5 + 1e-7) / 1e5;
}

export function sellCloid(walletId, coin, runKey) {
  return orderCloid("venue", `${walletId}|${coin}|${runKey}`);
}

export function runKeyFor(size, now = Date.now()) {
  return `${size}|${Math.floor(now / RUN_WINDOW_MS)}`;
}

export async function readOutcomeState(address, { info = hlInfo } = {}) {
  const [spot, orders, mids] = await Promise.all([
    info({ type: "spotClearinghouseState", user: address }),
    info({ type: "openOrders", user: address }),
    info({ type: "allMids" }),
  ]);
  const meta = await info({ type: "outcomeMeta" }).catch(() => null);
  const title = titleBook(meta);
  const balances = (spot?.balances ?? [])
    .filter((b) => BALANCE_COIN_RE.test(String(b?.coin ?? "")))
    .map((b) => {
      const coin = betCoin(b.coin);
      const total = num(b.total) ?? 0;
      const hold = num(b.hold) ?? 0;
      return { coin, total, free: Math.max(0, total - hold), mid: num(mids?.[coin]), title: title(coin) };
    })
    .filter((b) => b.total > 0);
  const open = (Array.isArray(orders) ? orders : [])
    .filter((o) => BET_COIN_RE.test(String(o?.coin ?? "")))
    .map((o) => {
      const price = num(o.limitPx);
      const size = num(o.sz) ?? 0;
      const buy = o.side === "B";
      return {
        oid: Number(o.oid),
        coin: o.coin,
        title: `${buy ? "Buy" : "Sell"} ${size} ${title(o.coin)}`.slice(0, 120),
        reservedUsd: buy && price !== null ? round6(price * size) : null,
      };
    });
  return { balances, orders: open };
}

export function markUsd(b) {
  return b.mid !== null && b.mid > 0 ? round6(b.total * b.mid) : null;
}

async function bestBid(coin, info) {
  const book = await info({ type: "l2Book", coin });
  return num(book?.levels?.[0]?.[0]?.px);
}

export async function sellQuote(b, info) {
  const size = Math.floor(b.free);
  if (size <= 0) return { sellable: false, reason: "below_minimum", size, price: 0, notional: 0 };
  let bid;
  try {
    bid = await bestBid(b.coin, info);
  } catch {
    bid = null;
  }
  const price = bid !== null ? sellPrice(bid) : 0;
  if (!(price > 0)) return { sellable: false, reason: "not_closable", size, price: 0, notional: 0 };
  const notional = round6(size * price);
  if (notional < MIN_ORDER_NOTIONAL) return { sellable: false, reason: "below_minimum", size, price, notional };
  return { sellable: true, reason: null, size, price, notional };
}

export async function toPrecheck(state, { info = hlInfo } = {}) {
  const out = emptyPrecheck();
  for (const b of state.balances) {
    const { sellable } = await sellQuote(b, info);
    const key = `spot:${b.coin}`;
    const valueUsd = markUsd(b);
    if (sellable) out.positions.push({ key, title: b.title, valueUsd, closable: true });
    else out.held.push({ key, title: b.title, valueUsd });
  }
  out.held = out.held.slice(0, MAX_HELD);
  out.orders = state.orders.map((o) => ({ key: `oid:${o.oid}`, title: o.title, reservedUsd: o.reservedUsd }));
  return out;
}

export async function precheck({ address }, deps = {}) {
  const kind = addressKind(address);
  if (kind === "solana") return emptyPrecheck();
  if (kind !== "evm") return unreadablePrecheck("--address must be a 0x or Solana address");
  try {
    return await toPrecheck(await readOutcomeState(address, deps), deps);
  } catch (err) {
    return unreadablePrecheck(`Hyperliquid read failed: ${err?.message ?? err}`);
  }
}

function keptEverything(state, reason) {
  return [
    ...state.orders.map((o) => ({ key: `oid:${o.oid}`, title: o.title, valueUsd: o.reservedUsd ?? 0, reason })),
    ...state.balances.map((b) => ({ key: `spot:${b.coin}`, title: b.title, valueUsd: markUsd(b) ?? 0, reason })),
  ];
}

export async function pinMatches(signerMod, { walletId, address }) {
  if (typeof signerMod?.pinnedWallet !== "function") return false;
  const pinned = await signerMod.pinnedWallet();
  if (!pinned || typeof pinned !== "object") return false;
  const pinnedId = String(pinned.walletId ?? pinned.id ?? "");
  const pinnedAddress = String(pinned.address ?? "").toLowerCase();
  return pinnedId !== "" && pinnedId === String(walletId) && pinnedAddress !== "" && pinnedAddress === String(address).toLowerCase();
}

async function usableAgent(signerMod, address, info) {
  const { agent } = await readStoredAgent(signerMod);
  if (!agent) return null;
  const [agents, role] = await Promise.all([
    info({ type: "extraAgents", user: address }),
    info({ type: "userRole", user: agent.address }),
  ]);
  const health = classifyAgentHealth({ agents: Array.isArray(agents) ? agents : [], role, main: address, agentAddress: agent.address });
  return health.valid ? agent : null;
}

async function cancelOrders(exchange, orders, assetIdOf) {
  if (orders.length === 0) return { moved: [], kept: [] };
  const targets = orders.map((o) => ({ oid: o.oid, coin: o.coin, marketId: null }));
  let statuses;
  try {
    const res = await exchange.cancel({ cancels: orders.map((o) => ({ a: assetIdOf(o.coin), o: o.oid })) });
    statuses = res?.response?.data?.statuses ?? [];
  } catch (err) {
    statuses = err?.response?.response?.data?.statuses ?? [];
  }
  const { results } = classifyCancelStatuses(targets, statuses);
  const moved = [];
  const kept = [];
  results.forEach((r, i) => {
    const o = orders[i];
    if (r.ok || r.alreadyDone) moved.push({ key: `oid:${o.oid}`, title: o.title, valueUsd: 0, txHash: null });
    else kept.push({ key: `oid:${o.oid}`, title: o.title, valueUsd: o.reservedUsd ?? 0, reason: "close_failed" });
  });
  return { moved, kept };
}

async function sellAll({ balances, agent, trap, exchange, address, walletId, info, assetIdOf, formatPrice, now }) {
  const moved = [];
  const kept = [];
  for (const b of balances) {
    const key = `spot:${b.coin}`;
    const markValue = markUsd(b) ?? 0;
    const { sellable, reason, size, price, notional } = await sellQuote(b, info);
    if (!sellable) {
      kept.push({ key, title: b.title, valueUsd: markValue || notional, reason });
      continue;
    }
    const wire = outcomeOrderWire({
      assetId: assetIdOf(b.coin),
      side: "sell",
      price: formatPrice(price.toFixed(5)),
      size,
      tif: "FAK",
      cloid: sellCloid(walletId, b.coin, runKeyFor(size, now())),
    });
    let filled = 0;
    try {
      const res = await placeOutcomeOrder({ agent, trap, main: address, wire, info, exchange });
      if (res.orderStatus === "filled") filled = Math.min(size, num(res.filledShares) ?? size);
    } catch (err) {
      console.error(`[outcome-xyz] venue sell ${b.coin} failed: ${err?.code ?? ""} ${err?.message ?? err}`);
    }
    if (filled > 0) moved.push({ key, title: b.title, valueUsd: round6(filled * price), txHash: null });
    if (filled < size) kept.push({ key, title: b.title, valueUsd: round6((size - filled) * (b.mid ?? price)), reason: "close_failed" });
  }
  return { moved, kept };
}

async function sdkHelpers() {
  const { sideAssetId, parseSideCoin, formatOutcomePrice } = await import("@outcome.xyz/hip4");
  return {
    assetIdOf: (coin) => {
      const p = parseSideCoin(coin);
      if (!p) throw new SkillError("MARKET_NOT_TRADABLE", `${coin} is not an outcome side.`);
      return sideAssetId(p.outcomeId, p.sideIndex);
    },
    formatPrice: formatOutcomePrice,
  };
}

export async function withdraw({ walletId, address, mode }, deps = {}) {
  const info = deps.info ?? hlInfo;
  const now = deps.now ?? Date.now;
  const kind = addressKind(address);
  if (kind === "solana") return withdrawResult(mode);
  let signerMod = null;
  try {
    signerMod = deps.signerMod ?? (await (deps.loadSigner ?? loadSigner)());
  } catch (err) {
    console.error(`[outcome-xyz] venue signer unavailable: ${err?.code ?? ""} ${err?.message ?? err}`);
  }
  const pinned = kind === "evm" && signerMod ? await pinMatches(signerMod, { walletId, address }).catch(() => false) : false;
  let state;
  try {
    state = kind === "evm" ? await readOutcomeState(address, { info }) : null;
  } catch {
    state = null;
  }
  if (!pinned) {
    console.error(`[outcome-xyz] venue withdraw refused: ${signerMod ? "signer not pinned, or its pinned wallet does not match --walletid/--address" : "signer unavailable"}`);
    const kept = state ? keptEverything(state, "refused") : [];
    if (kept.length === 0) kept.push({ key: "signer", title: "Outcome teardown", valueUsd: 0, reason: "refused" });
    return withdrawResult(mode, { kept });
  }
  if (!state) return withdrawResult(mode, { kept: [{ key: "venue", title: "Outcome", valueUsd: 0, reason: "unreadable" }] });
  if (state.orders.length === 0 && (mode === "cash" || state.balances.length === 0)) {
    return withdrawResult(mode, { kept: mode === "cash" ? keptEverything(state, "position_kept") : [] });
  }

  let agent = null;
  try {
    agent = await usableAgent(signerMod, address, info);
  } catch (err) {
    console.error(`[outcome-xyz] venue trading key unavailable: ${err?.code ?? ""} ${err?.message ?? err}`);
  }
  if (!agent) return withdrawResult(mode, { kept: keptEverything(state, "refused") });

  const { assetIdOf, formatPrice } = deps.sdk ?? (await sdkHelpers());
  const trap = pendingTrap();
  const exchange = deps.exchange ?? (await agentExchange(agent, trap));
  const cancelled = await cancelOrders(exchange, state.orders, assetIdOf);
  if (mode === "cash") {
    const positions = state.balances.map((b) => ({ key: `spot:${b.coin}`, title: b.title, valueUsd: markUsd(b) ?? 0, reason: "position_kept" }));
    return withdrawResult(mode, { moved: cancelled.moved, kept: [...cancelled.kept, ...positions] });
  }
  let balances = state.balances;
  if (state.orders.length > 0) {
    try {
      balances = (await readOutcomeState(address, { info })).balances;
    } catch {
      balances = state.balances;
    }
  }
  const sold = await sellAll({ balances, agent, trap, exchange, address, walletId, info, assetIdOf, formatPrice, now });
  return withdrawResult(mode, { moved: [...cancelled.moved, ...sold.moved], kept: [...cancelled.kept, ...sold.kept] });
}

export async function runVenue(argv, deps = {}) {
  const sub = argv[0];
  if (sub !== "precheck" && sub !== "withdraw") {
    return { code: 2, out: unreadablePrecheck(`unknown subcommand ${sub ?? ""}`.trim()) };
  }
  let args;
  try {
    args = parseArgs(argv.slice(1), ARG_SPEC);
    if (!args.address) throw new SkillError("BAD_ARGS", "--address is required");
    if (sub === "precheck" && (args.all || args.cash)) throw new SkillError("BAD_ARGS", "precheck takes no --all or --cash");
    if (sub === "withdraw" && args.all === args.cash) throw new SkillError("BAD_ARGS", "withdraw needs exactly one of --all or --cash");
    if (sub === "withdraw" && !args.walletid) throw new SkillError("BAD_ARGS", "--walletid is required");
  } catch (err) {
    const reason = String(err?.message ?? err);
    if (sub === "precheck") return { code: 2, out: unreadablePrecheck(reason) };
    return { code: 2, out: withdrawResult(argv.includes("--cash") ? "cash" : "all", { kept: [{ key: "args", title: "Outcome teardown", valueUsd: 0, reason: "refused" }] }) };
  }
  if (sub === "precheck") return { code: 0, out: await precheck({ address: args.address }, deps) };
  const mode = args.all ? "all" : "cash";
  return { code: 0, out: await withdraw({ walletId: args.walletid, address: args.address, mode }, deps) };
}

function invokedDirectly() {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  console.log = (...a) => console.error(...a);
  console.info = (...a) => console.error(...a);
  let result;
  try {
    result = await runVenue(process.argv.slice(2));
  } catch (err) {
    if (process.env.SKILL_DEBUG) console.error(err);
    const failed = process.argv[2] === "withdraw"
      ? withdrawResult(process.argv.includes("--cash") ? "cash" : "all", { kept: [{ key: "venue", title: "Outcome", valueUsd: 0, reason: "unreadable" }] })
      : unreadablePrecheck(`unexpected: ${err?.message ?? err}`);
    result = { code: 1, out: failed };
  }
  stdoutWrite(toJson(result.out) + "\n");
  process.exitCode = result.code;
}
