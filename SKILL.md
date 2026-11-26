---
name: outcome-xyz
description: "Bet on Outcome.xyz prediction markets (Hyperliquid HIP-4): find markets, fund or withdraw from Hyperliquid, set up the trading key, place or cancel limit orders, read positions. Runs scripts."
version: 2.3.1
metadata: {"butler":{"moneyMoving":true,"venue":{"id":"outcomexyz","precheck":["node","scripts/venue.mjs","precheck"],"withdraw":["node","scripts/venue.mjs","withdraw"]},"portfolio":{"script":"scripts/portfolio.mjs","site":"https://outcome.xyz","name":"Outcome","chains":["evm"]},"keywords":["prediction market","outcome","outcome.xyz","HIP-4","hyperliquid prediction","bet on","buy yes","buy no","sell prediction","prediction positions","prediction balance","cancel prediction order","deposit hyperliquid","withdraw from hyperliquid","withdraw prediction","trading key"],"requires":{"bins":["acp","bevo-wallet","node","npm"]}}}
---

## When to use

Your owner wants Outcome.xyz (Hyperliquid HIP-4 outcome markets): find a market, check
positions or settled bets, bet ("40 shares of Yes at 47¢"), sell or cancel, withdraw to their
own wallet. Not this skill: Hyperliquid perps, Polymarket, sending money to anyone else.

You only run this skill's scripts: never your own SDK code, never Hyperliquid directly,
never a key. Each prints ONE JSON object `{ok, status, data, error:{code,message,hint}}`;
act on `status` and `error.code`. `acp … --json` has a different shape (`code` at the top, `error` a sentence): never parse either by hand. Quote only this turn's output.

## Before you start

**Install once.** Needs Node 22.12+. This checks and installs only when missing:

```sh
cd "${BEVO_SKILLS_DIR:-$HOME/skills}/outcome-xyz" && { npm ls --depth=0 >/dev/null 2>&1 || npm ci --omit=dev --ignore-scripts --no-audit --no-fund; }
```

If it fails, say so and stop. Scripts live at
`${BEVO_SKILLS_DIR:-$HOME/skills}/outcome-xyz/scripts/`; write that path out in full
in every command. The scripts: `scripts/status.mjs`, `scripts/markets.mjs`,
`scripts/account.mjs`, `scripts/setup_agent.mjs`, `scripts/deposit.mjs`,
`scripts/ensure_spot.mjs`, `scripts/ensure_perps.mjs`, `scripts/withdraw.mjs`,
`scripts/place_bet.mjs`, `scripts/cancel.mjs`, `scripts/revoke_agent.mjs`,
`scripts/portfolio.mjs`.

### Credentials

The only credential is the **trading key**, a Hyperliquid "agent" (name `Butler`) kept in
your private vault: it places and cancels orders and moves USDC between the account's own
perps and spot, and can never withdraw. Scripts read it; you never fetch, print or describe
it. `setup_agent.mjs` makes it (one wallet signature) and every script checks it against
Hyperliquid first. A vault not restored yet (`vaultState: "pending"`) means no key here:
`setup_agent.mjs` makes a fresh one. Full detail: `references/credentials.md`.

### Which wallet and cards

Scripts never name a wallet: a duty with its own wallet uses it, anywhere else it is the
owner's main wallet and every wallet signature is a **card** (`walletScope` says which).
A card step waits ~1.5 min: tell your owner BEFORE you run it. Per script:
`references/actions.md`.

### Never place an order unless

1. Your owner chose market, side (YES/NO), buy/sell, shares and price, in this chat.
2. It is a **limit** order: whole shares, price 0.00001–0.99999, shares × price ≥ $2.
3. You told them the cost and the loss case, then ran it once.

## Procedure

