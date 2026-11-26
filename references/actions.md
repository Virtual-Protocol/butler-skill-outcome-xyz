# What each script signs

| Script | Wallet signature |
| --- | --- |
| `status`, `markets`, `account` | none (reads) |
| `setup_agent`, `revoke_agent` | ApproveAgent |
| `deposit` | Arbitrum USDC transfer |
| `ensure_spot`, `ensure_perps`, `place_bet`, `cancel` | none: the trading key signs (a lapsed key is repaired in a duty with one ApproveAgent) |
| `withdraw` | Hyperliquid Withdraw to the same wallet |

All but the reads need `--idempotency-key`. The server decides whether a wallet signature is a
card: the owner's main wallet always files one, a duty's own live auto-execute wallet none.

Retiring the key (`revoke_agent.mjs`): `revoked: true` means the key was deleted and dropped
by Hyperliquid; `false` means there was no key. One throwaway approval stays under our agent
name (`allAgents[].placeholder: true`) until the next setup replaces it; agents under other
names (`ours: false`) are not ours and are never touched. Details: `credentials.md`.
