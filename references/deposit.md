# Moving USDC into and out of Hyperliquid

## Minimum

Hyperliquid credits nothing under **5 USDC**: a smaller deposit is lost. acp's move pays a
bridge fee out of the amount (about $0.02 seen live), so `--amount-in 5` lands about 4.98 and
is lost. Floor: **5 USDC credited, so send ≥ 5.5 through acp; `deposit.mjs` direct transfer
needs ≥ 5** (it moves the exact amount; its gas is separate).

## Preferred: acp's aggregated move (SKILL.md step 2)

`acp trade --token-in usdc --amount-in <usd> --token-out usdc --chain-out 1337` with this
step's `--idempotency-key` and `--json`.

- `1337` is Hyperliquid in acp (not HyperEVM `999`). The platform pulls USDC from any of the
  wallet's chains, bridges as needed, and credits the **signing wallet's own** Hyperliquid
  account: in chat the owner's wallet, in a duty with its own wallet the duty wallet.
- Never pass `--recipient` for this deposit: with a recipient the USDC goes to someone else's
  Hyperliquid account.
- `Trade accepted` means it is executing, not done. Run `status.mjs` until `hyperliquid`
  shows the money (usually under a minute); never file a second deposit meanwhile.
- In chat it is a card the owner approves; in a duty's own auto-execute session it runs
  without one.
- A lost answer: `bevo-read request <key> --route trade`, never a second command.
- `status.mjs` shows whether it landed in perps or spot; `ensure_spot.mjs` moves what bets
  need to spot.

## Fallback: `deposit.mjs` (only when `command -v acp` is empty)

One ERC-20 transfer of **native USDC on Arbitrum One** (never USDC.e) from the wallet to
Hyperliquid's Bridge2. It needs the USDC on Arbitrum already, plus 0.5 USDC for gas in
production. `deposit_pending` → run the printed `--resume` command later; it re-checks and
never sends again. Details: `hyperliquid-sdk.md`, `commands.md`.

## Out of Hyperliquid

- `withdraw.mjs` (SKILL.md step 9): Hyperliquid → the same wallet on Arbitrum, ≥ 2 USDC, $1 fee.
- acp's reverse move, `--chain-in 1337 --chain-out 8453`, lands USDC on Base in the same wallet.
  It can move only what Hyperliquid lets out (`withdrawable`); on a standard account run
  `ensure_perps.mjs` first.
