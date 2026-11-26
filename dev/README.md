# Local dev signer

`dev/local-signer.mjs` implements the same contract as the container's `bevo-signer.mjs`
(virtuals-agent `docs/skills-contract.md`, "The signer"), but signs locally from env vars and
keeps the agent key in a file vault. It lives outside `scripts/`, so the hub never publishes
it. Use it to run the skill scripts on mainnet from a Mac without bevo-server or a Butler.

## Setup (Node >= 22.12; the container runs Node 24)

Dependencies live at the **skill root** (`package.json`, `package-lock.json`, `node_modules/`),
never under `scripts/` (Mastra scans `scripts/` recursively). Node resolves them upward.

```bash
cd butler-skills-suite/butler-skill-outcome-xyz   # or this worktree: the SKILL ROOT
npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# Load the test wallet from bevo-server/.env without printing anything
set -a; source <(grep -E '^(OUTCOME_MAIN_WALLET|OUTCOME_AGENT_PRIVATE_KEY)=' \
  /Users/lisanaaa/Documents/virtuals_protocol/bevo-super-app/bevo-server/.env); set +a
export BEVO_SIGNER=$PWD/dev/local-signer.mjs
```

| Env | Needed for |
|---|---|
| `OUTCOME_MAIN_WALLET` | everything (main wallet address) |
| `OUTCOME_AGENT_PRIVATE_KEY` | an already-approved agent key; seeds the file vault once (see below) |
| `DEV_MAIN_PRIVATE_KEY` | optional; only `deposit.mjs` and `setup_agent.mjs` need it. Without it they stop with `MAIN_SIGNER_UNAVAILABLE` |
| `DEV_AGENT_NAME` | HL agent name for a seeded key and for a NEW key `setup_agent.mjs` approves (default `bevo`, the dev agent already approved on the test wallet; it uses all 3 named slots, so the default replaces the dev agent, never `Butler`) |
| `DEV_SIGNER_VAULT`, `DEV_SIGNER_KEY_FILE`, `DEV_SIGNER_LEDGER` | path overrides for the vault, the old key file and the ledger (tests) |
| `DEV_SIGNER_VAULT_STATE` | `pending` emulates a Butler vault not yet restored from the phone (`missing`/`unrestored`): a get of an absent item answers `pending`, saves still work, `agentKey` treats pending as no key (`create: false` → `null`, create/rotate save a fresh one) and nothing is seeded |
| `ARBITRUM_RPC_URL` | default `https://arb1.arbitrum.io/rpc` |

Never echo these variables.

### The file vault

The agent key lives in `dev/.vault.json` (mode 0600, gitignored), shaped like the container's
vault: item `outcomexyz.<lowercase wallet>`, kind `venue_credentials`, value
`{"agent_key": {secret, address, agentName, createdAt, approvedAt, validUntil}}`, with the
same etag and compare-and-swap rules as the vault socket. `getSecret`, `saveSecret`,
`updateSecret`, `deleteSecret` and `venueCredentialName` are exported too.

Seeding, once per name that never held an item (so a revoked key does not come back):
`dev/.agent-key.json` (the old key file, the newer key) if it exists for this wallet, else
`OUTCOME_AGENT_PRIVATE_KEY`. A seeded key starts with `approvedAt: null`; the scripts check
it against Hyperliquid before use, so a replaced key shows as `AGENT_INVALID`. The old
`dev/.agent-key.json` is left in place after migration and can be deleted.

### L0.5 (scripts + local signer, no bevo-server)

```bash
cd butler-skills-suite/butler-skill-outcome-xyz   # or this worktree
export PATH="$HOME/.nvm/versions/node/v24.22.3/bin:$PATH"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
set -a; source <(grep -E '^(OUTCOME_MAIN_WALLET|OUTCOME_AGENT_PRIVATE_KEY)=' \
  /Users/lisanaaa/Documents/virtuals_protocol/bevo-super-app/bevo-server/.env); set +a
export BEVO_SIGNER=$PWD/dev/local-signer.mjs
```

1. `node scripts/status.mjs` seeds `dev/.vault.json`; expect `AGENT_OK`, or `AGENT_INVALID`
   if that key was replaced.
2. (owner; needs `DEV_MAIN_PRIVATE_KEY` via `read -s`)
   `DEV_AGENT_NAME=bevo node scripts/setup_agent.mjs --idempotency-key l05-setup-1` repairs an
   invalid key; `--rotate` forces a new one.
3. (owner) a resting bet and a cancel ($2 max here), as in the runbook.
4. (owner) `DEV_AGENT_NAME=bevo node scripts/revoke_agent.mjs --idempotency-key l05-revoke-1`,
   then `node scripts/status.mjs`: the old address is gone from `extraAgents`. Run
   `setup_agent.mjs` again to restore trading.

Dev-only safety: any single deposit, order or withdrawal over $10 is refused (`DEV_CAP_EXCEEDED`).
The dev main-wallet signer signs only `HyperliquidTransaction:ApproveAgent` and a
`HyperliquidTransaction:Withdraw` whose destination is its own address; any other
`HyperliquidTransaction:*` type, or a withdrawal to another address, is refused with
`SIGN_TYPE_REFUSED` (the production server enforces the same rule).
`sendTransaction` is idempotent per `${idempotencyKey}:${n}` (`dev/.ledger.json`, gitignored),
so `deposit.mjs --resume <key>` re-checks instead of sending twice.

