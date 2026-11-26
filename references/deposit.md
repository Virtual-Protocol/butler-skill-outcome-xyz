# Moving USDC into and out of Hyperliquid

## How much arrives

- **acp's move**: the bridge keeps about 0.2 USDC, and the USDC arrives as a Hyperliquid
  `send` (ledger type `send`, from the bridge's address), not a Bridge2 deposit, so the Bridge2
  5 USDC floor does not apply to it. The **first** acp deposit into a wallet that never held
  funds on Hyperliquid loses about 1 USDC more, likely Hyperliquid's fee on a send to a new
  address (seen live: 5.5 sent, 4.279 credited; the cause is not verified). So size the first
  deposit so the bets still fit after it: **at least bets + 1.5**; later ones at least bets +
  0.3. Never send less than 5.5 (`MIN_ACP_DEPOSIT_USDC`, a conservative floor kept mostly for
  parity with the Bridge2 fallback). `status.mjs`'s `next.depositCommand` does this sizing
  (`next.acpSendUsdc`, `next.firstDeposit`, `next.creditNote`).
- **`deposit.mjs` (Bridge2)**: Hyperliquid credits nothing under **5 USDC**; a smaller deposit
  is lost. It moves the exact amount (gas is separate), so ≥ 5 is enough.

## When to continue

Continue as soon as `status.mjs` shows the Hyperliquid total covering the next step's need
(`--need`). Never wait for the full amount sent: fees mean it never arrives in full.

## Preferred: acp's aggregated move (SKILL.md step 2)

`acp trade --token-in usdc --amount-in <usd> --token-out usdc --chain-out 1337` with this
step's `--idempotency-key` and `--json`.

- `1337` is Hyperliquid in acp (not HyperEVM `999`). The platform pulls USDC from any of the
  wallet's chains, bridges as needed, and credits the **signing wallet's own** Hyperliquid
  account: in chat the owner's wallet, in a duty with its own wallet the duty wallet.
- Never pass `--recipient` for this deposit: with a recipient the USDC goes to someone else's
  Hyperliquid account.
- `Trade accepted` means it is executing, not done. Run `status.mjs` until the Hyperliquid
  total covers the next step's need (usually under a minute); never file a second deposit
  meanwhile.
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
