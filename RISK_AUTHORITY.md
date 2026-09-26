# Risk and Execution Authority Baseline

The active safety posture is fail-closed simulation. `fusion.ts` rejects live signing, command-gateway live commands are rejected, and terminal capabilities state that execution review and live reconciliation are unavailable.

Observed disconnected designs include simulated execution authority, command-gateway paper positions, platform signer simulation, intelligence vault simulation, and intended durable/KMS signer components. None establishes a certified production composition root.

Required authority chain:

```text
validated state → deterministic Guardian/Capital/Safety → durable intent journal
→ isolated policy signer → exact-byte broadcast → independent chain reconciliation
→ durable settlement ledger → read-only projections
```

Any ambiguous submission remains non-retryable until reconciliation resolves it. AI/model output is advisory input only and cannot bypass this chain.

