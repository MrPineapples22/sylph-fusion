# Root Cause: Execution Review Unavailable

Status: **BLOCKED**.

The alert originates in `src/operator-read-model.ts`, which deliberately declares `EXECUTION_REVIEW_UNAVAILABLE` because this operator surface has no connected economic-review adapter. The execution contract in `terminal/src/execution-contract.js` is a paper/UI state machine; it does not decode the actual message to be signed, bind a live simulation, issue a durable review artifact, freeze a live transaction, or connect to the isolated signer firewall.

`src/platform/signing/signing-firewall.ts` now provides a fail-closed policy contract but needs a real compiled Solana transaction decoder, isolated signer, durable review/journal integration, and provider evidence. Therefore this blocker is correct and must remain visible.

