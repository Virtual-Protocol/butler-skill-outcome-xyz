# butler-skill-prediction-market

Butler skill for prediction market trading. Gives the Butler LLM agent a complete
playbook for reading and executing on prediction markets via bevo-server's API.

**Current venue**: Outcome.xyz (Hyperliquid HIP-4)  
**Planned**: Kalshi, Polymarket API (distinct from `butler-skill-polymarket-web`)

## What this skill does

When installed, Butler can:

- List available prediction market venues
- Browse open markets on any supported venue
- Read the agent's prediction account balance and open positions
- Buy and sell outcome shares (market or limit orders)
- Deposit USDC into a prediction account
- Withdraw USDC back to the agent wallet

Every money-moving action files an approval card — the owner taps to confirm.

## Architecture

The skill calls two bevo-server binaries that the agent container has:

| Binary | Purpose |
|--------|---------|
| `bevo-read prediction-venues` | List venues and their status |
| `bevo-read prediction-markets [--venue id]` | List open markets |
| `bevo-read prediction-account [--venue id]` | Read balance and positions |
| `bevo-prediction [--venue id] ...` | Place orders, deposit, withdraw |

bevo-server's prediction routes (`/butler-read/prediction/*`, `/butler-exec/prediction`)
handle the venue abstraction — adding a new venue requires only bevo-server changes, not
a skill update.

## Venue credentials

Each prediction venue requires a per-owner credential stored encrypted in bevo-server's
`venue_credentials` table (`VenueCredential` Prisma model). The owner sets this up in Butler
settings. Butler cannot do this setup step autonomously.

## Related skills and tools

| Package | What it covers |
|---------|---------------|
| `butler-skill-polymarket-web` | Polymarket via browser automation (separate, not API) |
| `butler-skill-variational` | Variational Omni perps (different command set, `acp site variational`) |

## Development

bevo-server routes: `server/routes/butlerPrediction.ts`  
Venue abstraction: `server/services/predictionMarketVenue.ts`  
Outcome.xyz impl: `server/services/outcomePredictionVenue.ts`  
virtuals-agent tools: `src/mastra/tools/prediction.ts`
