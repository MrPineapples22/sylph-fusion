# SOL/SYLPH State Ownership Baseline

This is an audit baseline, not a claim that state ownership is fully reconciled.

| Domain | Current owner(s) observed | Status | Required resolution |
|---|---|---|---|
| Runtime engine positions/risk | `src/fusion.ts`, `src/core.ts`, `src/store.ts` | PARTIAL | document and enforce one execution ledger before live capability |
| Operator command state | `globalCommandGateway` | PARTIAL | reconcile with engine and terminal lifecycle at a single boundary |
| Operator presentation | `globalProjectionService`, `OperatorReadModel` | VERIFIED_IMPLEMENTED | retain read-only contract |
| Discovery/market cache | `MarketHub`, `discoverySnapshot` | PARTIAL | provenance and freshness must flow consistently into decisions |
| Intelligence temporal state | `MasterIntelligenceEngine` sub-engines | PARTIAL | bind tested PIT/replay evidence to the runtime decision path |
| Provider health | `globalProviderHealthTracker` | VERIFIED_IMPLEMENTED | independently validate fallback behavior |
| Live balances, fills, signer state | none certified in runnable path | MISSING | deploy an isolated signing and reconciliation authority |

No production authority may be inferred from a simulated position, illustrative research response, or UI view model.

