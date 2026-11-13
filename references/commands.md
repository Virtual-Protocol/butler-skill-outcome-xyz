# Command Reference

All commands use Butler's agent wallet credentials stored in bevo-server.
`[--venue <id>]` is optional — omit for the default venue (`outcome`).

## Reads (no idempotency key)

```sh
# List supported venues and their status
bevo-read prediction-venues

# List open prediction markets
bevo-read prediction-markets
bevo-read prediction-markets --venue <id>

# Check account balance and positions
bevo-read prediction-account
bevo-read prediction-account --venue <id>
```

## Execution (always use an idempotency key)

```sh
# Buy (Back) — purchase outcome shares
bevo-prediction --market-id <id> --outcome <name> --side B --size <shares> --idempotency-key <KEY>:buy
bevo-prediction --venue <id> --market-id <id> --outcome <name> --side B --size <shares> --idempotency-key <KEY>:buy

# Buy with limit price
bevo-prediction --market-id <id> --outcome <name> --side B --size <shares> --limit-price <0.00-1.00> --idempotency-key <KEY>:buy

# Sell (Ask/Lay) — sell outcome shares from an open position
bevo-prediction --market-id <id> --outcome <name> --side A --size <shares> --idempotency-key <KEY>:sell
bevo-prediction --venue <id> --market-id <id> --outcome <name> --side A --size <shares> --idempotency-key <KEY>:sell

# Deposit USDC into the prediction account
bevo-prediction --venue <id> --action deposit --amount <usdc> --idempotency-key <KEY>:deposit

# Withdraw USDC from the prediction account
bevo-prediction --venue <id> --action withdraw --amount <usdc> --idempotency-key <KEY>:withdraw
```

## Key format

```
pred:<venue>:<outcome>:<size>:<YYYYMMDD-HHMM>
```

Example: `pred:outcome:yes:20usdc:20261113-1030`

Add step suffix for each card: `:buy`, `:sell`, `:deposit`, `:withdraw`.

A key is 1–128 letters, digits and `: _ . -`. Never reuse a key for a new errand.

## Parameters

| Parameter | Values | Notes |
|-----------|--------|-------|
| `--venue <id>` | `outcome` (default), future: `kalshi`, `polymarket` | Omit for default |
| `--market-id <id>` | String from `prediction-markets` output | Required for orders |
| `--outcome <name>` | e.g. `Yes`, `No`, or multi-outcome label | Exact name from market listing |
| `--side B` | Buy (back) | B = buy an outcome |
| `--side A` | Sell (ask/lay) | A = sell shares you hold |
| `--size <n>` | Shares (buy/sell) or USDC (deposit/withdraw) | Shares × price ≥ $1 |
| `--limit-price <p>` | 0.01–0.99 (probability) | Optional; market order if omitted |
| `--action deposit` | | Deposit USDC into the account |
| `--action withdraw` | | Withdraw USDC to Butler's wallet |
