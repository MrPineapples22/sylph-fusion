# SYLPH current architecture

Generated 2026-09-23 from the working tree. This is an evidence inventory, not a release claim.

## Runtime paths

Two substantial runtime paths coexist:

- `src/fusion.ts` is the primary engine entry point. It loads environment configuration, owns the legacy event loop, wires RPC/feed/market/executor/storage, produces sessions, and drives the dashboard.
- `src/platform/orchestrator.ts` composes a second platform model containing vaults, ledger, risk, market truth, signer, reconciliation, and sentinels.
- `src/intelligence/master-orchestrator.ts` composes a large intelligence graph with its own chain truth, RPC pool, feature store, policy, model, and execution-oriented components.
- `src/app.ts` and `terminal/` provide an operator dashboard and paper command path.

The intended authority order is represented in code and UI projection as: provider evidence → market state → risk/policy → execution authority → signing boundary → reconciliation → read-only projection. It is not yet proven that all three runtime paths use exactly the same instances or lifecycle.

## Implemented control boundaries

- `src/config.ts` validates a core environment schema; `src/config-authority.ts` adds a versioned snapshot/freeze abstraction.
- `src/operator-read-model.ts` fences UI projections with a TTL and maps action capabilities to blockers.
- `src/command-gateway.ts` handles paper/simulation commands and idempotency; `src/platform/execution/command-gateway.ts` is a second gateway implementation.
- `src/platform/execution/authority.ts`, `src/platform/signing/*`, and `src/platform/reconciliation/*` provide fail-closed execution, signing, and reconciliation building blocks.
- `src/platform/ingestion/provider-health.ts` and `capability-fabric.ts` track provider observations and capability contracts.

## Architectural finding

The repository contains a credible collection of safety-oriented components, but it is not a single demonstrated production system. The principal Phase-1 task is to choose one composition root and publish an explicit ownership graph for every runtime fact before extending features.

