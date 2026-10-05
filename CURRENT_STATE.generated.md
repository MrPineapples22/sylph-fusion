# SYLPH FUSION — CURRENT STATE (MECHANICALLY GENERATED)
Generated At: 2026-10-05T02:44:24.948Z
Audited Baseline: d9522b5e34663d55920e8489fda948a02db08586

## Production Posture (Fail-Closed Enforcement)
* `PAPER_ONLY_RUNTIME`: **TRUE** (Live execution strictly disabled)
* `LIVE_SIGNING_UNAVAILABLE`: **TRUE** (Zero live private keys or broadcast capability)
* `PRODUCTION_CAPITAL_AUTHORITY_BLOCKED`: **TRUE** (Live capital authority disabled)

## Core Subsystem Status
| Subsystem | Canonical Path | Status | Evidence |
|---|---|---|---|
| Evidence Classes | `src/platform/assurance/evidence-class.ts` | IMPLEMENTED + UNIT_TESTED + AUTHORITY_CONNECTED | 14 canonical classes, illegal upgrade block |
| Synthetic Authority Elimination | `src/platform/assurance/no-synthetic-authority.ts` | IMPLEMENTED + INTEGRATION_TESTED | Zero favorable defaults, CI scanner passes |
| Issuer Manifests | `src/platform/assurance/issuer-manifest.ts` | IMPLEMENTED + AUTHORITY_CONNECTED | 13 Ed25519 authority roles separated |
| Complete State Root V2 | `src/platform/pipeline/state-root-v2.ts` | IMPLEMENTED + UNIT_TESTED | 47+ fields bound, property tested |
| Durable Fusion Journal Store | `src/platform/pipeline/fusion-journal-store.ts` | IMPLEMENTED + DURABLE + UNIT_TESTED | CAS revision N->N+1, STALE_PROPOSAL guard |
| Fusion Cross-Proof Verifier | `src/platform/pipeline/fusion-proof-verifier.ts` | IMPLEMENTED + INTEGRATION_TESTED | Journal + Certificate + State cross-verification |
| Canonical Binary Encoding | `src/platform/pipeline/canonical-encoding-v1.ts` | IMPLEMENTED + UNIT_TESTED + DUAL_LANGUAGE | Exact bit-level parity TS <-> Rust |
| Rust Authority Kernel | `authority-kernel/src/lib.rs` | IMPLEMENTED + UNIT_TESTED | Invariants INV_AUTH_001-011 enforced |
| Node <-> Rust Boundary | `src/platform/execution/rust-authority-boundary.ts` | IMPLEMENTED + SCAFFOLDED | Isolated binary bundle evaluation |
| Terminality Authority | `src/platform/execution/terminality-authority.ts` | IMPLEMENTED + AUTHORITY_CONNECTED | Sole authority: LANDED, CERTIFIED_NOLAND |
| Typed NoLand Certificate | `src/platform/execution/no-land-certificate.ts` | IMPLEMENTED + AUTHORITY_CONNECTED | Multi-provider witness, Ed25519 signed |
| Preemption Side-Effect Fence | `src/platform/execution/side-effect-fence.ts` | IMPLEMENTED + UNIT_TESTED | CLAIMED -> IN_FLIGHT -> SUCCEEDED |
| Economic Authority Store | `src/intelligence/capital/economic-authority-store.ts` | IMPLEMENTED + DURABLE + RUNTIME_CONNECTED | Sole capital owner, unknown capital quarantine |
| Unified Pipeline Unit | `src/platform/pipeline/unified-unit.ts` | IMPLEMENTED + RUNTIME_CONNECTED | Mandatory runtime component, 12 certificates |
| All-Attempt Dataset | `src/platform/calibration/all-attempt-dataset.ts` | IMPLEMENTED + EMPIRICALLY_VALIDATED | 8-stage shortfall, conditional slippage |
| Failure-Conditioned Calibrator | `src/intelligence/science/failure-conditioned-calibrator.ts` | IMPLEMENTED + UNIT_TESTED | Disaggregated landing, success, profit |
| Cohort Maturity Engine | `src/platform/cohort/cohort-maturity.ts` | IMPLEMENTED + UNIT_TESTED | Multi-dimensional entropy diversity |
| LabelForge V2 | `src/intelligence/science/labelforge-v2.ts` | IMPLEMENTED + UNIT_TESTED | Point-in-time causality, revocation checks |
| R&D Governor Cryptographic Proof | `src/intelligence/research-governor/rd-governor.ts` | IMPLEMENTED + AUTHORITY_CONNECTED | Ed25519 signatures, single-step progression |
| Strategy Ecology Registry | `src/intelligence/signal-ecology/mechanism-fingerprint.ts` | IMPLEMENTED + UNIT_TESTED | Mechanism fingerprints, negative knowledge |
| Residual Ledger & Theory | `src/intelligence/science/residual-ledger.ts` | IMPLEMENTED + RESEARCH_VALIDATED | Systematic bias clustering, preregistered laws |
| Control Root Supervisor | `src/platform/control/control-root.ts` | IMPLEMENTED + AUTHORITY_CONNECTED | Controller lease, epoch fencing, stale proposal |
| Operator Command Gateway | `src/platform/control/operator-command.ts` | IMPLEMENTED + AUTHORITY_CONNECTED | Signed command envelopes, in-flight carryover |
| Assurance Monitors | `src/platform/assurance/assurance-monitors.ts` | IMPLEMENTED + UNIT_TESTED | Monitor blindness, margin velocity |
| Emergency Exit Partition | `src/intelligence/capital/emergency-partition.ts` | IMPLEMENTED + RUNTIME_CONNECTED | Guaranteed A2 reduce/close capital reserve |
| Twin Red Team | `src/intelligence/reality-gap/twin-red-team.ts` | IMPLEMENTED + INTEGRATION_TESTED | Adversarial exploit discovery, trust penalty |
| Liquidity Dependency Graph | `src/intelligence/liquidity/liquidity-dependency-graph.ts` | IMPLEMENTED + UNIT_TESTED | Joint exit stress, shared pool bottlenecks |
| Deterministic Release Root | `src/platform/assurance/release-root.ts` | IMPLEMENTED + RELEASE_CERTIFIED | Cryptographically binds commit, lock, tools |
