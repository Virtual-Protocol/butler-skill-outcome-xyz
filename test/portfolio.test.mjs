import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSideCoin } from "@outcome.xyz/hip4";
import { SkillError } from "../scripts/lib/common.mjs";
import { getPositions, getOpenOrders, getBalances, toPortfolio, readPortfolio, mapVenueError, readAddress } from "../scripts/lib/portfolio.mjs";

const WALLET = "0x1111111111111111111111111111111111111111";
const ASOF = "2026-11-25T10:00:00.000Z";

const MARKETS = [
  {
    outcomeId: 29102,
    name: "Bulgaria v Iceland",
    parsedName: "Bulgaria v Iceland",
    parsedQuestionName: "Who wins?",
    sides: [
      { coin: "#291020", name: "Yes", parsedName: "Yes" },
      { coin: "#291021", name: "No", parsedName: "No" },
    ],
  },
];

const RAW_POSITIONS = [
  {
    marketId: "29102",
    eventTitle: "Match",
    marketQuestion: "Bulgaria v Iceland",
    parsedMarketQuestion: "Bulgaria v Iceland",
    outcome: "#291020",
    outcomeName: "Yes",
    parsedOutcomeName: "Yes",
    shares: "25.000000",
    avgCost: "0.450000",
    currentPrice: "0.5",
    unrealizedPnl: "1.250000",
    potentialPayout: "25.000000",
  },
  {
    marketId: "29102",
    eventTitle: "Match",
    marketQuestion: "Bulgaria v Iceland",
    parsedMarketQuestion: "Bulgaria v Iceland",
    outcome: "#291021",
    outcomeName: "No",
    parsedOutcomeName: "No",
    shares: "10.000000",
    avgCost: "0",
    currentPrice: "0.25",
    unrealizedPnl: "2.5",
    potentialPayout: "10.000000",
  },
];

function fakeHip4({ positions = [], orders = [], fills = [], markets = MARKETS, fail = null } = {}) {
  const guard = (v) => async () => {
    if (fail) throw fail;
    return v;
  };
  return {
    account: { fetchPositions: guard(positions), fetchOpenOrders: guard(orders) },
    events: { fetchMarkets: guard(markets) },
    client: { fetchUserFillsByTime: guard(fills) },
    destroy() {},
  };
}

const deps = (hip4, extra = {}) => ({ hip4, parseSideCoin, ...extra });

function assertCaps(p) {
  assert.equal(p.currency, "USD");
  assert.ok(p.valueUsd >= 0);
  assert.ok(Number.isFinite(Date.parse(p.asOf)));
  assert.ok(p.positions.length <= 50);
  assert.ok(p.orders === null || p.orders.length <= 50);
  for (const pos of p.positions) assert.ok((pos.details ?? []).length <= 8);
}

test("fixture bets map to the exact portfolio/v1 output", async () => {
  const positions = await getPositions(WALLET, deps(fakeHip4({ positions: RAW_POSITIONS })));
  const out = toPortfolio({ wallet: WALLET, positions, asOf: ASOF });
  assert.deepEqual(out, {
    wallet: WALLET,
    asOf: ASOF,
    currency: "USD",
    valueUsd: 15,
    availableUsd: null,
    positions: [
      {
        id: "#291020",
        market: "Bulgaria v Iceland",
        outcome: "YES",
        side: "Yes",
        size: 25,
        unit: "shares",
        entryPrice: 0.45,
        markPrice: 0.5,
        valueUsd: 12.5,
        pnlUsd: 1.25,
        details: [
          { label: "Coin", value: "#291020" },
          { label: "Pays if it wins (USD)", value: "25" },
        ],
      },
      {
        id: "#291021",
        market: "Bulgaria v Iceland",
        outcome: "NO",
        side: "No",
        size: 10,
        unit: "shares",
        entryPrice: null,
        markPrice: 0.25,
        valueUsd: 2.5,
        pnlUsd: null,
        details: [
          { label: "Coin", value: "#291021" },
          { label: "Pays if it wins (USD)", value: "10" },
        ],
      },
    ],
    orders: null,
  });
  assertCaps(out);
});

test("valueUsd sums bets at mark and skips unpriced ones", () => {
  const out = toPortfolio({
    wallet: WALLET,
    asOf: ASOF,
    positions: [
      { id: "a", valueUsd: 3.3 },
      { id: "b", valueUsd: 1.1 },
      { id: "c", valueUsd: null },
    ],
  });
  assert.equal(out.valueUsd, 4.4);
});

