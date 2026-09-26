# SOL / SYLPH — Current vs. Target Architecture & Mismatch Analysis
**Generated:** 2026-09-24  
**Scope:** `c:\Users\juans\Documents\Codex\2026-09-16\sylph-fusion`  
**Reference:** GOD-LEVEL ENGINEERING BLUEPRINT (Sections 1–67)

---

## 1. Architectural Baseline Comparison

| Architectural Requirement | Blueprint Requirement | Current Implementation Status | Gap / Hardening Priority |
| :--- | :--- | :--- | :--- |
| **Fail-Closed Execution** | Missing/stale evidence locks `OPEN` & `INCREASE` while preserving `REDUCE` & `CLOSE` | **VERIFIED IMPLEMENTED** in `operator-read-model.ts` and `execution-authority-readiness.ts` | Maintain regression test coverage across all provider degrade scenarios. |
| **Epistemic Truth** | Distinct semantics for `NEVER_RECEIVED` vs `STALE`; zero false 0.0s | **VERIFIED IMPLEMENTED** in `RiskBanners.jsx` and `provider-health.ts` | Verify that unconfigured optional providers never produce synthetic 0ms latencies or 0s staleness warnings. |
| **Single Authority Per Fact** | Single owner for market state, token identity, risk state, position state | **VERIFIED IMPLEMENTED** via `globalCommandGateway`, `globalProjectionService`, and `globalLifecycle` | Ensure terminal UI components never maintain shadow mutable position stores. |
| **Execution Review Adapter** | Exact transaction review (bytes, programs, accounts, fees, slippage, simulation) | **IMPLEMENTED BUT GATED** (`LiveExecutionAuthority` throws without verified Keypair and confirmed RPC) | Live wire remains deliberately locked until hardware KMS key isolation is fully bound. |
| **Durable Persist-Before-Broadcast** | Disk persistence of intent, reservation, and signed wire before broadcast | **VERIFIED IMPLEMENTED** in `src/fusion.ts` and `durable-live-signer` | Test crash simulation between signing and RPC transmission. |
| **Live Reconciliation Service** | Continuous comparison of internal ledger vs on-chain token accounts & balances | **IMPLEMENTED** in `reconciler.ts` and `fusion.ts` balance check loop | Reconciler flags state discrepancies and locks live automation when balance differs from expected. |
| **SOLARIS-NEXUS Routing** | Dynamic bimodal route planning (Jito bundle vs Direct TPU QUIC) | **VERIFIED IMPLEMENTED** with fail-closed abstain on unobserved contention/tip | Bimodal router strictly abstains if leader schedule or tip floor evidence is missing. |
| **Release Certification Authority** | 13 mandatory production gates evaluated from real evidence | **VERIFIED IMPLEMENTED** (`ReleaseCertificationAuthority` returns `BLOCKED`) | Prevents premature release claims until multi-day mainnet soak evidence is recorded. |

---

## 2. Invariant Register

1. **Unknown is never Zero / Safe / Ready**:
   - Every provider metric entry distinguishes unobserved states from valid zero measurements.
2. **Authority Hierarchy**:
   - On-chain truth $\to$ Provider evidence $\to$ Canonical state $\to$ Advisory ML $\to$ Deterministic Risk $\to$ Isolated Signer $\to$ Reconciliation $\to$ UI projection.
3. **Execution Mode Isolation**:
   - `SimulationExecutionAuthority` uses zero-seed derived keys and strictly marks orders with `paper` signatures.
   - `LiveExecutionAuthority` rejects all simulated signatures, dummy keys, or empty wire payloads.
