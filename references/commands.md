# Script reference

Every script is `node "${BEVO_SKILLS_DIR:-$HOME/skills}/prediction-market/scripts/<name>.mjs"`.
Run them only after the one-time `npm ci` in `SKILL.md`. Flags are `--name value`,
`--name=value` or a bare boolean `--flag`; an unknown flag, a positional argument or a flag
given twice is refused with `BAD_ARGS` (exit code 2). Any other failure exits 1, success 0.

## Output envelope

Exactly one JSON object on stdout (diagnostics go to stderr, never a key):

```json
{ "ok": true, "status": "done", "data": { }, "error": null, "idempotencyKey": "pm-bet-20261119-1033" }
{ "ok": false, "status": "error", "data": null, "error": { "code": "NEEDS_SPOT", "message": "...", "hint": "..." }, "idempotencyKey": "pm-bet-20261119-1033" }
```

- `idempotencyKey` is echoed on every output of a money script (absent on read-only ones).
- Time: every script prints its JSON within ~110 s (`SCRIPT_BUDGET_MS` in
  `scripts/lib/common.mjs`), under the 120 s container command limit. Owner-card waits, the
  deposit receipt/credit wait and the agent confirm poll all share that budget.

- `status` is the state to act on; `error.code` says why a run failed. `error.hint` is a
  one-line next step written for you.
- Some failures carry a non-`error` status so you can route on it: `needs_agent`
  (`AGENT_INVALID`), `needs_deposit` (`NEEDS_DEPOSIT`), `needs_spot` (`NEEDS_SPOT`).
- An owner wait is either `pending_owner_signature` (`ok: true`, resumable) or
  `authorization_timeout` (`ok: false`, code `AUTHORIZATION_TIMEOUT`, not resumable: a wallet
  signature asked inside a script that has no `--resume`).
  Both carry `data.kind`, `data.key`, `data.route`, `data.approvalId`.

## Flags shared by every signing script

| Flag | Meaning |
| --- | --- |
| `--idempotency-key <key>` | Base key for this errand, `[A-Za-z0-9][A-Za-z0-9:_.-]{0,119}`. **Required** (`IDEMPOTENCY_KEY_REQUIRED` without it); only the local dev signer generates one. New key for every new ask. The signer derives one sub-key per signature (`<key>:1`, `<key>:2`). |
| `--resume <key>` | deposit, setup_agent, revoke_agent and withdraw only: finish a step that is waiting on a signature card (withdraw also after `WITHDRAW_UNKNOWN`). Cannot be combined with a different `--idempotency-key`, or with `--rotate`. |

## Read-only

### status.mjs

`[--need <usd>] [--address <wallet>]`

`--need` is the USD the next order needs (default 2, the order minimum). `--address` reads
any wallet with no signer and skips the trading-key check.

`status` is the decision, copied from `data.next.status`: `ready`, `needs_deposit`,
`needs_agent`, `needs_spot`. Data:

- `mainWallet`: the account's address (the owner's Butler wallet or the duty's wallet).
- `walletScope`: `duty` or `main`, which wallet the server picked (also on `account.mjs`).
- `agent`: this skill's trading key: `address`, `code` (`AGENT_OK`, `AGENT_EXPIRING`,
  `AGENT_INVALID`, or `VAULT_UNAVAILABLE` when the vault cannot be read), `valid`, `reason`, `name`, `validUntilIso`, `daysLeft`,
  `expiringSoon` (< 14 days), `mustRotate` (< 7 days), `everCreated` (a key was ever
  stored), `roleSeen`/`roleUser` (Hyperliquid's view of the key), `vaultState` (`"pending"`
  when the vault is not restored on this Butler yet: no key here, so `needs_agent` with
  `AGENT_INVALID` and `next.vaultState`; run `setup_agent.mjs`, never wait). `null` with
  `--address`.
