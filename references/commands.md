# Command Reference

All commands go through Butler's server; you never hold a key.
`--venue <id>` is optional everywhere — omit it for the default venue (`outcome`). An
unknown venue id is refused, never replaced with the default.

## Reads (never take an idempotency key)

```sh
# Supported venues and whether each is reachable
bevo-read prediction-venues

# Search markets — open markets only, 10 per page by default
bevo-read prediction-markets --query <keyword>
bevo-read prediction-markets --query <keyword> --limit 20 --offset 20
bevo-read prediction-markets --category <category>
bevo-read prediction-markets --venue <id> --query <keyword>
bevo-read prediction-markets --query <keyword> --include-closed   # past markets; never order from these

# Balance and open positions
bevo-read prediction-account
bevo-read prediction-account --venue <id>
```

| Flag | Values | Notes |
|------|--------|-------|
| `--query <text>` | one or two plain keywords | Case-insensitive substring of the **event** title or description. "btc" does not match "Bitcoin". |
| `--category <c>` | a category the venue lists | Narrows to one category. |
| `--limit <n>` | 1–50, default 10 | Markets per page. |
| `--offset <n>` | ≥ 0 | Skip this many markets (next page). |
| `--include-closed` | — | Also return closed markets. For questions about the past only. |
| `--venue <id>` | `outcome` | Omit for the default. |

## Orders (always take an idempotency key)

Each command files **one card** for your owner to approve in the app. Nothing is bought
or sold until they approve it.

```sh
# Buy outcome shares at market
bevo-prediction --market-id <id> --outcome <name> --side B --size <shares> --idempotency-key <KEY>:buy

# Buy with a limit price
bevo-prediction --market-id <id> --outcome <name> --side B --size <shares> --limit-price <0-1> --idempotency-key <KEY>:buy

# Sell shares you hold
bevo-prediction --market-id <id> --outcome <name> --side A --size <shares> --idempotency-key <KEY>:sell

# Another venue
bevo-prediction --venue <id> --market-id <id> --outcome <name> --side B --size <shares> --idempotency-key <KEY>:buy
```

| Flag | Values | Notes |
|------|--------|-------|
| `--market-id <id>` | from `prediction-markets` | Required. |
| `--outcome <name>` | e.g. `Yes`, `No`, or a listed label | Exactly as the market lists it. |
| `--side B` | buy | |
| `--side A` | sell | Only shares step 3 shows you hold. |
| `--size <n>` | **shares** | Never dollars. Shares × price ≥ $1. |
| `--limit-price <p>` | 0–1, exclusive | Optional; market order if omitted. |
| `--venue <id>` | `outcome` | Optional. |
| `--idempotency-key <KEY>` | see below | Required. |

Any flag not in this table is refused.

The reply names the filed card and its approval id. An error, a timeout, or an unclear
answer means the card may have been filed: do not re-run; check the app or the account.

## Key format

```
pred:<venue>:<outcome>:<shares>sh:<YYYYMMDD-HHMM>:<step>
```

Example: `pred:outcome:yes:40sh:20261113-1030:buy`

A key is 1–128 letters, digits and `: _ . -`. Never reuse a key for a new errand.
