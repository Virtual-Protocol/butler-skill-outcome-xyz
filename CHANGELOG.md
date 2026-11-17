# Changelog

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
