import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSideCoin } from "@outcome.xyz/hip4";
import { SkillError } from "../scripts/lib/common.mjs";
import { readFileSync } from "node:fs";
import { precheck as precheckVenue, withdraw as withdrawVenue, runVenue, sellPrice, sellCloid, runKeyFor } from "../scripts/venue.mjs";
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

const VENUE_WALLET_ID = "11111111-2222-4333-8444-555555555555";
const AGENT = "0x2222222222222222222222222222222222222222";
const BET_PRICE = { "#291020": "0.5", "#291021": "0.5", "#300010": "0.1" };

function fakeVenueInfo({ balances = [], orders = [], mids = BET_PRICE, books = {}, fail = null } = {}) {
  const state = { balances: balances.map((b) => ({ ...b })), orders: orders.map((o) => ({ ...o })) };
  const calls = [];
  const info = async (body) => {
    calls.push(body.type);
    if (fail) throw fail;
    switch (body.type) {
      case "spotClearinghouseState":
        return { balances: state.balances };
      case "openOrders":
        return state.orders;
      case "allMids":
        return mids;
      case "outcomeMeta":
        return { outcomes: [{ outcome: 29102, name: "Bulgaria v Iceland", sideSpecs: [{ name: "Yes" }, { name: "No" }] }] };
      case "l2Book":
        return { levels: [books[body.coin] ? [{ px: books[body.coin], sz: "1000", n: 1 }] : [], []] };
      case "orderStatus":
        return { status: "unknownOid" };
      case "extraAgents":
        return [{ address: AGENT, name: "Butler", validUntil: Date.now() + 100 * 86_400_000 }];
      case "userRole":
        return { role: "agent", data: { user: WALLET } };
      default:
        throw new Error(`unexpected info ${body.type}`);
    }
  };
  return { info, state, calls };
}

function fakeVenueSigner({ pinned = { walletId: VENUE_WALLET_ID, address: WALLET.toUpperCase().replace("0X", "0x") } } = {}) {
  const calls = { mainSigner: 0, agentKey: [] };
  const mod = {
    SESSION_WALLET_DEFAULT: true,
    AGENT_KEY_STORE: "vault",
    mainSigner: async () => {
      calls.mainSigner++;
      throw new Error("mainSigner must not be called");
    },
    agentKey: async (opts) => {
      calls.agentKey.push(opts);
      return { address: AGENT, toViemAccount: () => ({ address: AGENT, signTypedData: async () => "0x" }) };
    },
  };
  if (pinned !== undefined) mod.pinnedWallet = () => pinned;
  return { mod, calls };
}

function fakeExchange(venue, { fill = () => "all" } = {}) {
  const calls = [];
  const orders = [];
  const target = {
    cancel: async ({ cancels }) => {
      venue.state.orders = venue.state.orders.filter((o) => !cancels.some((c) => c.o === o.oid));
      for (const b of venue.state.balances) b.hold = "0";
      return { response: { data: { statuses: cancels.map(() => "success") } } };
    },
    order: async ({ orders: wires }) => {
      orders.push(...wires);
      const w = wires[0];
      const how = fill(w);
      if (how === "none") {
        const err = new Error("Order could not immediately match against any resting orders.");
        err.name = "ApiRequestError";
        throw err;
      }
      const coin = `+${String(w.a - 1e8)}`;
      const bal = venue.state.balances.find((b) => b.coin === coin);
      const sz = how === "all" ? Number(w.s) : Math.floor(Number(w.s) / 2);
      bal.total = String(Number(bal.total) - sz);
      return { response: { data: { statuses: [{ filled: { oid: 1, totalSz: String(sz), avgPx: w.p } }] } } };
    },
  };
  const exchange = new Proxy(target, {
    get(t, prop) {
      if (typeof prop === "string") calls.push(prop);
      return t[prop];
    },
  });
  return { exchange, calls, orders };
}

const venueSdk = {
  assetIdOf: (coin) => 1e8 + Number(coin.slice(1)),
  formatPrice: (p) => String(Number(p)),
};

function venueDeps(venue, signer, exchange) {
  return { info: venue.info, signerMod: signer.mod, exchange: exchange?.exchange, sdk: venueSdk, now: () => 1_800_000_000_000 };
}

test("venue precheck reports only # bets and their orders, with freeUsd 0", async () => {
  const venue = fakeVenueInfo({
    balances: [
      { coin: "USDC", total: "500", hold: "0" },
      { coin: "HYPE", total: "3", hold: "0" },
      { coin: "+291020", total: "25", hold: "0" },
      { coin: "+300010", total: "10", hold: "0" },
      { coin: "+999990", total: "40", hold: "0" },
    ],
    orders: [
      { coin: "#291021", oid: 77, side: "B", limitPx: "0.4", sz: "10" },
      { coin: "BTC", oid: 78, side: "B", limitPx: "90000", sz: "1" },
      { coin: "@107", oid: 79, side: "A", limitPx: "30", sz: "1" },
    ],
    books: { "#291020": "0.49" },
  });
  const out = await precheckVenue({ address: WALLET }, { info: venue.info });
  assert.equal(out.venue, "outcome");
  assert.equal(out.readable, true);
  assert.equal(out.freeUsd, 0);
  assert.equal(out.inTransitUsd, 0);
  assert.deepEqual(out.positions, [{ key: "spot:#291020", title: "Bulgaria v Iceland (Yes)", valueUsd: 12.5, closable: true }]);
  assert.deepEqual(out.orders, [{ key: "oid:77", title: "Buy 10 Bulgaria v Iceland (No)", reservedUsd: 4 }]);
  assert.deepEqual(out.held, [
    { key: "spot:#300010", title: "Outcome market 30001 (Yes)", valueUsd: 1 },
    { key: "spot:#999990", title: "Outcome market 99999 (Yes)", valueUsd: null },
  ]);
});

