# Failure codes: what to do

`error.hint` is written for the Butler: follow it unless a row below says more. Steps refer
to SKILL.md's `## Procedure`. Every code a script can print, with its meaning, is in
`commands.md`.

| `error.code` | Do |
| --- | --- |
| `BAD_ARGS`, `AMOUNT_BELOW_MINIMUM`, `ORDER_BELOW_MINIMUM`, `BAD_PRICE`, `MARKET_ORDER_REFUSED` | fix the flags, never invent any; deposit ≥ 5.5 via acp, the first one ≥ bets + 1.5 (≥ 5 via `deposit.mjs`), withdraw ≥ 2, orders ≥ $2, limit only |
| `INSUFFICIENT_USDC`, `NEEDS_HEADROOM` (from the `deposit.mjs` fallback) | deposit with acp (step 2) instead, it uses any chain; without acp the owner sends native USDC (not USDC.e) on Arbitrum, or deposit the hint's smaller amount |
| `NEEDS_DEPOSIT`, `NEEDS_SPOT` | step 2, step 4 (hint's amount) |
| `AGENT_INVALID` | step 3 plain, then retry the failed command ONCE with a new key. Never re-approve an old key address |
| `APPROVE_FAILED` | report `data.raw`; run status; no auto-retry |
| `AGENT_APPROVAL_UNCONFIRMED`, `AGENT_SETUP_IN_PROGRESS` | wait a minute, run status; if the key shows, rerun step 3 plain |
| `VAULT_PENDING` | no key here yet: step 3 plain |
| `VAULT_UNAVAILABLE`, `HL_UNREACHABLE`, `HL_INFO_FAILED` | retry once in a minute, then say so |
| `VAULT_FULL` | tell your owner the vault is full |
| `INSUFFICIENT_HL_BALANCE`, `NOTHING_TO_WITHDRAW`, `INSUFFICIENT_BALANCE`, `INSUFFICIENT_SHARES` | use at most the hint's amount, or say it is empty; run status, step 4 or 2 |
| `WITHDRAW_REFUSED`, `SIGN_TYPE_REFUSED`, `DEPOSIT_TX_FAILED` | nothing left; report the message |
| `WITHDRAW_ALREADY_SUBMITTED`, `WITHDRAW_UNKNOWN` | sent already, never again; run status. Unknown: same command plus `--resume <key>` |
| `ORDER_UNKNOWN` | run account.mjs; retry only with the SAME key |
| `RESUME_NOT_FOUND`, `RESUME_MISMATCH`, `KEY_REUSED` | the step finished, changed or already ran; run status and account first |
| `OWNER_DECLINED` | nothing ran; retry only on their yes, with a NEW key |
| `SIGNER_OUTDATED`, `DUTY_DELETED` | the container must be redeployed; the duty is gone, nothing ran. Stop |
| `EXCHANGE_ERROR`, `UNEXPECTED`, `SIGNER_NOT_CONFIGURED` | report; status and account first |
