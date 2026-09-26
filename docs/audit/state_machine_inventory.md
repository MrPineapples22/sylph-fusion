# State-machine inventory

Generated 2026-09-23. This lists observed machines and does not assert their interoperability.

| Domain | Implementation | States/contract observed | Concern |
|---|---|---|---|
| System lifecycle | `src/lifecycle/system-lifecycle.ts` | Normal/degraded/reduce-only/safety-lock style operational transitions | Must be the source for capability projections. |
| Legacy execution | `src/execution-engine.ts` | IDLE → VALIDATING → QUOTING → SIGNING → SUBMITTING → SETTLED | Must not be bypassed by another execution path. |
| Platform vault | `src/platform/lifecycle/state-machine.ts` | Vault lifecycle transitions | Separate aggregate; needs explicit boundary from trading order state. |
| Signing/settlement | `src/platform/signing/*` | Grant, prepare, sign, persist, broadcast/reconcile guards | Critical path; retain fail-closed tests. |
| Intelligence execution | `src/intelligence/execution/*` | Permit and execution-state constructs | Map or remove overlap with legacy/platform order state. |
| Provider health | `src/platform/ingestion/provider-health.ts` | Unknown/connectivity/healthy/degraded/rate-limited/recovery behavior | Needs one authoritative projection. |
| Launch lifecycle | `src/lifecycle/launch-lifecycle.ts` | Pump/AMM lifecycle phases | Keep distinct from token safety eligibility. |

## Required unification

Create a machine-readable transition table for one `ExecutionID`: requested, reviewed, authorized, signed, submitted, ambiguous, confirmed, failed, expired, reconciled. Illegal transitions must fail closed; each transition must append durable evidence and carry the configuration/policy/model versions used.

