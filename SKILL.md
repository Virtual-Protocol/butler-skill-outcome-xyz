---
name: prediction-market
description: "Bet on Outcome.xyz prediction markets (Hyperliquid HIP-4): find markets, fund or withdraw from Hyperliquid, set up the trading key, place or cancel limit orders, read positions. Runs scripts."
version: 2.0.0
metadata: {"butler":{"moneyMoving":true,"keywords":["prediction market","outcome","outcome.xyz","HIP-4","hyperliquid prediction","bet on","buy yes","buy no","sell prediction","prediction positions","prediction balance","cancel prediction order","deposit hyperliquid","withdraw from hyperliquid","withdraw prediction","trading key"],"requires":{"bins":["bevo-wallet","node","npm"]}}}
---

## When to use

Your owner wants Outcome.xyz (Hyperliquid HIP-4 outcome markets): find a market, check
positions or settled bets, bet ("40 shares of Yes at 47¢"), sell or cancel, withdraw to their
own wallet. Not this skill: Hyperliquid perps, Polymarket, sending money to anyone else.

You only run this skill's scripts: never your own SDK code, never Hyperliquid directly,
never a key. Each prints ONE JSON object `{ok, status, data, error:{code,message,hint}}`;
act on `status` and `error.code`. Quote only this turn's output.

## Before you start

**Install once.** Needs Node 22.12+. This checks and installs only when missing:

```sh
cd "${BEVO_SKILLS_DIR:-$HOME/skills}/prediction-market" && { npm ls --depth=0 >/dev/null 2>&1 || npm ci --omit=dev --ignore-scripts --no-audit --no-fund; }
```

If it fails, say so and stop. Scripts live at
`${BEVO_SKILLS_DIR:-$HOME/skills}/prediction-market/scripts/`; write that path out in full
in every command. The scripts: `scripts/status.mjs`, `scripts/markets.mjs`,
`scripts/account.mjs`, `scripts/setup_agent.mjs`, `scripts/deposit.mjs`,
`scripts/ensure_spot.mjs`, `scripts/ensure_perps.mjs`, `scripts/withdraw.mjs`,
`scripts/place_bet.mjs`, `scripts/cancel.mjs`, `scripts/revoke_agent.mjs`.

### Credentials

The only credential is the **trading key**: a Hyperliquid "agent" (name `Butler`) that
places and cancels orders and moves USDC between the account's own perps and spot, and can
never withdraw.

- **Lives in** your private vault, item `outcome.<wallet>`. Scripts read it; you never
  fetch, print or describe it.