test("positions are capped at 50 but the value still counts all bets", () => {
  const positions = Array.from({ length: 60 }, (_, i) => ({ id: `#${i}`, valueUsd: 1, details: [] }));
  const out = toPortfolio({ wallet: WALLET, asOf: ASOF, positions });
  assert.equal(out.positions.length, 50);
  assert.equal(out.valueUsd, 60);
});

test("an empty account that traded before is done with valueUsd 0", async () => {
  const hip4 = fakeHip4({ fills: [{ coin: "#291020" }] });
  const r = await readPortfolio(WALLET, deps(hip4));
  assert.equal(r.status, "done");
  assert.equal(r.data.valueUsd, 0);
  assert.deepEqual(r.data.positions, []);
  assertCaps(r.data);
});

test("a wallet that never touched outcomes is not_used", async () => {
  const hip4 = fakeHip4({ fills: [{ coin: "BTC" }, { coin: "@107" }], orders: [{ coin: "ETH" }] });
  const r = await readPortfolio(WALLET, deps(hip4));
  assert.deepEqual(r, { status: "not_used", data: null });
});

test("held bets are done even with no fills", async () => {
  const r = await readPortfolio(WALLET, deps(fakeHip4({ positions: [RAW_POSITIONS[0]] })));
  assert.equal(r.status, "done");
  assert.equal(r.data.valueUsd, 12.5);
});

test("open outcome orders are mapped and non-outcome orders dropped", async () => {
  const orders = [
    { coin: "#291020", side: "B", limitPx: "0.4", sz: "10", oid: 77, timestamp: 1764064800000 },
    { coin: "#291021", side: "A", limitPx: "0.6", sz: "5", oid: 78, timestamp: 1764064800000 },
    { coin: "BTC", side: "B", limitPx: "1", sz: "1", oid: 79, timestamp: 1764064800000 },
  ];
  const out = await getOpenOrders(WALLET, deps(fakeHip4({ orders })));
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    id: "77",
    market: "Bulgaria v Iceland",
    outcome: "YES",
    side: "buy",
    type: "limit",
    price: 0.4,
    size: 10,
    unit: "shares",
    filled: null,
    reservedUsd: 4,
    placedAt: "2025-11-25T10:00:00.000Z",
  });
  assert.equal(out[1].reservedUsd, null);
  assert.equal(out[1].outcome, "NO");
});

test("balances come from the injected Hyperliquid read", async () => {
  const out = await getBalances(WALLET, {
    readBalances: async () => ({ spotUsdcTotal: 14.74, spotUsdcFree: 14.74, spotUsdcHold: 0, perpsWithdrawable: 0, spotBalances: [{ secret: "x" }] }),
  });
  assert.deepEqual(out, { spotUsdcTotal: 14.74, spotUsdcFree: 14.74, spotUsdcHold: 0, perpsWithdrawable: 0 });
});

test("HTTP 429 maps to RATE_LIMITED", async () => {
  const fail = new SkillError("HL_INFO_FAILED", "HL info spotClearinghouseState responded 429");
  await assert.rejects(readPortfolio(WALLET, deps(fakeHip4({ fail }))).catch((e) => Promise.reject(mapVenueError(e))), (e) => e.code === "RATE_LIMITED");
});

test("5xx and network failures map to VENUE_DOWN", () => {
  assert.equal(mapVenueError(new Error("HL info allMids responded 503")).code, "VENUE_DOWN");
  assert.equal(mapVenueError(new SkillError("HL_UNREACHABLE", "Hyperliquid info API failed: fetch failed")).code, "VENUE_DOWN");
  assert.equal(mapVenueError(Object.assign(new Error("boom"), { status: 502 })).code, "VENUE_DOWN");
});

test("anything else is UNEXPECTED and a bad wallet is BAD_ARGS", async () => {
  assert.equal(mapVenueError(new Error("kaboom")).code, "UNEXPECTED");
  await assert.rejects(getPositions("nope", deps(fakeHip4())), (e) => e.code === "BAD_ARGS");
});

test("reads --address, ignoring a --walletid beside it, and still reads a lone --wallet address", () => {
  assert.equal(readAddress({ walletid: "11111111-2222-4333-8444-555555555555", address: WALLET }), WALLET);
  assert.equal(readAddress({ wallet: WALLET }), WALLET);
  assert.throws(() => readAddress({}), (err) => err instanceof SkillError && err.code === "BAD_ARGS");
});
