# butler-skill-prediction-market

Butler skill for prediction market trading. Gives Butler a playbook for searching markets,
reading an owner's prediction account, and filing buy and sell orders for approval.

**Current venue**: Outcome.xyz (Hyperliquid HIP-4)  
**Planned**: Kalshi, Polymarket API (distinct from `butler-skill-polymarket-web`)

## What this skill does

When installed, Butler can:

- List supported prediction market venues
- Search open markets by keyword or category
- Read the owner's prediction account balance and open positions
- File buy and sell orders (market or limit) — each one a card the owner approves in the
  app before anything is placed

Deposits and withdrawals are not part of this skill.

## Commands it uses

| Command | Purpose |
|---------|---------|
| `bevo-read prediction-venues` | List venues and their status |
| `bevo-read prediction-markets [--query …] [--venue id]` | Search open markets |
| `bevo-read prediction-account [--venue id]` | Read balance and positions |
| `bevo-prediction …` | File a buy or sell order card |

Both commands are provided by the Butler agent runtime; the skill installs only where they
are available. `references/commands.md` has every flag.

## Connecting a venue

The owner connects each venue in the Butler app. Butler cannot do this step itself, and it
never sees or handles a private key.

## Related skills

| Package | What it covers |
|---------|---------------|
| `butler-skill-polymarket-web` | Polymarket via browser automation (separate, not API) |
| `butler-skill-variational` | Variational Omni perps |
