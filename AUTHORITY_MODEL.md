# SYLPH FUSION — AUTHORITY MODEL & CONTROL LATTICE
**Standard:** Master Quantitative Upgrade §§ 2.4, 7, 10, 11, 23, 24, 25  
**Core Invariant:** Intelligence never silently becomes authority. Execution requires deterministic, multi-layer validation.

---

## 1. SEPARATION OF CONCERNS: THE SEVEN AUTHORIZATION GATES

Under the SYLPH FUSION institutional architecture, the lifecycle of a capital commitment is strictly decoupled across seven independent boundaries:

```text
[1. PREDICTION] ────► [2. RECOMMENDATION] ────► [3. RISK APPROVAL] ────► [4. CAPITAL AUTH]
  (ML / Multipliers)        (Unified Decision)        (Risk Waterfall)         (Capital Kernel)
                                                                                       │
[7. SETTLEMENT] ◄──── [6. SIGNING INTENT] ◄──── [5. EXECUTION PERMIT] ◄────────────────┘
  (On-Chain Settle)        (Vault Signer)            (Pre-Sign Barrier)
```

1. **Prediction (Intelligence):**
   - *Engines:* `Multiplier-X`, `NEXUS-MX`, `SpieEngine`, `HierarchicalRegimeEngine`.
   - *Output:* Probabilities, expected value (bps), confidence scores.
   - *Authority:* ZERO capital authority. Cannot touch keys, cannot reserve cash.

2. **Recommendation (Decision Boundary):**
   - *Engine:* `UnifiedDecisionEngine`.
   - *Function:* Canonical reconciliation of competing upstream signals.
   - *Rule:* Security vetoes and risk blocks strictly override high EV scores.
   - *Output:* Immutable `UnifiedOpportunityDecision` with cryptographic provenance.

3. **Risk Approval (Portfolio Bounds):**
   - *Engine:* `RiskEngine` / `CapitalRiskX`.
   - *Function:* Evaluates token concentration, route exposure, portfolio drawdown, and correlation.
   - *Output:* Boolean approval + hard spend limit (`maxRiskUsd`).

4. **Capital Authorization (Capital Truth Kernel):**
   - *Engine:* `CapitalKernel` & `CapitalTruthEngine`.
   - *Function:* Validates formal invariants (`INV_1` to `INV_12`).
   - *Output:* Atomic `ReservationCertificate` + `CommitCertificate` in write-ahead log.

5. **Execution Authorization (Pre-Sign Barrier):**
   - *Engine:* `RevocationEngine`.
   - *Function:* Last-moment verification immediately before signing.
   - *Rule:* Verifies TOCTOU revocation epoch and checks scopes (`TOKEN`, `ROUTE`, `WALLET`, `SIGNER`).

6. **Signing Authorization (Zone 0 Custody):**
   - *Engine:* `VaultSigner` & `VeritasTransactionDecoder`.
   - *Function:* Validates transaction manifest against `EffectSpec` and commit certificate bounds.
   - *Rule:* Signs atomically only if all 15 pre-sign assertions hold.

7. **Settlement Confirmation (Economic Truth):**
   - *Engine:* `CapitalTruthEngine.settleExecution()` / `settleExit()`.
   - *Function:* Finalizes double-entry balance updates, releases reservations, registers confirmed positions.
   - *Rule:* Enforces idempotent settlement (`Set<string>`) to prevent duplicate balance deductions.

---

## 2. THE AUTHORITY LATTICE (A0 TO A5)

The system operates within a formal hierarchical lattice governed by `CapitalKernel`:

```text
    A5_NORMAL (Full Capabilities: New entries, exits, scale-ins)
       │
    A4_LIMITED_INCREASE (Constrained sizing: Max 50% normal capital)
       │
    A3_MAINTAIN (No new token discovery; hold existing positions)
       │
    A2_REDUCE_ONLY (Strictly no new exposure; exits fully permitted)
       │
    A1_CANCEL_ONLY (Cancel pending orders, no new transactions)
       │
    A0_OBSERVE_ONLY (Complete operational shutdown; read-only telemetry)
```

### Transition Semantics:
- **Downward Transition (Downgrade):**
  - Triggered instantaneously by any system-integrity violation (`INV_3`, `INV_4`, `INV_7`, `INV_9`, `INV_10`, `INV_11`), severe RPC splits, or circuit-breaker trips.
  - Can jump directly from `A5_NORMAL` to `A2_REDUCE_ONLY` or `A0_OBSERVE_ONLY`.
- **Upward Transition (Recovery):**
  - **Never automatic on timeout.**
  - Requires a cryptographic `RecoveryCertificate` verifying healthy providers, fresh market feeds, zero unresolved intents, and clean settlement.

---

## 3. EXIT SAFETY: PREVENTING TRAPPED CAPITAL

A foundational rule of SYLPH FUSION is that safety mechanisms must never make it impossible to exit a dangerous position.
- In `A2_REDUCE_ONLY`, `CapitalKernel.verifyCapitalAction()` blocks `INCREASE_EXPOSURE` with `is_authorized: false`.
- Simultaneously, `DECREASE_EXPOSURE` and `EMERGENCY_EVACUATE` pass with `is_authorized: true`.
- Position exits carry priority fee allowances and relaxed admission gates to ensure capital can always be evacuated under stressed conditions.
