# SOL / SYLPH — Comprehensive Repository Inventory
**Generated:** 2026-09-24  
**Scope:** `c:\Users\juans\Documents\Codex\2026-09-16\sylph-fusion`  
**Standard:** Domain-Driven Blueprint Section 4 & 5

---

## 1. Domain Structure & Classification

### Core & Runtime Authority
- `src/fusion.ts`: Primary monolithic runtime daemon (single-writer loop, process lock server, session logging, reconciliation watchdog). [PRODUCTION]
- `src/core.ts`: Core trading math (mulBps, exitDecision, risk tracking, log sanitization). [PRODUCTION]
- `src/config.ts`: Environment parser and core configuration boundary. [PRODUCTION]
- `src/config-authority.ts`: Central dynamic configuration authority with freeze/snapshot capabilities. [PRODUCTION]
- `src/store.ts`: SQLite / DB transaction state store. [PRODUCTION]
- `src/db-worker.ts`: Dedicated worker thread for non-blocking WAL checkpointing and audit pruning. [PRODUCTION]
- `src/session-logger.ts`: Append-only structured JSONL event journal and CSV fill ledger. [PRODUCTION]
- `src/candidate-snapshot.ts`: Deterministic CandidateId, feature extraction schema V1, and outcome labeling. [PRODUCTION]

### Command & Control Plane
- `src/command-gateway.ts`: Authoritative paper/simulation command gateway. Rejects direct live actions; enforces idempotency and latched emergency stop. [PRODUCTION]
- `src/operator-read-model.ts`: Time-fenced (4s TTL) ordered projection generator. Maps capabilities (`open`, `increase`, `reduce`, `close`) to authoritative backend state. [PRODUCTION]
- `src/projection-service.ts`: Singleton read-only projection service serving terminal HTTP/WS clients. [PRODUCTION]
- `src/lifecycle/system-lifecycle.ts`: Finite state machine governing operational states (`NORMAL`, `DEGRADED`, `REDUCE_ONLY`, `SAFETY_LOCKED`, etc.). [PRODUCTION]

### Ingestion & Market Data Plane
- `src/rpc.ts`: Multi-endpoint Solana RPC connection pool with latency and health tracking. [PRODUCTION]
- `src/feed.ts`: PumpPortal WebSocket transport and reconnect manager. [PRODUCTION]
- `src/market.ts`: Raydium / Pump curve reserve math and on-chain snapshotting via `@pump-fun/pump-sdk`. [PRODUCTION]
- `src/discovery.ts`: Candidate admission, veto evaluation, and discovery snapshots. [PRODUCTION]
- `src/market-hub.ts`: Cross-venue aggregation, polling loop, and DexScreener/RugCheck enrichment. [PRODUCTION]
- `src/platform/ingestion/provider-health.ts`: Bounded rolling-window circuit breaker (`CLOSED` -> `OPEN` -> `PROBING` -> `RECOVERING` -> `HEALTHY`), HTTP 429 backoff, feed staleness evaluator. [PRODUCTION]
- `src/platform/ingestion/pumpportal-validator.ts`: Frame validation, monotonic slot checking, signature deduplication, numeric sanity. [PRODUCTION]

### Execution & Settlement Plane
- `src/execution.ts`: Live/paper transaction builder, compute budget, and Jito tip packing. [PRODUCTION]
- `src/execution-engine.ts`: 6-stage lifecycle execution engine (`IDLE` -> `VALIDATING` -> `QUOTING` -> `SIGNING` -> `SUBMITTING` -> `SETTLED`). [PRODUCTION]
- `src/platform/execution/authority.ts`: Strict structural separation between `SimulationExecutionAuthority` and `LiveExecutionAuthority`. [PRODUCTION]
- `src/platform/execution/execution-authority-readiness.ts`: Attestation matrix evaluator for 7 required operational capabilities. [PRODUCTION]
- `src/platform/execution/revalidator.ts`: Pre-signing revalidator checking quote freshness and curve reserves. [PRODUCTION]
- `src/platform/execution/solaris/`: SOLARIS-NEXUS bimodal router (Jito MEV bundle vs Direct TPU QUIC), leader schedule tracker, and dynamic tip oracle. [PRODUCTION]

### Security, Signing & Custody
- `src/platform/signing/signer-service.ts`: Isolated Ed25519 signer service with persist-before-broadcast durability. [PRODUCTION / FAIL-CLOSED]
- `src/platform/signing/settlement-firewall.ts`: Transaction-effect firewall inspecting destinations, mints, and token programs. [PRODUCTION / FAIL-CLOSED]
- `src/platform/security/token-gateway.ts`: Token admission gate vetting freeze/mint authority and top-holder concentration. [PRODUCTION]
- `src/platform/security/wallet-graph.ts`: Lineage and cluster analysis for serial developer rugs. [PRODUCTION]

### Intelligence & Strategy Plane
- `src/strategy.ts`: Base Strategy evaluator interface and status registry. [PRODUCTION]
- `src/intelligence/signals/hsi.ts`: Decomposed HSI engine (7 decomposed signal components, Herfindahl concentration index). [PRODUCTION]
- `src/intelligence/evidence/market-provenance.ts`: Streamflow contract verification, airdrop & batch distribution segregation. [PRODUCTION]
- `src/intelligence/research/capital-regime.ts`: Macro yield benchmark hurdles (Exponent, Lulo, Morpho). [PRODUCTION]
- `src/intelligence/spie/`: Scientific Net EV opportunity ranking and half-Kelly position sizing. [PRODUCTION]
- `src/platform/orchestrator.ts`: Multi-user model orchestrator with quarantined economic execution. [PRODUCTION]

### Reliability & Release Certification
- `src/platform/certification/release-certification.ts`: 13-gate release certification authority. [PRODUCTION / FAIL-CLOSED]
- `src/platform/recovery/flight-recorder.ts`: Incident flight recorder for anomaly diagnostics. [PRODUCTION]
- `src/platform/sentinel/`: Market safety and ML risk sentinels. [PRODUCTION]

### UI & Operator Terminal
- `terminal/src/`: React 18 terminal application.
  - `AetherFlux.jsx`: Canonical token discovery workspace.
  - `IncidentCommandView.jsx`: Incident history and blocker inspector.
  - `OperatorStatusStrip.jsx`: Global system status, provider health tiles, trust vectors.
  - `LiveDashboard.jsx`: Consolidated operational terminal dashboard.

---

## 2. Test Verification Reality

- Total Automated Tests: **794 passed, 0 failed**.
- Core Architecture (`test/*.test.mjs`): 244 tests.
- Intelligence (`test/intelligence/*.test.mjs`): 288 tests.
- Platform Infrastructure (`test/platform/*.test.mjs`): 81 tests.
- Terminal & UI (`terminal/test/*.test.mjs`): 181 tests.
