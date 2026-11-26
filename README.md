# butler-skill-prediction-market

Butler skill for Outcome.xyz prediction markets (Hyperliquid HIP-4). This repository is the
**only** place Butler learns Outcome.xyz and Hyperliquid: bevo-server and the container hold
no venue knowledge. They provide a generic signer (`BEVO_SIGNER`, backed by `bevo-wallet`)
for the owner's or a duty's wallet; the agent (trading) key is the Butler's own, kept in its
private vault (`references/credentials.md`).

## Layout

| Path | What |
| --- | --- |
| `SKILL.md` | The playbook the model follows (hub standard: seven sections, 12,000-char body) |
| `references/commands.md` | Every script's flags, statuses, output fields and error codes |
| `references/outcome-sdk.md` | HIP-4 / Outcome.xyz concepts and which SDK call each script makes |
| `references/hyperliquid-sdk.md` | Deposit, withdraw, perps vs spot, agent keys, nonces |
| `references/credentials.md` | The trading key: vault item, bootstrap order, renewal, revoke, recovery |
| `references/deposit.md` | Moving USDC into Hyperliquid (acp's move first, `deposit.mjs` fallback) and out |
| `references/duty.md` | Funding a duty wallet, wallet scope, ticks, the close sweep |
| `references/failures.md` | What to do for every `error.code` |
| `references/actions.md` | What each script signs, cards, revoke placeholder |
| `scripts/*.mjs`, `scripts/lib/common.mjs` | The only code that touches the venues; one JSON envelope per run |
| `package.json`, `package-lock.json` | Pinned `@outcome.xyz/hip4` 1.3.0, `@nktkas/hyperliquid` 0.33.3, `viem`; at the skill root, never under `scripts/` |
| `dev/` | Local signer for mainnet tests from a Mac (`dev/README.md`); not published |

Flow: `status` → `deposit` → `setup_agent [--rotate]` → `ensure_spot` → `place_bet` /
`cancel`; exit: `withdraw` (to the same wallet; `ensure_perps` first when the money sits
in spot), then `revoke_agent`; reads `markets`, `account`. Needs a container whose signer
exports `AGENT_KEY_STORE = 'vault'` (else `SIGNER_OUTDATED`). Unit tests (no network): `npm test`.

## Publishing notes

- The hub publishes `SKILL.md` and `references/**/*.md`; publishing `scripts/**/*.mjs` and
  the root package files needs the hub and container rule change described in the
  workspace plan (`docs/plans/skill-driven-dapp-refactor.md` §2.5).
- Validate with `python3 <butler-skills>/scripts/validate.py --standalone <a copy without node_modules>`.
- Bump `version` and add a `CHANGELOG.md` entry for every change, and bump the `ref` in
  `butler-skills/skills.json` in the same change-set.

## Related skills

| Package | What it covers |
| --- | --- |
| `butler-skill-polymarket-web` | Polymarket via browser automation |
| `butler-skill-variational` | Variational Omni perps |