test("venue precheck holds a bet worth $2 at mid that sells under $2, or has no bid", async () => {
  const venue = fakeVenueInfo({
    balances: [
      { coin: "+291020", total: "10", hold: "0" },
      { coin: "+291021", total: "30", hold: "0" },
      { coin: "+300010", total: "40", hold: "0" },
    ],
    mids: { "#291020": "0.21", "#291021": "0.5", "#300010": "0.5" },
    books: { "#291020": "0.20", "#300010": "0.48" },
  });
  const out = await precheckVenue({ address: WALLET }, { info: venue.info });
  assert.deepEqual(out.positions, [{ key: "spot:#300010", title: "Outcome market 30001 (Yes)", valueUsd: 20, closable: true }]);
  assert.deepEqual(out.held, [
    { key: "spot:#291020", title: "Bulgaria v Iceland (Yes)", valueUsd: 2.1 },
    { key: "spot:#291021", title: "Bulgaria v Iceland (No)", valueUsd: 15 },
  ]);
  assert.equal(venue.calls.filter((t) => t === "l2Book").length, 3);

  const signer = fakeVenueSigner();
  const ex = fakeExchange(venue);
  const w = await withdrawVenue({ walletId: VENUE_WALLET_ID, address: WALLET, mode: "all" }, venueDeps(venue, signer, ex));
  assert.deepEqual(w.moved.map((m) => m.key), ["spot:#300010"]);
  assert.deepEqual(w.kept.map((k) => [k.key, k.reason]), [["spot:#291020", "below_minimum"], ["spot:#291021", "not_closable"]]);
});

