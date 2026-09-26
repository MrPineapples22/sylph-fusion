# Root Cause: Live Reconciliation Unavailable

Status: **BLOCKED**.

The alert originates in `src/operator-read-model.ts`, where no reconciled live wallet ledger is available. `terminal/evidence-view.mjs` explicitly states that the terminal has no reconciled live-wallet connection. Existing reconciliation classes and engine `reconcile()` paths support simulations, fixtures, or disconnected in-memory models; they are not a configured multi-provider service that retrieves a signed mainnet transaction, checks confirmation/finality, verifies SOL/token deltas, and commits an authoritative live portfolio.

The absence is intentional and safe. A submission timeout cannot become failure or trigger retry until a durable journal and independent chain reconciliation path resolve it.