1. [FIXED] **Status first, every errand.** Pass the order cost as `--need`:

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/outcome-xyz/scripts/status.mjs" --need 20
   ```

   `data.next.status`: `needs_deposit` → step 2 with `next.suggestedDepositUsdc`;
   `needs_agent` → step 3 (`--rotate` only for `AGENT_EXPIRING`; `VAULT_UNAVAILABLE`: retry in
   a minute); `needs_spot` → step 4 with `next.suggestedSpotAmount`; `ready` → step 5 (if
   `next.code` is `AGENT_EXPIRING`, first ask to renew). After steps 2–4, status again.

2. [FIXED] **Deposit** with acp (USDC from any of this wallet's chains into its own
   Hyperliquid account; never add `--recipient`). It credits about the amount − 0.2; the
   FIRST deposit into a wallet new to Hyperliquid likely loses ~1 more, so send ≥ bets + 1.5
   (`next.depositCommand` sizes it; never under 5.5):

   ```sh
   acp trade --token-in usdc --amount-in 5.5 --token-out usdc --chain-out 1337 --idempotency-key pm-dep-1119-1030 --json
   ```

   `Trade accepted` → status until Hyperliquid covers the next step's need (never wait for
   the full amount sent); never deposit again. No `acp` (`command -v acp`
   empty): `deposit.mjs --amount 5` (direct transfer, ≥ 5; Arbitrum USDC only,
   `references/deposit.md`).

3. [FIXED] **Set up, repair or renew the trading key** (needs a prior deposit):

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/outcome-xyz/scripts/setup_agent.mjs" --idempotency-key pm-key-1119-1031
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/outcome-xyz/scripts/setup_agent.mjs" --rotate --idempotency-key pm-key-1119-1031
   ```

   Run ONE. Plain: a listed key → `alreadyApproved: true`; none or invalid → a fresh key, one
   wallet signature. `--rotate` replaces it at once: only to renew on your owner's yes.

4. [FIXED] **Spot USDC** (bets spend spot; moves only the gap from perps):

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/outcome-xyz/scripts/ensure_spot.mjs" --amount 20 --idempotency-key pm-spot-1119-1032
   ```

5. [ADAPT] **Find the market and price.** Search 1–2 plain words; `--venue all` if Outcome's
   own (`out`) has nothing:

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/outcome-xyz/scripts/markets.mjs" --venue out --query btc
   ```

   Then `markets.mjs --id 37348` gives `sides[].bestBid` / `bestAsk`. Shares = floor(budget ÷
   price), at least ceil(2 ÷ price). Settled → say so.

6. [FIXED] **Place one limit order** (`--outcome YES|NO`, `--side buy|sell`):

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/outcome-xyz/scripts/place_bet.mjs" --market 37348 --outcome YES --side buy --size 40 --price 0.47 --idempotency-key pm-bet-1119-1033
   ```

   Fill now: best ask (buy) / best bid (sell) plus `--tif FAK`; default GTC rests. Selling
   needs the shares. Report `orderStatus` (`filled` or `resting`).

7. [FIXED] **Cancel** one order (id from `account.mjs`); `--all` cancels every one:

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/outcome-xyz/scripts/cancel.mjs" --order-id 123456789 --idempotency-key pm-cxl-1119-1034
   ```

8. [ADAPT] **Account** (positions, orders, fills, settled): `.../scripts/account.mjs --days 7`
   with the full path. Winners redeem automatically.