- `allAgents`: every agent the wallet has approved on Hyperliquid (max 3 named), each with
  `ours` (listed under this skill's agent name) and `placeholder` (ours while no key is stored
  here: the throwaway a revoke left, replaced by the next setup; false while the vault is
  pending or unreadable).
- `hyperliquid`: `role` (`missing` = never deposited), `abstraction`, `unified`,
  `spotUsdcFree`, `spotUsdcHold` (locked in open orders), `perpsWithdrawable`,
  `perpsAccountValue`.
- `arbitrum`: `usdc`, `eth` of the wallet on Arbitrum, or `{error}`.
- `next`: `{status, reason}` plus, per status: `suggestedDepositUsdc` and
  `arbitrumUsdcEnough` (needs_deposit), `code` and `rotate` (needs_agent),
  `suggestedSpotAmount` (needs_spot), `code: "AGENT_EXPIRING"` (ready but renew soon).
  `rotate` is true only for an expiring key (`needs_agent` with `AGENT_EXPIRING`).

Order of checks: funds on Hyperliquid (`needs_deposit`), then key (`needs_agent`), then spot
balance (`needs_spot`), then a key with < 7 days left (`needs_agent`, `AGENT_EXPIRING`).

### markets.mjs

`[--query "<words>"] [--venue out|all|<venue>] [--type <type>] [--limit 30]` or `--id <marketId>`

- `--query`: every word must appear (case-insensitive) in the market's name, question,
  description or side names. Use the obvious short word ("btc", "fed", "lakers").
- `--venue`: default `out` = Outcome.xyz's own markets; `all` = every HIP-4 deployer, or a
  venue name. The list echoes `venue`.
- `--type`: `defaultBinary`, `labelledBinary`, `multiOutcome`, `priceBucket`.
- Fallback outcomes of multi-outcome questions are never listed (no order book).

List rows: `id` (the market id for every other script), `type`, `venue`, `name`,
`question` (multi-outcome), `expiry` (ISO, UTC), `underlying`, `threshold`, `bucket`, and
`sides[]` with `outcome` (`YES` = side 0, `NO` = side 1), `name`, `coin`, `mid`.
`--id` adds `bestBid`, `bestAsk` and the top 5 `book` levels per side (`{price, size}`,
size in shares). A market no longer live but settled returns
`market: {settled: true, settleFraction}`; neither → `MARKET_NOT_FOUND`.

### account.mjs

`[--days 7] [--address <wallet>]` (days 1–30)

- `spotUsdcFree`, `spotUsdcHold`.
- `positions[]`: `marketId`, `market`, `outcome` (YES/NO), `side` (name), `shares`,
  `avgCost`, `currentPrice` (mid), `unrealizedPnl`, `payoutIfWins` (= shares x $1).
- `openOrders[]`: `orderId`, `marketId`, `market`, `outcome`, `side` (buy/sell),
  `price`, `size`, `placedAt`.
- `recentFills[]` (max 20, newest first): `marketId`, `market`, `outcome`, `side`, `price`,
  `size`, `fee`, `orderId`, `time`; fills of a settled market also carry `question`, `settled: true`.
- `settled[]`: markets you traded or hold that have settled: `marketId`, `name` and
  `question` (readable, never `template:...`; `null` if unknown), `yesPayout` (what one YES
  share paid, `"1"`, `"0"`, or a fraction such as `"0.5"`).

## Money-moving

### deposit.mjs (wallet signature: card on the main wallet)

`--amount <usdc> [--idempotency-key <key>]` or `--resume <key>`

Checks: amount ≥ 5 and native USDC on Arbitrum. Gas: in production the paymaster takes
Arbitrum gas in USDC, so the wallet needs amount + 0.5 USDC (`NEEDS_HEADROOM`); with the
local dev signer it needs ETH instead (`NEEDS_GAS`). Sends one USDC transfer to
Hyperliquid's bridge, waits briefly for the receipt (≤ 45 s) and the credit (≤ 40 s),
within the script budget, then answers `deposit_pending` rather than polling for minutes.
The step is saved under the key before signing, so `--resume <key>` repeats the same signer
call and never sends a second transfer.

