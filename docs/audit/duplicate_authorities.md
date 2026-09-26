# Duplicate authorities

Generated 2026-09-23. A same-named type alone is not a defect; these are review targets where competing ownership is plausible.

| Fact or boundary | Implementations observed | Risk | Required decision |
|---|---|---|---|
| Command acceptance | `src/command-gateway.ts`; `src/platform/execution/command-gateway.ts` | Two idempotency/emergency-stop semantics | Select one production command authority and make the other an adapter or retire it after tracing. |
| RPC/provider health | `src/rpc.ts`; `src/platform/ingestion/provider-health.ts`; `src/intelligence/truth/rpc-pool.ts` | Different health/freshness evidence can disagree | Establish Provider Fabric as sole health owner. |
| Configuration | `src/config.ts`; `src/config-authority.ts`; direct `process.env` reads in runtime/scripts | Runtime policy can drift from a frozen snapshot | Route all production reads through one immutable configuration snapshot. |
| Execution lifecycle | `src/execution-engine.ts`; `src/platform/execution/authority.ts`; `src/intelligence/execution/*`; `src/fusion.ts` | More than one state machine may govern an order | Define one execution aggregate and journal. |
| Reconciliation | `fusion.ts`; `src/platform/reconciliation/reconciler.ts`; `src/intelligence/reconciliation/*` | UI or execution may rely on different ledger truth | Select one live reconciliation service and expose its certificate. |
| Canonical market/token state | `market-hub.ts`; `market.ts`; `intelligence/truth/*`; `platform/execution/market-truth.ts` | Staleness and price disagreement can be handled differently | Publish a canonical `MarketSnapshot`/`TokenIdentity` contract. |

## Type-name collisions needing semantic review

`CommandGateway`, `CapitalState`, `ExecutionLifecycleState`, `ExecutionPermit`, `SettlementState`, `SourceHealthMetrics`, `VerificationStatus`, `CohortEngine`, and `ConnectionAuditor` each have multiple exported definitions. Resolve only after callers and serialized payloads are mapped; do not bulk-rename.