## Signer contract (and the extensions this skill relies on)

```
AGENT_KEY_STORE = 'vault'
mainSigner({ idempotencyKey, approval })
  -> { address, walletScope: "duty" | "main", approval: "auto" | "card", signTypedData(...) -> 0x, sendTransaction({chainId,to,data,value}) -> { hash|null, status } }
agentKey({ label, accounts, rotate, create, display, agentName })
  -> { id, label, address, signerWallet, walletScope, approval, agentName, createdAt, approvedAt, validUntil, approved,
       generated, getAddress(), signTypedData(...), toViemAccount(), markApproved({validUntil, agentName}), forget(), pending }
signTypedData accepts (domain, types, value) [hip4] AND ({domain, types, primaryType, message}) [viem/nktkas]
owner waits: throw PendingOwnerAction { kind, key, route, approvalId, resumable }
```

`accounts` is the skill's own `await import("viem/accounts")` (the signer has no
dependencies); this dev signer refuses a call without it (`accounts_required`) so a script
bug shows up locally.

The module also exports `SESSION_WALLET_DEFAULT = true`; the scripts never name a wallet,
the signer picks it from the session (a duty with its own wallet, else the owner's wallet),
and `loadSigner` refuses a module without the constant or without `AGENT_KEY_STORE = 'vault'`
(`SIGNER_OUTDATED`). This dev signer always answers `walletScope: "main"` and
`approval: "auto"` (local signing never waits for an owner).

Contract **extensions** (the production signer mirrors them):
- `agentKey({ create: false })` returns `null` when no key exists instead of creating one.
  `status` and `setup_agent` (its stored-key check) always pass it, so read paths never create
  keys; the trading scripts read the key the same way and replace an invalid one only when
  `mainSigner().approval === "auto"`.
- `agentKey()` result has `generated: true` when this call made a new key, first or rotated.
  `setup_agent` approves only a key it made (or the one a `--resume` names).
- `agentKey()` also takes `deadline` (ms timestamp); this signer ignores it.

Resume rules:
- Trading-key actions (`place_bet`, `cancel`, `ensure_spot`, `ensure_perps`) are **not
  resumable**: when the signer sets `.pending` or a wallet card times out they print
  `authorization_timeout`.
- Wallet steps (`deposit`, `setup_agent`, `revoke_agent`, `withdraw`) are resumable: the step is saved to
  `$HOME/.cache/outcome-xyz/pending/<key>.json`; `--resume <key>` repeats the signer call
  with the same idempotency key (the signer returns the owner's signature / tx) and finishes.
- Every signing script takes `--idempotency-key <key>` (default: generated). Duties pass their
  slot key so a re-fire cannot bet twice: deposit and withdraw are refused by the signer's
  ledger, `place_bet` by Hyperliquid itself (the order's cloid comes from the key and is
  looked up with `orderStatus` first), and `cancel` answers `alreadyDone: true`.

Scripts find their own files via `import.meta.url`; never `~/skills/...` (a duty's HOME is its
duty dir; production also injects `BEVO_SKILLS_DIR`).

## Commands

Read-only (safe to run any time):

```bash
node scripts/status.mjs
node scripts/markets.mjs --venue out --query btc
node scripts/markets.mjs --id <marketId>
node scripts/account.mjs
```

Money-moving / signing (the owner runs these; each prints one JSON object):

```bash
node scripts/deposit.mjs --amount 5            # done | deposit_pending (+ resume command; never start a new deposit)
node scripts/setup_agent.mjs                    # done (alreadyApproved), or a fresh key approved when none/invalid
DEV_AGENT_NAME=bevo node scripts/setup_agent.mjs --rotate   # force a fresh key, approved by the main wallet
DEV_AGENT_NAME=bevo node scripts/revoke_agent.mjs --idempotency-key <key>   # delete the key, replace it on Hyperliquid
node scripts/ensure_spot.mjs --amount 2         # done (no-op on unified accounts)
node scripts/ensure_perps.mjs --amount 2        # done (spot -> perps; no-op on unified accounts)
node scripts/withdraw.mjs --amount 2            # L0.5: withdraw_pending | needs_perps | (resume: --resume <key>)
node scripts/place_bet.mjs --market <id> --outcome YES --side buy --size <shares> --price <p>
node scripts/cancel.mjs --order-id <oid>        # or --all
```

### L0.5: withdraw

Needs `DEV_MAIN_PRIVATE_KEY` (the main wallet signs the withdrawal). Withdraws go to
`OUTCOME_MAIN_WALLET` only and are capped at $10 here. Expect `needs_perps` on a standard
account whose money is in spot: run `ensure_perps.mjs --amount <data.amountUsdc>` and then
`withdraw.mjs` again. A successful run prints `withdraw_pending` (about 5 minutes to land
on Arbitrum; `hlConfirmed` tells whether the ledger already lists it). Confirm in a live
test that the minimum is 2 USDC and the fee is 1 USDC (`MIN_WITHDRAW_USDC`,
`HL_WITHDRAW_FEE_USDC` in `scripts/lib/common.mjs`).

Unit tests (no network), from the skill root: `npm test`.