test("venue precheck: a Solana address is readable and empty, an HL error is unreadable", async () => {
  const venue = fakeVenueInfo({ balances: [{ coin: "+291020", total: "25", hold: "0" }] });
  const sol = await precheckVenue({ address: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV" }, { info: venue.info });
  assert.deepEqual(sol, { venue: "outcome", readable: true, reason: null, freeUsd: 0, inTransitUsd: 0, positions: [], orders: [], held: [] });
  assert.equal(venue.calls.length, 0);
  const down = await precheckVenue({ address: WALLET }, fakeVenueInfo({ fail: new SkillError("HL_UNREACHABLE", "fetch failed") }));
  assert.equal(down.readable, false);
  assert.match(down.reason, /fetch failed/);
});

test("venue precheck over the real info client: a 429 is unreadable", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("rate limited", { status: 429 });
  try {
    const out = await runVenue(["precheck", "--walletid", VENUE_WALLET_ID, "--address", WALLET, "--json"]);
    assert.equal(out.code, 0);
    assert.equal(out.out.readable, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("venue precheck imports no installed package", () => {
  const imports = (file) => [...readFileSync(new URL(file, import.meta.url), "utf8").matchAll(/^import [^;]*? from "([^"]+)";/gms)].map((m) => m[1]);
  for (const spec of [...imports("../scripts/venue.mjs"), ...imports("../scripts/lib/common.mjs")]) {
    assert.ok(spec.startsWith("node:") || spec.startsWith("./"), spec);
  }
});

test("venue withdraw refuses an unpinned or mismatched signer and sends nothing", async () => {
  for (const pinned of [undefined, null, { walletId: "other", address: WALLET }, { walletId: VENUE_WALLET_ID, address: AGENT }]) {
    const venue = fakeVenueInfo({ balances: [{ coin: "+291020", total: "25", hold: "0" }], orders: [{ coin: "#291021", oid: 77, side: "B", limitPx: "0.4", sz: "10" }] });
    const signer = fakeVenueSigner({ pinned });
    if (pinned === undefined) delete signer.mod.pinnedWallet;
    const ex = fakeExchange(venue);
    const out = await withdrawVenue({ walletId: VENUE_WALLET_ID, address: WALLET, mode: "all" }, venueDeps(venue, signer, ex));
    assert.deepEqual(out.moved, []);
    assert.deepEqual(out.pending, []);
    assert.deepEqual(out.kept.map((k) => [k.key, k.reason]), [["oid:77", "refused"], ["spot:#291020", "refused"]]);
    assert.deepEqual(ex.calls, []);
    assert.equal(signer.calls.agentKey.length, 0);
    assert.equal(signer.calls.mainSigner, 0);
  }
});

test("venue withdraw --all cancels, sells with Ioc at bid x 0.95, and never calls mainSigner or a transfer", async () => {
  const venue = fakeVenueInfo({
    balances: [
      { coin: "USDC", total: "500", hold: "4" },
      { coin: "+291020", total: "25", hold: "5" },
      { coin: "+291021", total: "30", hold: "0" },
    ],
    orders: [{ coin: "#291020", oid: 77, side: "A", limitPx: "0.6", sz: "5" }],
    books: { "#291020": "0.47", "#291021": "0.5" },
  });
  const signer = fakeVenueSigner();
  const ex = fakeExchange(venue, { fill: (w) => (w.a === 1e8 + 291021 ? "none" : "all") });
  const out = await withdrawVenue({ walletId: VENUE_WALLET_ID, address: WALLET, mode: "all" }, venueDeps(venue, signer, ex));
  assert.equal(signer.calls.mainSigner, 0);
  assert.deepEqual(signer.calls.agentKey.map((o) => [o.label, o.create]), [["outcome", false]]);
  assert.deepEqual([...new Set(ex.calls)].sort(), ["cancel", "order"]);
  assert.equal(ex.orders.length, 2);
  for (const w of ex.orders) {
    assert.deepEqual(w.t, { limit: { tif: "Ioc" } });
    assert.equal(w.b, false);
    assert.equal(w.r, false);
    assert.match(w.c, /^0x[0-9a-f]{32}$/);
  }
  assert.deepEqual(ex.orders.map((w) => [w.a, w.p, w.s]), [[1e8 + 291020, "0.4465", "25"], [1e8 + 291021, "0.475", "30"]]);
  assert.deepEqual(out.moved, [
    { key: "oid:77", title: "Sell 5 Bulgaria v Iceland (Yes)", valueUsd: 0, txHash: null },
    { key: "spot:#291020", title: "Bulgaria v Iceland (Yes)", valueUsd: 11.1625, txHash: null },
  ]);
  assert.deepEqual(out.kept, [{ key: "spot:#291021", title: "Bulgaria v Iceland (No)", valueUsd: 15, reason: "close_failed" }]);
  assert.equal(sellPrice("0.33333"), 0.31666);
});

test("venue withdraw: an under-$2 sell is below_minimum, and a re-run with nothing left is empty", async () => {
  const venue = fakeVenueInfo({ balances: [{ coin: "+291020", total: "3", hold: "0" }, { coin: "+291021", total: "10", hold: "0" }], books: { "#291020": "0.5", "#291021": "0.5" } });
  const signer = fakeVenueSigner();
  const ex = fakeExchange(venue);
  const first = await withdrawVenue({ walletId: VENUE_WALLET_ID, address: WALLET, mode: "all" }, venueDeps(venue, signer, ex));
  assert.deepEqual(first.kept, [{ key: "spot:#291020", title: "Bulgaria v Iceland (Yes)", valueUsd: 1.5, reason: "below_minimum" }]);
  assert.deepEqual(first.moved.map((m) => m.key), ["spot:#291021"]);

  const empty = fakeVenueInfo({ balances: [{ coin: "USDC", total: "20", hold: "0" }] });
  const again = fakeVenueSigner();
  const ex2 = fakeExchange(empty);
  for (const mode of ["all", "cash"]) {
    const out = await withdrawVenue({ walletId: VENUE_WALLET_ID, address: WALLET, mode }, venueDeps(empty, again, ex2));
    assert.deepEqual(out, { venue: "outcome", mode, moved: [], pending: [], kept: [] });
  }
  assert.deepEqual(ex2.calls, []);
  assert.equal(again.calls.mainSigner, 0);
});

test("venue withdraw --cash cancels orders and keeps the bets", async () => {
  const venue = fakeVenueInfo({ balances: [{ coin: "+291020", total: "25", hold: "0" }], orders: [{ coin: "#291021", oid: 77, side: "B", limitPx: "0.4", sz: "10" }] });
  const signer = fakeVenueSigner();
  const ex = fakeExchange(venue);
  const out = await withdrawVenue({ walletId: VENUE_WALLET_ID, address: WALLET, mode: "cash" }, venueDeps(venue, signer, ex));
  assert.deepEqual([...new Set(ex.calls)], ["cancel"]);
  assert.deepEqual(out.moved.map((m) => m.key), ["oid:77"]);
  assert.deepEqual(out.kept, [{ key: "spot:#291020", title: "Bulgaria v Iceland (Yes)", valueUsd: 12.5, reason: "position_kept" }]);
});

test("venue cloids are deterministic per wallet, coin and run", () => {
  const a = sellCloid(VENUE_WALLET_ID, "#291020", runKeyFor(25, 1_800_000_000_000));
  assert.equal(a, sellCloid(VENUE_WALLET_ID, "#291020", runKeyFor(25, 1_800_000_100_000)));
  assert.notEqual(a, sellCloid(VENUE_WALLET_ID, "#291021", runKeyFor(25, 1_800_000_000_000)));
  assert.notEqual(a, sellCloid("other", "#291020", runKeyFor(25, 1_800_000_000_000)));
});
