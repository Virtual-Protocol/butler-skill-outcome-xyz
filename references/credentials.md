# The trading key: where it lives and how it is kept

The only credential this skill uses is the **trading key**, a Hyperliquid "agent". It is the
Butler's own: bevo-server never sees it. Scripts read it from the Butler's private vault and
sign with it locally. It can place and cancel orders and move USDC between the account's own
perps and spot; it can never withdraw.

## The vault item

- Name `outcome.<wallet>`: the label `outcome` plus the signing wallet, an EVM address
  lowercased with its `0x`. One item per wallet, so a duty's own wallet and the owner's main
  wallet each have their own key.
- Kind `venue_credentials`; display label like `outcome · 0x6dcf…beac` (first 6 and last 4
  characters of the wallet).
- Value: one JSON object holding every credential of that wallet at this venue. This skill
  writes only `agent_key`; any other top-level key is kept untouched on every write:

```json
{"agent_key": {"secret": "<hidden>", "address": "<agent address>", "agentName": "Butler",
               "createdAt": "<ISO>", "approvedAt": "<ISO or null>", "validUntil": "<ISO or null>"}}
```

`approvedAt` and `validUntil` are a convenience copy of what Hyperliquid says. They are never
trusted: validity comes only from Hyperliquid (`extraAgents` plus `userRole`).

## Order of events when a key is made

1. The key is generated and saved in the vault first, with a compare-and-swap write (the item
   must not exist, or must still be the one that was read).
2. Only then is the ApproveAgent signature asked of the wallet (a card on the main wallet; no
   card in a duty's own live auto-execute session).
3. The script submits it to Hyperliquid, waits until `extraAgents` lists the address, and
   records `approvedAt` and `validUntil` in the vault item.

A key that was saved but never approved is simply an invalid key: the next `setup_agent.mjs`
replaces it. An address Hyperliquid stopped listing is never approved again.

## Two runs at once

Both try to write the first key; the compare-and-swap lets exactly one win. The loser reads
the winner's key, signs nothing, and waits up to ~30 s for Hyperliquid to list it. Listed: it
carries on with that key. Not listed: `AGENT_SETUP_IN_PROGRESS`, run `status.mjs` in a minute.

## Validity and renewal

- Approvals last about 90 days (Hyperliquid's cap is 180). `status.mjs` warns under 14 days
  (`AGENT_EXPIRING`) and asks for a renewal under 7 days (`mustRotate`).
- Renewal is `setup_agent.mjs --rotate`: a fresh key replaces the old one at once, so ask your
  owner first.
- Replaced by another approval under the same name, or pruned because the account was emptied:
  the key is invalid, `setup_agent.mjs` makes a new one.

## Revoke

`revoke_agent.mjs` deletes the vault item, then approves a throwaway address under the same
agent name, because Hyperliquid has no agent delete: approving a name again replaces the old
address. It then waits until the old address is gone from `extraAgents`
(`goneFromHyperliquid`). The throwaway key is discarded at once. Retire the key after the last
withdrawal landed, never with orders open (they would be uncancellable by this skill).

## Recovery

| Situation | What happens |
| --- | --- |
| No key (first use, or revoked) | `setup_agent.mjs` makes one. |
| Key not listed on Hyperliquid | `setup_agent.mjs` replaces it; in a duty a trading script does it by itself. |
| Vault not restored on this Butler yet (`vaultState: "pending"`) | No key is available here, so it is the same as no key: never wait for the phone. `status.mjs` says `needs_agent`; `setup_agent.mjs` saves a fresh key (saves work while the vault is pending) and approves it under the same name, which replaces any older agent on Hyperliquid; in a duty a trading script does it by itself. When the phone restores later, the fresh save stays on top; an older key it brings back fails the Hyperliquid check and is replaced. |
| Vault volume lost | Same as no key: the old address stays approved until it expires or is replaced; `setup_agent.mjs` approves a new one. |
| Phone restores an old copy that holds a replaced key | The Hyperliquid check marks it invalid; the next setup replaces it. |
| Owner without a phone (web only) | The vault is restored from the web session; while it is pending, `setup_agent.mjs` makes a fresh key as above. |
| `VAULT_FULL` | The owner's vault has no room; nothing was stored. Tell the owner. |
| `SIGNER_OUTDATED` | The container runs a build without the vault signer; it must be redeployed. |

## Never

Print, paste, log or describe the key; pass it on a command line; write it to a file. Scripts
print one JSON object with addresses only.
