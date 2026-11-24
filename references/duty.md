# Running this skill in a duty

A duty trades from its own wallet, signs hands-free (`autoExecute: true`) and runs the same
scripts as chat. Read this before filing one.

## Funding the duty wallet

**Default (acp available):** file the duty with its own new wallet (`"wallet": "new"`) and its
built-in funding card (`fundUsdc`, USDC on Base). That is one owner card. Size it at least
5 USDC (Hyperliquid credits nothing less) plus what the duty will bet, plus a small buffer for
the move's fees. The duty's deposit step (SKILL.md step 2, `acp trade … --chain-out 1337`) runs
in the duty's session, so it pulls the duty wallet's USDC from whatever chain holds it (Base
here) into the duty wallet's own Hyperliquid account. No Arbitrum funding is needed.

**Without acp (`command -v acp` is empty):** the fallback `deposit.mjs` only moves native USDC
on Arbitrum One (chain 42161), and the built-in card funds Base. So:

1. Create the wallet: `bevo-wallet create --chain ethereum --label <duty name>` (no card).
2. Fund it on Arbitrum: `bevo-wallet fund --wallet <label> --amount <usd> --token usdc
   --chain-id 42161` with at least 5 USDC plus the bets plus 0.5 USDC for the deposit's gas.
   One owner card.
3. Wait until `bevo-wallet list --fresh` shows the USDC on Arbitrum. A lost answer is checked
   with `bevo-read request <key>`, never by funding again.
4. File the duty bound to it: `"wallet": "<label>"`, `"autoExecute": true`, no `fundUsdc`. A
   wallet holding money files a **bind card**; the duty is held until the owner approves it.

Tell the owner which cards they will see before the first one.

## Which wallet a run uses

Every script prints `walletScope`. Before the first money step of a duty, read it: `duty` is
the duty's own wallet; `main` means the duty is trading the owner's main wallet. In that case
say so in the duty's first note so the owner sees which wallet it uses. Do not refuse: the
container decides the wallet, the skill only reports it.

## Each tick

`status.mjs`, then `place_bet.mjs` or `cancel.mjs` as the owner instructed, each with the
tick's slot key as `--idempotency-key` (a re-fire is then `KEY_REUSED` / `alreadyDone`, never a
second order). A missing or lapsed trading key is repaired by the trading script itself.

## Errand order

deposit → key → spot → orders → withdraw → retire.

## Close sweep (in the duty's own session, BEFORE it is deleted)

1. `cancel.mjs --all`.
2. Sell open positions at the best bid with `--tif FAK` (no bid: leave them to settle).
3. `ensure_perps.mjs --amount <what will be withdrawn>`.
4. `withdraw.mjs --all` (or acp's move out of Hyperliquid, see `deposit.md`), then `status.mjs`
   until the USDC shows.
5. `revoke_agent.mjs`.

Deleting the duty then returns the wallet's balance to the owner's main wallet.
