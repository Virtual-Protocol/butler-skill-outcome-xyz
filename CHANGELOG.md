# Changelog

## 2.0.0

Breaking: the trading key now lives in the Butler's private vault (item `outcome.<wallet>`), not on
bevo-server. The skill needs a container whose signer exports `AGENT_KEY_STORE = 'vault'`; an
older container stops with `SIGNER_OUTDATED` and must be redeployed first.

- The scripts check the stored key against Hyperliquid (`extraAgents`) before every use. A key the
  venue no longer approves is replaced by a fresh one (never re-approved): `setup_agent.mjs` does
  it with one wallet signature, and a trading script does it by itself when the signer says the
  run signs hands-free (a duty's own live auto-execute wallet); otherwise it stops with
  `AGENT_INVALID` and asks for `setup_agent.mjs`.
- `setup_agent.mjs`: a stored, listed key is only confirmed (`alreadyApproved: true`, nothing
  signed). A missing or invalid key is replaced without `--rotate`; `--rotate` still forces a new
  key. The key is saved in the vault before any approval is asked. Two runs racing for the key
  settle on the first one's key (`AGENT_SETUP_IN_PROGRESS` while it is not listed yet).
- New `revoke_agent.mjs`: deletes the vault item, then approves a throwaway address under the same
  agent name so Hyperliquid drops the old key (Hyperliquid has no agent delete). Resumable.
- `status.mjs` reports a vault that is waiting for the owner's phone or unreachable as
  `VAULT_PENDING` / `VAULT_UNAVAILABLE` in `data.agent.code` and `data.next.code`.
- New codes `VAULT_PENDING`, `VAULT_UNAVAILABLE`, `VAULT_FULL`, `AGENT_SETUP_IN_PROGRESS`.
- Trading-key steps no longer file an authorization card.
- `SKILL.md` follows the hub's seven sections; credentials and recovery are in
  `references/credentials.md`.
- Dev signer: a 0600 file vault (`dev/.vault.json`) seeded once from `OUTCOME_AGENT_PRIVATE_KEY`
  or the old `dev/.agent-key.json`.

## 1.0.1

- Scripts never name a wallet: the server picks it from the session (a duty with its own
  wallet uses it, else the owner's main wallet). `--sign-by-duty-wallet` is a legacy no-op
  that prints one stderr note; stored duty code keeps working as written.
- `status.mjs` and `account.mjs` print `walletScope` (`duty` | `main`).
- New code `SIGNER_OUTDATED`: the loaded signer lacks `SESSION_WALLET_DEFAULT`, so the
  container must be redeployed onto the current image.
- A duty for this skill is always filed with its own wallet and `autoExecute: true`; without
  it every step is a card. New error row `DUTY_DELETED` (the duty was deleted; stop).

- New `withdraw.mjs`: withdraw USDC from Hyperliquid to Arbitrum, always to the signing
  wallet itself (no destination flag). `--amount <usdc>` or `--all`, minimum 2 USDC, flat
  $1 fee (to be confirmed live), about 5 minutes. Main-wallet signature (card in Main Chat,
  none in a live duty with its own wallet); the trading key can never withdraw. Resumable
  (`--resume <key>`): the nonce is saved before signing and the ledger is checked first,
  so it never withdraws twice. Statuses `withdraw_pending`, `needs_perps`,
  `pending_owner_signature`; new codes `INSUFFICIENT_HL_BALANCE`, `NOTHING_TO_WITHDRAW`,
  `WITHDRAW_REFUSED`, `WITHDRAW_ALREADY_SUBMITTED`, `WITHDRAW_UNKNOWN`, `SIGN_TYPE_REFUSED`.
- New `ensure_perps.mjs`: mirror of `ensure_spot.mjs` (spot to perps, trading-key
  authorization card), needed when a standard account holds its money in spot.
- `ensure_spot.mjs` shares its transfer code with `ensure_perps.mjs`; behaviour unchanged.
- Dev signer: the main wallet signs only `ApproveAgent` and a `Withdraw` to itself.
- The "no withdrawal" statements are gone from `SKILL.md` and the references.

## 1.0.0

Breaking: the skill now drives Outcome.xyz and Hyperliquid itself. Butler's server and
container no longer know either venue; `bevo-read prediction-*`, `bevo-prediction` and the
`bevo-exec /prediction/*` calls are gone.

- Runs this skill's own Node scripts (`scripts/*.mjs`, `@outcome.xyz/hip4` 1.3.0 and
  `@nktkas/hyperliquid` 0.33.3 pinned by the root `package-lock.json`), installed once
  with `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`. Every script prints one
  JSON envelope `{ok, status, data, error:{code,message,hint}}`.
- New flow: `status` → `deposit` (Arbitrum USDC to Hyperliquid, 5 USDC minimum) →
  `setup_agent [--rotate]` → `ensure_spot` → `place_bet` / `cancel`; reads `markets`,
  `account`.
- Main Chat vs duty: `--sign-by-duty-wallet` only in a duty. Main-wallet steps file a
  signature card (resumable with `--resume <key>`); trading-key steps file an authorization
  card (not resumable: `authorization_timeout`).
- Trading-key lifecycle: validity from Hyperliquid `extraAgents` + `userRole`
  (`AGENT_OK`, `AGENT_EXPIRING` < 14 days, must rotate < 7 days, `AGENT_INVALID`), renewal
  with a fresh key only.
- Limit orders only, whole shares, $2 minimum notional; settlement read with
  `fetchSettledOutcome`.
- References rewritten: `commands.md` (every flag, status and code), `outcome-sdk.md`,
  `hyperliquid-sdk.md`. `venues.md` removed.
- `requires.bins`: `bevo-wallet`, `node`, `npm`.

## 0.6.0

Server-delegated version (`bevo-read prediction-*`, `bevo-prediction`, `bevo-exec`);
superseded by 1.0.0.

## 0.2.0

- Removed deposit and withdrawal everywhere, including withdrawal minimums and routing in
  `references/venues.md`.
- Wallet framing: the agent key signs for the owner's own account; it is not a separate
  wallet.
- `--size` is always shares. Unknown flags and unknown venue ids are refused, never
  dropped or swapped for the default.
- Market search: `bevo-read prediction-markets` takes `--query`, `--category`, `--limit`
  (default 10, max 50), `--offset` and `--include-closed`; open markets only by default.
  `--query` matches event titles and descriptions only.
- An order's reply is a filed card with an approval id, not a fill: the skill now tells
  the owner to approve it and reads the account afterwards.
- Docs no longer describe Butler's server internals.

## 0.1.0

- First version. Covers Outcome.xyz (Hyperliquid HIP-4) as the first supported prediction
  market venue. The backend uses a venue abstraction layer so Kalshi and Polymarket API
  can be added without changing this skill's command structure.
- Read commands: `bevo-read prediction-venues`, `bevo-read prediction-markets [--venue]`,
  `bevo-read prediction-account [--venue]`.
- Execution command: `bevo-prediction` with `--side B` (buy) and `--side A` (sell),
  plus `--action deposit` and `--action withdraw`.
- Multi-venue architecture: `--venue <id>` selects the venue; default is `outcome`.
  `references/venues.md` documents each venue's minimums, routing, and status.
- Security rules: agent wallet only, card-based approval for every money act, withdraw
  only to owner's main wallet, never a private key in chat.
- Idempotency pattern: `pred:<venue>:<outcome>:<size>:<YYYYMMDD-HHMM>:<step>`.
- `references/commands.md`: full command reference with all parameter combinations.
- Not included: Polymarket web flow — that is `butler-skill-polymarket-web` (browser-based).
