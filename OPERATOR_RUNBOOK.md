# SOL/SYLPH Operator Runbook

This workspace is approved only for paper simulation, research, and read-only
operator observation. `MODE=live` is intentionally blocked.

## Startup and shutdown

1. Use the documented paper-mode configuration and run the read-only check.
2. Start only one engine instance per paper database and wallet identity.
3. Use the loopback terminal at `http://127.0.0.1:8793`; it is intentionally
   not a LAN service.
4. To stop, send the normal shutdown signal and allow the current loop to
   persist its state. Do not delete the database to clear an order.

## `LIVE_RECONCILIATION_UNRESOLVED`

This code means an order exceeded its block-height validity window but the
system has not proved final wallet SOL and token balances. The engine blocks
all automatic economic actions.

1. Do not resume, retry, rebuild, or submit an economic order.
2. Preserve the database, signed-wire audit entry, signature, mint, side, and
   last valid block height. Do not edit those records.
3. Obtain finalized transaction status and wallet SOL/token balances from at
   least two independently operated providers.
4. Compare the result with the durable order and local position/cash ledger.
   Treat any disagreement, provider outage, or missing token-account evidence
   as unresolved.
5. Escalate to the designated reconciliation authority. A future deployed
   authority—not a UI control or local file edit—must write the reconciled
   outcome and release any execution capability.

This repository has no deployed authority that can complete step 5. Therefore
the correct current outcome is continued containment and
`EXTERNAL_EVIDENCE_REQUIRED`.

## Provider or feed failure

- A stale or unhealthy market feed blocks new entries. Do not interpret cached
  values as fresh observations.
- Preserve provider health telemetry and raw failure context. Do not mark a
  provider healthy based on a UI refresh or a single successful request.
- Position reduction and emergency handling require their own verified balance
  and market evidence; no generic “resume” action proves that evidence.

## Signing or settlement request

- Do not enter wallet material into the application, terminal, UI, logs, or an
  AI prompt.
- This workspace has no production signer or settlement authority. Synthetic
  signer artifacts are test-only and never prove a broadcast or confirmation.
- Treat any requested real signing, wallet funding, provider credential, or
  mainnet action as an external operator ceremony requiring separate approval.
