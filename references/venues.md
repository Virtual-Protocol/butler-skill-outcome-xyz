# Supported Prediction Market Venues

| ID | Name | Chain | Minimum Order | Status |
|----|------|-------|---------------|--------|
| `outcome` | Outcome.xyz | Hyperliquid (HIP-4) | $1 USDC notional (shares × price) | Active |

Future (not yet integrated):

| ID | Name | Chain | Status |
|----|------|-------|--------|
| `kalshi` | Kalshi | Off-chain (USD) | Planned |
| `polymarket` | Polymarket (API) | Polygon | Planned — distinct from `butler-skill-polymarket-web` (browser-based) |

A planned venue is refused until `bevo-read prediction-venues` lists it.

## Outcome.xyz

- **Account**: your owner's own Outcome.xyz account. An agent key, held by Butler's
  server, signs orders on their behalf; it is not a separate wallet. Your owner connects
  the venue in the Butler app — you cannot do this step for them.
- **Markets**: grouped into events. An event is one question ("What will BTC close at on
  Dec 31?"); each market inside it is one Yes/No book with its own price. Simple
  questions have one market, multi-choice and price-range questions several.
- **Order book**: HIP-4 central limit order book. Market and limit orders. Minimum
  notional $1 USDC (shares × price ≥ $1).
- **Settlement**: on-chain (Hyperliquid L1).
- **Funding**: deposits and withdrawals are not handled by this skill.

## Notes

- When a venue is `unavailable`, its `prediction-account` and `prediction-markets` reads
  include an `unavailable` field explaining why. Relay it; do not guess.
- `bevo-read prediction-venues` returns the live status of every registered venue. Use it
  when your owner asks which venues are supported or names a venue id you do not know.