- `done`: `amountUsdc`, `txHash`, `arbiscan`, `credit` (`via: ledger|balance`).
- `deposit_pending`: sent (or accepted by the signer) but not yet credited. Run status.mjs
  in a minute; `resume` re-checks under the same key. Never start a new deposit.
- `pending_owner_signature`: the card is waiting; `data.resume` finishes it.
- Errors: `AMOUNT_BELOW_MINIMUM`, `INSUFFICIENT_USDC`, `NEEDS_HEADROOM`, `NEEDS_GAS` (dev), `DEPOSIT_TX_FAILED`,
  `RESUME_NOT_FOUND`, `RESUME_MISMATCH` (other wallet or amount), `DEV_CAP_EXCEEDED`.

### setup_agent.mjs (wallet signature: card on the main wallet, none in a duty's own live wallet)

`[--rotate] [--idempotency-key <key>]` or `--resume <key>`

- Refuses a wallet that never deposited (`NEEDS_DEPOSIT`, status `needs_deposit`).
- Without `--rotate`: a stored key that Hyperliquid lists as valid → `done` with
  `alreadyApproved: true` (nothing signed). No stored key, or one Hyperliquid no longer lists
  → a fresh key is saved in the vault, then approved with one ApproveAgent signature.
- `--rotate`: always a fresh key, replacing the stored one at once. If the owner never signs,
  there is no working key until they do.
- Two runs at once: the loser adopts the winner's key (`alreadyApproved: true`,
  `generated: false`) once Hyperliquid lists it, else `AGENT_SETUP_IN_PROGRESS`.
- After submitting, waits up to 30 s (less if the script budget is nearly used) for
  Hyperliquid to list the key; otherwise `AGENT_APPROVAL_UNCONFIRMED`.