9. [FIXED] **Withdraw** (to the SAME wallet on Arbitrum, ≥ 2 USDC, $1 fee). Status first;
   `--all` for everything:

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/outcome-xyz/scripts/withdraw.mjs" --amount 20 --idempotency-key pm-wd-1119-1036
   ```

   `withdraw_pending` → ~5 minutes. `needs_perps` → `ensure_perps.mjs --amount
   <data.amountUsdc>`, then withdraw again. Cancel open orders first.

10. [FIXED] **Retire the trading key** (withdrawal landed, no orders open):

    ```sh
    node "${BEVO_SKILLS_DIR:-$HOME/skills}/outcome-xyz/scripts/revoke_agent.mjs" --idempotency-key pm-rev-1119-1040
    ```

    A throwaway approval stays under our name (`placeholder: true`) until the next setup
    replaces it; other names (`ours: false`) are not ours.

### Portfolio

Read-only view of one wallet's Outcome bets, as `portfolio/v1`. No signer, no key, nothing
printed but the JSON envelope; the exit code is always 0, so act on `ok` and `status`.
`scripts/portfolio.mjs` composes the exports of `scripts/lib/portfolio.mjs`:
`getPositions(wallet)`, `getOpenOrders(wallet)`, `getBalances(wallet)` and the pure
`toPortfolio({wallet, positions, asOf})`.

| Command | Prints |
|---|---|
| `portfolio.mjs --address 0x...` | the full envelope: bets only, `availableUsd: null`, `orders: null` |
| `portfolio.mjs positions --address 0x...` | the bets held |
| `portfolio.mjs orders --address 0x...` | open Outcome orders (chat only, not in the full portfolio) |
| `portfolio.mjs balances --address 0x...` | Hyperliquid spot USDC (chat only, not in the full portfolio) |

```sh
node "${BEVO_SKILLS_DIR:-$HOME/skills}/outcome-xyz/scripts/portfolio.mjs" --address "$WALLET"
```

The Butler's sync also passes `--walletid <walletId>` for a Butler wallet; the read uses
`--address` only. A lone `--wallet 0x...` (deprecated) still reads that address.

```json
{"ok":true,"status":"done","data":{"wallet":"<the --address address>","asOf":"2026-11-25T10:00:00.000Z","currency":"USD","valueUsd":12.5,"availableUsd":null,"positions":[{"id":"#291020","market":"Bulgaria v Iceland","outcome":"YES","side":"Yes","size":25,"unit":"shares","entryPrice":0.45,"markPrice":0.5,"valueUsd":12.5,"pnlUsd":1.25,"details":[{"label":"Coin","value":"#291020"},{"label":"Pays if it wins (USD)","value":"25"}]}],"orders":null},"error":null}
```

`valueUsd` counts the bets only: shares × mark price (the live mid), for every outcome
held. Cash on Hyperliquid and perps belong to the Hyperliquid read, so they are never in it.
`size` is shares; `outcome` is YES or NO; `side` is the side's name; `entryPrice` and
`pnlUsd` are null when the cost basis is unknown. `status: "not_used"` means the wallet
never held, traded or ordered an outcome. A wallet whose bets all settled is `done` with
`valueUsd: 0`. Errors: `RATE_LIMITED` (HTTP 429), `VENUE_DOWN` (5xx or network),
`UNEXPECTED`, `BAD_ARGS` (not a 0x address).

When your owner asks "my positions on Outcome": run `portfolio.mjs positions --address <their
wallet>` and quote this turn's output; for orders or cash run `orders` or `balances`.

### Duty usage

File it with its own new wallet and `"autoExecute": true` (`references/duty.md`); its funding
card (USDC on Base) is fine, step 2 deposits from any chain. Each tick: status, then place_bet or cancel with the slot key.
`walletScope: "main"` before the first money step: say in the duty's first note that it
trades the owner's main wallet.
Run the close sweep BEFORE the duty is deleted: `references/duty.md`.
Teardown (when a duty wallet is closed): sells every Outcome bet at market and cancels open Outcome orders. The cash stays in the Hyperliquid account for the Butler's own sweep. Run via `scripts/venue.mjs` (precheck / withdraw).

## Idempotency and retries

Money steps REFUSE to run without `--idempotency-key`; a new one for every new ask
(`pm-<step>-<MMDD-HHMM>`). A money step with an unknown outcome (timeout, no JSON,
`ORDER_UNKNOWN`, `UNEXPECTED`): do not re-run it with a new key. First read status.mjs,
account.mjs; a lost acp deposit: `bevo-read request <key> --route trade`.

- `pending_owner_signature` (deposit, setup_agent, withdraw, revoke_agent): once your owner
  signed, run exactly `data.resume`. Cut off with no JSON there: same command plus
  `--resume <key>`.
- `authorization_timeout`: nothing ran. If still wanted, a NEW key.
- The same key never doubles: a re-run bet is `KEY_REUSED`, a re-run cancel `alreadyDone`.
- Orders go one at a time.

## Failure handling

Follow `error.hint`. Never: re-approve an old key address, retry a money step with a new key
after an unknown outcome, or deposit again while one is accepted or `deposit_pending`. `AGENT_INVALID`: step 3,
then retry ONCE with a new key. `OWNER_DECLINED`: nothing ran. Full table: `references/failures.md`.

## Limits

- Outcome.xyz / HIP-4 on Hyperliquid mainnet only. Limit orders only, whole shares, $2
  minimum per order (sells too).
- Deposit: ≥ 5.5 through acp (first one ≥ bets + 1.5); `deposit.mjs` direct transfer ≥ 5. Withdraw ≥ 2 USDC, only to the same wallet ($1
  fee). No account-mode change. A share pays $1 if its side wins, else $0.

## Say to the owner

Use your owner's language.
- Before a buy: "YES at 47¢: 40 shares cost ~$18.80; if YES does not happen, it is lost."
- Card waiting: "Approve the card in your app; I'll finish as soon as you do." Expired: "The
  card expired, so nothing ran. Send it again?"
- Key expiring: "Your trading permission expires in 5 days. Renew now? It's one signature."
- Withdrawal: "Withdraw 20 USDC to your wallet on Arbitrum? After the $1 fee, 19 USDC
  arrives in ~5 minutes."

### Security

Never show, print, paste or describe a key, approval id or raw JSON. Scripts print addresses only.
