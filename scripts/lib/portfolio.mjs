import { SkillError, createHip4, readHlBalances, outcomeCatalog, round6, num } from "./common.mjs";

export const MAX_POSITIONS = 50;
export const MAX_ORDERS = 50;
export const FILLS_LOOKBACK_START_MS = 0;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function readAddress(args) {
  if (args.address !== undefined) return args.address;
  if (args.wallet !== undefined) return args.wallet;
  throw new SkillError("BAD_ARGS", "--address is required");
}

export function assertWallet(wallet) {
  if (!ADDRESS_RE.test(String(wallet ?? ""))) throw new SkillError("BAD_ARGS", "--address must be a 0x address");
  return wallet;
}

export function mapVenueError(err) {
  if (err instanceof SkillError && err.code === "BAD_ARGS") return err;
  const text = `${err?.code ?? ""} ${err?.message ?? err}`;
  const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status);
  if (status === 429 || /\b429\b|rate.?limit/i.test(text)) {
    return new SkillError("RATE_LIMITED", "Hyperliquid rate-limited the read.", { hint: "Retry in a few minutes." });
  }
  if ((status >= 500 && status < 600) || /\b5\d\d\b|HL_UNREACHABLE|fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|timed? ?out|network|socket/i.test(text)) {
    return new SkillError("VENUE_DOWN", "Hyperliquid could not be reached.", { hint: "Retry in a few minutes." });
  }
  return new SkillError("UNEXPECTED", String(err?.message ?? err).slice(0, 200));
}

async function withHip4(deps, fn) {
  if (deps?.hip4) return fn(deps.hip4);
  const hip4 = await createHip4();
  try {
    return await fn(hip4);
  } finally {
    hip4.destroy();
  }
}

async function loadParseSideCoin(deps) {
  if (deps?.parseSideCoin) return deps.parseSideCoin;
  return (await import("@outcome.xyz/hip4")).parseSideCoin;
}

async function catalogFor(hip4, deps) {
  const parseSideCoin = await loadParseSideCoin(deps);
  const markets = await hip4.events.fetchMarkets();
  return outcomeCatalog(markets, parseSideCoin);
}


export function toPosition(p, describe) {
  const size = num(p.shares) ?? 0;
  const avg = num(p.avgCost);
  const mark = num(p.currentPrice);
  const entryPrice = avg !== null && avg > 0 ? avg : null;
  const markPrice = mark !== null && mark > 0 ? mark : null;
  const meta = describe ? describe(p.outcome) : { market: null, outcome: null };
  const coin = `#${String(p.outcome).slice(1)}`;
  const details = [{ label: "Coin", value: coin }];
  const payout = num(p.potentialPayout);
  if (payout !== null) details.push({ label: "Pays if it wins (USD)", value: String(payout) });
  return {
    id: coin,
    market: String(p.parsedMarketQuestion || p.marketQuestion || meta.market || p.parsedEventTitle || p.eventTitle || coin),
    outcome: meta.outcome ?? null,
    side: String(p.parsedOutcomeName || p.outcomeName || meta.side || meta.outcome || ""),
    size,
    unit: "shares",
    entryPrice,
    markPrice,
    valueUsd: markPrice !== null ? round6(size * markPrice) : null,
    pnlUsd: entryPrice !== null && markPrice !== null ? round6((markPrice - entryPrice) * size) : null,
    details,
  };
}

export async function getPositions(wallet, deps = {}) {
  assertWallet(wallet);
  return withHip4(deps, async (hip4) => {
    const raw = await hip4.account.fetchPositions(wallet);
    const held = raw.filter((p) => (num(p.shares) ?? 0) > 0);
    const needsNames = held.some((p) => !(p.parsedMarketQuestion || p.marketQuestion));
    const { describe } = needsNames ? await catalogFor(hip4, deps) : outcomeCatalog([], await loadParseSideCoin(deps));
    return held.map((p) => toPosition(p, describe));
  });
}

export async function getOpenOrders(wallet, deps = {}) {
  assertWallet(wallet);
  return withHip4(deps, async (hip4) => {
    const raw = await hip4.account.fetchOpenOrders(wallet);
    const { isOutcomeCoin, describe } = await catalogFor(hip4, deps);
    return raw
      .filter((o) => isOutcomeCoin(o.coin))
      .map((o) => {
        const meta = describe(o.coin);
        const price = num(o.limitPx);
        const size = num(o.sz) ?? 0;
        const buy = o.side === "B";
        return {
          id: String(o.oid),
          market: String(meta.market ?? o.coin),
          outcome: meta.outcome ?? null,
          side: buy ? "buy" : "sell",
          type: "limit",
          price,
          size,
          unit: "shares",
          filled: null,
          reservedUsd: buy && price !== null ? round6(price * size) : null,
          placedAt: Number.isFinite(Number(o.timestamp)) ? new Date(Number(o.timestamp)).toISOString() : null,
        };
      });
  });
}

export async function getBalances(wallet, deps = {}) {
  assertWallet(wallet);
  const hl = await (deps.readBalances ?? readHlBalances)(wallet);
  return {
    spotUsdcTotal: hl.spotUsdcTotal,
    spotUsdcFree: hl.spotUsdcFree,
    spotUsdcHold: hl.spotUsdcHold,
    perpsWithdrawable: hl.perpsWithdrawable,
  };
}

export async function hasOutcomeHistory(wallet, deps = {}) {
  assertWallet(wallet);
  return withHip4(deps, async (hip4) => {
    const parseSideCoin = await loadParseSideCoin(deps);
    const { isOutcomeCoin } = outcomeCatalog([], parseSideCoin);
    const [orders, fills] = await Promise.all([
      hip4.account.fetchOpenOrders(wallet),
      hip4.client.fetchUserFillsByTime(wallet, FILLS_LOOKBACK_START_MS, Date.now()),
    ]);
    return orders.some((o) => isOutcomeCoin(o.coin)) || fills.some((f) => isOutcomeCoin(f.coin));
  });
}

export function toPortfolio({ wallet, positions, asOf }) {
  const all = Array.isArray(positions) ? positions : [];
  const ranked = [...all].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const valueUsd = round6(Math.max(0, all.reduce((sum, p) => sum + (p.valueUsd ?? 0), 0)));
  return {
    wallet,
    asOf,
    currency: "USD",
    valueUsd,
    availableUsd: null,
    positions: ranked.slice(0, MAX_POSITIONS).map((p) => ({ ...p, details: p.details?.slice(0, 8) })),
    orders: null,
  };
}

export async function readPortfolio(wallet, deps = {}) {
  assertWallet(wallet);
  return withHip4(deps, async (hip4) => {
    const inner = { ...deps, hip4 };
    const positions = await getPositions(wallet, inner);
    if (positions.length === 0 && !(await hasOutcomeHistory(wallet, inner))) return { status: "not_used", data: null };
    return { status: "done", data: toPortfolio({ wallet, positions, asOf: new Date().toISOString() }) };
  });
}