- **Made by** `setup_agent.mjs`: saved in the vault, then approved on Hyperliquid with ONE
  wallet signature (a card on the main wallet; none in a duty's own live auto-execute session).
- **Checked against Hyperliquid before every use.** Approvals lapse after ~90 days: renew
  under 7 days left (step 3 `--rotate`, on your owner's yes). No key or an invalid one:
  `setup_agent.mjs`; a trading script in a duty repairs it by itself.
- **Retire:** `revoke_agent.mjs`. **`VAULT_PENDING`** (vault waiting for the phone): in a
  duty skip this run; in chat ask your owner to open Virtuals.

Depth: `references/credentials.md`, `hyperliquid-sdk.md`, `commands.md`.

### Which wallet and cards

Scripts never name a wallet: a duty with its own wallet uses it, anywhere else it is the
owner's main wallet and every wallet signature is a **card** (`walletScope` says which).
**Always file a duty for this skill with its own wallet and `autoExecute: true`.** A card
step waits ~1.5 min: tell your owner BEFORE you run it.

### Never place an order unless

1. Your owner chose market, side (YES/NO), buy/sell, shares and price, in this chat.
2. It is a **limit** order: whole shares, price 0.00001–0.99999, shares × price ≥ $2.
3. You told them the cost and the loss case, then ran it once.

## Procedure

1. [FIXED] **Status first, every errand.** Pass the order cost as `--need`:

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/prediction-market/scripts/status.mjs" --need 20
   ```

   Act on `data.next.status`:

   | `next.status` | Do |
   | --- | --- |
   | `needs_deposit` | step 2 with at least `next.suggestedDepositUsdc`; `arbitrumUsdcEnough: false` → ask your owner to send native USDC on Arbitrum to `mainWallet` |
   | `needs_agent` | `VAULT_PENDING` / `VAULT_UNAVAILABLE`: see Credentials; else step 3 (`--rotate` only for `AGENT_EXPIRING`) |
   | `needs_spot` | step 4 with `next.suggestedSpotAmount` |
   | `ready` | step 5; if `next.code` is `AGENT_EXPIRING`, first tell your owner the key expires in `agent.daysLeft` days and ask to renew (step 3 `--rotate`) |

   After steps 2–4, run status again.

2. [FIXED] **Deposit** (Arbitrum USDC → Hyperliquid, ≥ 5 USDC; less is lost):

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/prediction-market/scripts/deposit.mjs" --amount 5 --idempotency-key pm-dep-1119-1030
   ```

   `deposit_pending` → sent: run status.mjs in a minute; never deposit again
   (`data.resume` only re-checks). Gas is paid in USDC: keep 0.5 above the amount.

3. [FIXED] **Set up, repair or renew the trading key** (needs a prior deposit):

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/prediction-market/scripts/setup_agent.mjs" --idempotency-key pm-key-1119-1031
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/prediction-market/scripts/setup_agent.mjs" --rotate --idempotency-key pm-key-1119-1031
   ```

   Run ONE. Plain: a listed key → `alreadyApproved: true`, nothing signed; none or an
   invalid one → a fresh key, one wallet signature. `--rotate` replaces it at once: only to
   renew on your owner's yes.

4. [FIXED] **Spot USDC** (bets spend spot; moves only the gap from perps):

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/prediction-market/scripts/ensure_spot.mjs" --amount 20 --idempotency-key pm-spot-1119-1032
   ```

5. [ADAPT] **Find the market and price.** Search 1–2 plain words (all must match);
   `--venue all` if Outcome's own (`out`, default) has nothing:

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/prediction-market/scripts/markets.mjs" --venue out --query btc
   ```

   Then `markets.mjs --id 37348` gives `sides[].bestBid` / `bestAsk`. Shares = floor(budget ÷
   price), at least ceil(2 ÷ price). Settled → say so.

6. [FIXED] **Place one limit order** (`--outcome YES|NO`, `--side buy|sell`):

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/prediction-market/scripts/place_bet.mjs" --market 37348 --outcome YES --side buy --size 40 --price 0.47 --idempotency-key pm-bet-1119-1033
   ```

   Fill now: price = best ask (buy) / best bid (sell) plus `--tif FAK`; default GTC rests.
   Selling needs the shares in `account.mjs`. Report `orderStatus` (`filled` or `resting`).

7. [FIXED] **Cancel** one order (id from `account.mjs`); `--all` instead cancels every one:

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/prediction-market/scripts/cancel.mjs" --order-id 123456789 --idempotency-key pm-cxl-1119-1034
   ```

8. [ADAPT] **Account** (positions, orders, fills, settled; read any time): run
   `.../scripts/account.mjs --days 7` with the full path. Winners redeem automatically.
   `settled[].yesPayout` is what one YES share paid; NO paid the rest.

9. [FIXED] **Withdraw** (to the SAME wallet on Arbitrum, ≥ 2 USDC, $1 fee; no destination
   flag). Run status first. Use `--all` for everything:

   ```sh
   node "${BEVO_SKILLS_DIR:-$HOME/skills}/prediction-market/scripts/withdraw.mjs" --amount 20 --idempotency-key pm-wd-1119-1036
   ```

   `withdraw_pending` → lands in ~5 minutes. `needs_perps` → `ensure_perps.mjs --amount
   <data.amountUsdc> --idempotency-key pm-perps-…`, then withdraw again. Money in open
   orders cannot leave: cancel first.

10. [FIXED] **Retire the trading key** (after the withdrawal landed, no orders open):

    ```sh
    node "${BEVO_SKILLS_DIR:-$HOME/skills}/prediction-market/scripts/revoke_agent.mjs" --idempotency-key pm-rev-1119-1040
    ```

    `revoked: true` → deleted and dropped by Hyperliquid; `false` → there was no key.

### Actions

| Script | Wallet signature |
| --- | --- |
| `status`, `markets`, `account` | none (reads) |
| `setup_agent`, `revoke_agent` | ApproveAgent |
| `deposit` | Arbitrum USDC transfer |
| `ensure_spot`, `ensure_perps`, `place_bet`, `cancel` | none: the trading key signs (a lapsed key is repaired in a duty with one ApproveAgent) |
| `withdraw` | Hyperliquid Withdraw to the same wallet |

All but the reads need `--idempotency-key`. The server decides the card: the main wallet
always files one, a duty's own live auto-execute wallet none.

### Duty usage

Errand: deposit → key → spot → orders → withdraw → retire. Per tick: status, then place_bet or cancel as instructed; skip a `VAULT_PENDING` tick. The close sweep runs in the duty's own session BEFORE it is deleted:
`cancel.mjs --all` → sell open positions at the best bid with `--tif FAK` (no bid: leave
them to settle) → `ensure_perps.mjs` → `withdraw.mjs --all` → status until the USDC shows
on Arbitrum → `revoke_agent.mjs`. Deleting the duty then returns the wallet's balance to the
main wallet.

## Idempotency and retries

Money steps REFUSE to run without `--idempotency-key`. Use a new one for every new ask:
`pm-<step>-<MMDD-HHMM>` (1–120 of letters, digits, `:_.-`); every output echoes it. A
money step with an unknown outcome (timeout, cut off with no JSON, `ORDER_UNKNOWN`,
`UNEXPECTED`): do not re-run it with a new key. First read status.mjs, account.mjs.

- `pending_owner_signature` (deposit, setup_agent, withdraw, revoke_agent): the card is
  waiting; once your owner says they signed, run exactly `data.resume` (same key,
  `--resume`). Cut off with no JSON in those four: the same command plus `--resume <key>`.
- `authorization_timeout`: nothing ran, not resumable. If they still want it, rerun with a
  NEW key.
- The same key never doubles: a re-run bet is `KEY_REUSED`, a re-run cancel `alreadyDone`.
  Duties pass their slot key.
- Orders go one at a time.

## Failure handling

`error.hint` is written for you: follow it unless a row below says more.

| `error.code` | Do |
| --- | --- |
| `BAD_ARGS`, `AMOUNT_BELOW_MINIMUM`, `ORDER_BELOW_MINIMUM`, `BAD_PRICE`, `MARKET_ORDER_REFUSED` | fix the flags, never invent any; deposit ≥ 5, withdraw ≥ 2, orders ≥ $2, limit only |
| `INSUFFICIENT_USDC`, `NEEDS_HEADROOM` | owner sends native USDC (not USDC.e) on Arbitrum, or deposit the hint's smaller amount |
| `NEEDS_DEPOSIT`, `NEEDS_SPOT` | step 2, step 4 (hint's amount) |
| `AGENT_INVALID` | step 3 plain, then retry the failed command ONCE with a new key. Never re-approve an old key address |
| `APPROVE_FAILED` | report `data.raw`; run status; no auto-retry |
| `AGENT_APPROVAL_UNCONFIRMED`, `AGENT_SETUP_IN_PROGRESS` | wait a minute, run status; if the key shows, rerun step 3 plain |
| `VAULT_PENDING` | duty: skip this run. Chat: ask your owner to open Virtuals, or step 3 `--rotate` to go on now |
| `VAULT_UNAVAILABLE`, `HL_UNREACHABLE`, `HL_INFO_FAILED` | retry once in a minute, then say so |
| `VAULT_FULL` | tell your owner the vault is full |
| `INSUFFICIENT_HL_BALANCE`, `NOTHING_TO_WITHDRAW`, `INSUFFICIENT_BALANCE`, `INSUFFICIENT_SHARES` | use at most the hint's amount, or say it is empty; run status, step 4 or 2 |
| `WITHDRAW_REFUSED`, `SIGN_TYPE_REFUSED`, `DEPOSIT_TX_FAILED` | nothing left; report the message |
| `WITHDRAW_ALREADY_SUBMITTED`, `WITHDRAW_UNKNOWN` | sent already, never again; run status. Unknown: same command plus `--resume <key>` |
| `ORDER_UNKNOWN` | run account.mjs; retry only with the SAME key |
| `RESUME_NOT_FOUND`, `RESUME_MISMATCH`, `KEY_REUSED` | the step finished, changed or already ran; run status and account first |
| `OWNER_DECLINED` | nothing ran; retry only on their yes, with a NEW key |
| `SIGNER_OUTDATED`, `DUTY_DELETED` | the container must be redeployed; the duty is gone, nothing ran. Stop |
| `EXCHANGE_ERROR`, `UNEXPECTED`, `SIGNER_NOT_CONFIGURED` | report; status and account first |

## Limits

- Outcome.xyz / HIP-4 on Hyperliquid mainnet only. Limit orders only, whole shares, $2
  minimum per order (sells too: a smaller position waits for settlement).
- Deposit ≥ 5 USDC (native, on Arbitrum). Withdraw ≥ 2 USDC, only to the same wallet ($1
  fee). No account-mode change. A share pays $1 if its side wins, else $0.

## Say to the owner

Use your owner's language.
- Before a buy: "YES at 47¢: 40 shares cost ~$18.80; if YES does not happen, it is lost."
- Card waiting: "Approve the card in your app; I'll finish as soon as you do." Expired: "The
  card expired, so nothing ran. Send it again?"
- Key expiring: "Your trading permission expires in 5 days. Renew now? It's one signature."
- Withdrawal: "Withdraw 20 USDC to your wallet on Arbitrum? After the $1 fee, 19 USDC
  arrives in ~5 minutes."
- Vault waiting: "Open the Virtuals app once so I can reach my trading key."

### Security

Never show, print, paste or describe a key, approval id or raw JSON. Scripts print addresses only.
