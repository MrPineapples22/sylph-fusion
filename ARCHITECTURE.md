# SOL/SYLPH Current Architecture

Status date: 2026-09-22. This map is evidence-based and supersedes historical design claims only where cited runtime code confirms them.

```text
Market inputs / provider adapters
  -> provider health + MarketHub / discovery
  -> evidence and intelligence modules (separate in-process graph)
  -> projection service / operator read model
  -> terminal UI (read projections)

Operator commands
  -> CommandGateway
  -> simulated execution authority / engine
  -> paper positions and projections
```

The engine entry point is `src/fusion.ts`; the operator server is `terminal/server.mjs`; the command and read boundaries are `src/command-gateway.ts`, `src/projection-service.ts`, and `src/operator-read-model.ts`. The large intelligence composition root is `src/intelligence/master-orchestrator.ts`.

## Current classification

| Blueprint area | State | Evidence |
|---|---|---|
| Provider health and operator projection | VERIFIED_IMPLEMENTED | `src/platform/ingestion/provider-health.ts`, `src/projection-service.ts` |
| Command gateway and lifecycle controls | PARTIAL | `src/command-gateway.ts`, `src/lifecycle/system-lifecycle.ts`; runnable surface remains simulation only |
| Intelligence component graph | PARTIAL | `src/intelligence/master-orchestrator.ts` composes many engines; live decision-to-execution connection is not certified |
| Single canonical system state | CONFLICTING | engine, command gateway, MarketHub, and master intelligence own overlapping in-process state |
| Isolated live signer and durable settlement reconciliation | MISSING | live startup is blocked; no certified remote signer/reconciliation deployment |
| Production certification | DESIGNED_ONLY | `src/platform/certification/release-certification.ts` deliberately reports an unverified candidate |

## Explicitly quarantined models

- `src/platform/orchestrator.ts` may evaluate non-financial proposals but cannot create an execution, fill, confirmation, ledger posting, or settlement. It returns explicit unavailable capability codes.
- `src/platform/signing/signer-service.ts` and `src/intelligence/vault/vault-signer.ts` are test-simulation components. They default-deny; any opt-in artifact is labeled simulation-only and is not chain evidence.
- The live engine remains blocked until a separately deployed signer and independently evidenced reconciliation boundary exist.

## Architectural invariants

1. UI projections are read-only and must not create financial authority.
2. External providers are evidence sources, never direct trade authority.
3. Live execution requires a separately verified signer, reconciliation, and release evidence; no current component may infer that approval from paper state.
4. When sources conflict, stale, or are unknown, the state must remain explicit rather than become zero or “healthy.”

## Initial task graph

The following graph is deliberately sequential where ownership changes would otherwise conflict. No work item authorizes a live trade, deployment, or credential operation.

```text
ASTRA Architecture: choose canonical journal/reducer and projection boundaries
  -> ASTRA Verification: replay watermark + state-hash invariant design
  -> ASTRA Risk + Verification: isolated signing/reconciliation authority design
  -> SOL Data: bounded durable-envelope/revision implementation after approved contract
  -> SOL QA: deterministic fixtures and invariant regression suite

ASTRA Protocol: token behavior certificate contract
  -> SOL Integration/Provider: adapter capability and semantic metadata
  -> SOL QA: differential/unknown-semantics tests

ASTRA Intelligence: model authority and PIT/label lifecycle contract
  -> SOL Data: storage and provenance implementation
  -> SOL UI: truthful blocked/degraded projections

ASTRA Certification: adversarial, provider-failure, restart and soak evidence plan
  -> independent Astra Risk + Verification review
  -> release-gate decision
```

| Priority | Classification | Owner(s) | Deliverable |
|---|---|---|---|
| 1 | CRITICAL | Astra Architecture + Astra Verification | one authoritative state/event contract and migration decision |
| 2 | CRITICAL | Astra Risk + Astra Verification | signer-to-settlement/reconciliation composition and threat model |
| 3 | HIGH | Astra Protocol | versioned token behavior certificate and fail-closed semantics plan |
| 4 | HIGH | Astra Intelligence + Astra Verification | four-clock evidence, final labels, PIT and replay requirements |
| 5 | MEDIUM | Sol Provider + Sol QA | real provider capability/failure fixtures after contract approval |
| 6 | MEDIUM | Sol UI + Sol QA | no-positive-default and truthful capability-state coverage |
| 7 | CRITICAL | Astra Certification + independent reviewers | release evidence matrix; no certification until all blockers close |
