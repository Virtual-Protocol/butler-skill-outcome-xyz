# Supported Prediction Market Venues

| ID | Name | Chain | Minimum Order | Minimum Withdrawal | Status |
|----|------|-------|--------------|-------------------|--------|
| `outcome` | Outcome.xyz | Hyperliquid (HIP-4) | $1 USDC notional (shares × price) | $5 USDC | Active |

Future (not yet integrated):

| ID | Name | Chain | Status |
|----|------|-------|--------|
| `kalshi` | Kalshi | Off-chain (USD) | Planned |
| `polymarket` | Polymarket (API) | Polygon | Planned — distinct from `butler-skill-polymarket-web` (browser-based) |

## Outcome.xyz

- **Auth**: Agent key stored encrypted in bevo-server's `venue_credentials` table per owner.
  Owner connects in Butler settings — you cannot do this step for them.
- **Markets**: Hyperliquid HIP-4 prediction markets. Binary (Yes/No) outcomes only.
- **Deposit routing**: USDC sent to the owner's Hyperliquid deposit address (read from
  `bevo-read prediction-account`).
- **Withdrawal routing**: USDC returns to Butler's agent wallet only, then the owner
  can transfer it onwards.
- **Settlement**: on-chain (Hyperliquid L1). L1 fees apply to withdrawals — minimum $5
  USDC to cover them.
- **Order book**: HIP-4 CLOB. Market orders and limit orders supported. Minimum notional
  $1 USDC (shares × price ≥ $1).

## Notes

- When a venue is `unavailable`, its `bevo-read prediction-account` and
  `bevo-read prediction-markets` responses include an `unavailable` field explaining why
  (e.g. API unreachable, agent key not configured). Relay it; do not guess.
- `bevo-read prediction-venues` returns the live status of every registered venue.
  Use it only when the owner asks which venues are supported or when the named venue ID
  is unknown.