- `done`: `agentAddress`, `agentName`, `validUntilIso`, `daysLeft`, `generated` (this run made the key; false on `--resume`), `resumed`.
- Errors: `NEEDS_DEPOSIT`, `APPROVE_FAILED` (`data.raw` is Hyperliquid's text),
  `AGENT_APPROVAL_UNCONFIRMED`, `AGENT_SETUP_IN_PROGRESS`, `VAULT_UNAVAILABLE`,
  `VAULT_FULL`, `RESUME_NOT_FOUND`, `RESUME_MISMATCH` (the key changed since; status `needs_agent`).

### revoke_agent.mjs (wallet signature, like setup_agent.mjs)

`--idempotency-key <key>` or `--resume <key>`

Deletes the stored key from the vault, then approves a throwaway address under the same agent
name so Hyperliquid drops the old key, and waits until the old address is gone from
`extraAgents`. No stored key → `done` with `revoked: false` (plus `vaultState: "pending"`
when the vault is not restored here). The step is saved before signing
(the key is already gone from the vault by then): `--resume <key>` finishes it.

- `done`: `revoked`, `goneFromHyperliquid`, `oldAgentAddress`, `agentName`, `resumed`.
- `pending_owner_signature`: the card is waiting; `data.resume` finishes it.
- Errors: `APPROVE_FAILED` (the key is already gone from the vault; run status),
  `VAULT_UNAVAILABLE`, `RESUME_NOT_FOUND`.

### ensure_spot.mjs (trading key, no wallet signature)

`--amount <usd> [--idempotency-key <key>]`

Makes spot USDC ≥ amount by moving only the gap (rounded up to cents) from perps to spot of
the SAME account. On a unified account it moves nothing. Re-reads the balance first, so it
never moves more than the gap.

- `done`: `moved` (0 when nothing was needed), `spotUsdcFree`, `perpsWithdrawable`.
- Errors: `NEEDS_DEPOSIT` (perps + spot < amount), `AGENT_INVALID`, mapped exchange codes,
  `authorization_timeout`.

### ensure_perps.mjs (trading key, no wallet signature)

`--amount <usd> [--idempotency-key <key>]`

Mirror of `ensure_spot.mjs`: makes the perps balance (`perpsWithdrawable`, what a
withdrawal pays out of) ≥ amount by moving only the gap (rounded up to cents) from spot to
perps of the SAME account. On a unified account it moves nothing. Not resumable.

- `done`: `moved` (0 when nothing was needed), `spotUsdcFree`, `perpsWithdrawable`.
- Errors: `INSUFFICIENT_HL_BALANCE` (spot + perps < amount), `AGENT_INVALID`, mapped
  exchange codes, `authorization_timeout`.

### withdraw.mjs (wallet signature: card on the main wallet)

`--amount <usdc> | --all [--idempotency-key <key>]` or `--resume <key>`

Withdraws USDC from Hyperliquid to Arbitrum, always to the signing wallet itself: there is
no destination flag, and the signer refuses any other destination. The trading key cannot
withdraw. Minimum 2 USDC; Hyperliquid takes a flat 1 USDC fee out of the amount
(`receiveUsdc = amount - 1`; both figures to be confirmed by a live test). The USDC lands on
Arbitrum in about 5 minutes. A live duty with its own wallet signs with no card.

- Exactly one of `--amount` and `--all` (`BAD_ARGS` otherwise). `--all` takes everything
  the account can pay out (perps plus free spot), floored to cents; USDC held in open
  orders is not included.
- Hyperliquid pays out of perps. A standard account whose money sits in spot answers
  `needs_perps` (nothing signed): run `ensure_perps.mjs --amount <data.amountUsdc>`, then
  this script again. A unified account has one balance and never needs it.
- The step is saved (amount and nonce) before signing. `--resume <key>` rebuilds the same
  signature request, looks for the withdrawal in Hyperliquid's ledger by nonce first, and
  only sends when it is absent, so it can never withdraw twice.
- `withdraw_pending`: `amountUsdc`, `feeUsdc`, `receiveUsdc`, `hlConfirmed` (the ledger
  already shows it), `arrivesInMinutes` (5), `destination`. The USDC is not on Arbitrum yet:
  run status.mjs until `arbitrum.usdc` shows it.
- `needs_perps`: `amountUsdc`, `receiveUsdc`, `gap`, `spotUsdcFree`, `perpsWithdrawable`.
- `pending_owner_signature`: the card is waiting; `data.resume` finishes it.
- Errors: `AMOUNT_BELOW_MINIMUM`, `INSUFFICIENT_HL_BALANCE`, `NOTHING_TO_WITHDRAW`,
  `WITHDRAW_REFUSED` (`data.raw` is Hyperliquid's text; nothing was withdrawn),
  `WITHDRAW_ALREADY_SUBMITTED` (the nonce is already used: do not withdraw again),
  `WITHDRAW_UNKNOWN` (transport failure; may have gone through: `--resume`), `RESUME_NOT_FOUND`,
  `RESUME_MISMATCH`, `SIGN_TYPE_REFUSED` (signer refused the typed data), `DEV_CAP_EXCEEDED`.

### place_bet.mjs (trading key, no wallet signature)

`--market <id> --outcome YES|NO|<side name> --side buy|sell --size <shares> --price <p>
[--tif GTC|ALO|FAK] [--idempotency-key <key>]`

- `--size` whole shares; `--price` 0 < p < 1, at most 5 decimals; `size x price ≥ 2`.
- `--tif`: `GTC` (default, rests until filled or cancelled), `FAK` (fill what you can now,
  cancel the rest), `ALO` (post-only: refused if it would fill at once).
- `--type` other than `limit`, or no `--price` → `MARKET_ORDER_REFUSED`.
- Pre-checks: market live and not a fallback; key valid; buy → spot USDC ≥ cost; sell →
  enough free shares.
- `done`: `market`, `outcome`, `sideName`, `side`, `size`, `price`, `notional`, `tif`,
  `orderId`, `orderStatus` (`filled` or `resting`), `filledShares` (when filled),
  `agentHealth`, `cloid`.
- Idempotency: the order carries a Hyperliquid client order id (`cloid`) derived from the
  `--idempotency-key`, so the same key always means the same order. Before anything else the
  script asks Hyperliquid (`orderStatus`) for that cloid; if the venue knows it (open, filled,
  cancelled or rejected) the script stops with `KEY_REUSED` (`data.venueStatus`, `data.cloid`)
  and sends nothing. A submit that Hyperliquid refuses as a duplicate cloid is `KEY_REUSED`
  too. So after `ORDER_UNKNOWN` or a run cut off with no JSON, re-running with the SAME key is
  safe; a new key is a new order.
- Errors: `BAD_ARGS`, `MARKET_ORDER_REFUSED`, `ORDER_BELOW_MINIMUM`, `MARKET_NOT_FOUND`,
  `MARKET_SETTLED`, `MARKET_NOT_TRADABLE`, `AGENT_INVALID`, `NEEDS_SPOT`,
  `INSUFFICIENT_SHARES`, `KEY_REUSED`, `ORDER_INVALID` (SDK refused, nothing sent),
  `ORDER_UNKNOWN` (may have reached Hyperliquid; `data.cloid`), exchange codes below,
  `authorization_timeout`.

### cancel.mjs (trading key, no wallet signature)

`--order-id <oid> | --all [--market <id>] [--idempotency-key <key>]`

Cancels open outcome orders only (other Hyperliquid orders are never touched).
`done`: `cancelled[]`, `failed[]` (`{orderId, error}`) and `alreadyDone`; `--all` with
nothing open → `done` with `cancelled: []`. Idempotent by nature: an `--order-id` that
Hyperliquid reports as already cancelled or filled (`orderStatus`), or a cancel answered
"already canceled, or filled", is `done` with `alreadyDone: true` (`venueStatus` or
`alreadyDoneOrders[]`), never an error. Errors: `ORDER_NOT_FOUND` (unknown to Hyperliquid,
or open in another market), `AGENT_INVALID`, exchange codes.

## Exchange codes (Hyperliquid's free-text answers, mapped)

| Code | Hyperliquid said |
| --- | --- |
| `AGENT_INVALID` | "User or API Wallet ... does not exist" |
| `NEEDS_DEPOSIT` | "Must deposit before performing actions" |
| `INSUFFICIENT_BALANCE` | "Insufficient spot balance", "insufficient balance", "Insufficient margin" |
| `UNIFIED_ACCOUNT` | "Action disabled when unified account is active" |
| `BAD_PRICE` | "Price must be divisible by tick size", "Invalid price" |
| `EXCHANGE_ERROR` | anything else (never treated as a bad key) |

This mapping applies ONLY to Hyperliquid /exchange answers, never to signer or server
errors (a signer message containing "does not exist" is not `AGENT_INVALID`).

Other codes: `HL_UNREACHABLE` / `HL_INFO_FAILED` (Hyperliquid info API down),
`SIGNER_NOT_CONFIGURED` (no signer in this environment), `IDEMPOTENCY_KEY_REQUIRED`,
`OWNER_DECLINED` (the signer reported `approval_rejected` / `approval_expired`: the owner
declined or let the card expire; nothing ran), `UNEXPECTED` (unknown failure: read state
before anything), and every other signer/server code passed through, normalised to
UPPER_SNAKE (`key_reused` → `KEY_REUSED`: this idempotency key already ran; for
`place_bet` the venue already holds this key's order).
`AUTHORIZATION_TIMEOUT` hint: re-place only if the owner still wants it, with a NEW key.
