# SYLPH FUSION — GLOBAL INVARIANT REGISTRY
**Document Version:** 2.0.0  
**Authority:** Quantitative Risk & Reliability Engineering  
**Mandate:** Non-negotiable formal invariants verified continuously at runtime.

---

## 1. FORMAL CAPITAL & EXECUTION INVARIANTS

### `INV_1_MAX_OPEN_POSITIONS`
- **Statement:** The number of concurrently open positions cannot exceed `maxOpenPositions`.
- **Owner:** `CapitalKernel`
- **Scope:** Local Action (`INCREASE_EXPOSURE`)
- **Inputs:** `current_open_positions_count`, `maxOpenPositions`
- **Check Location:** `CapitalKernel.verifyCapitalAction()`
- **Severity:** FATAL for proposed action
- **Authority Impact:** **LOCAL ACTION REJECTION**. Does NOT downgrade global authority mode (`A5_NORMAL` remains intact).
- **Recovery Condition:** Settle exit/close on an existing position via `CapitalTruthEngine.settleExit()`.
- **Verification Tests:** `release-blocking-governance.test.mjs` (Test 1, Test 2)

---

### `INV_2_RESERVATION_EXISTS`
- **Statement:** Any capital increase requires an active atomic reservation certificate in `CapitalTruthEngine`.
- **Owner:** `CapitalTruthEngine` / `CapitalKernel`
- **Scope:** Intent Execution
- **Inputs:** `has_active_reservation`, `reservation_id`
- **Check Location:** `CapitalKernel.verifyCapitalAction()`
- **Severity:** FATAL
- **Authority Impact:** Rejection of proposed execution.
- **Recovery Condition:** Acquire valid atomic reservation certificate.
- **Verification Tests:** `release-blocking-governance.test.mjs` (Test 8)

---

### `INV_3_CONTROL_EPOCH_MATCH`
- **Statement:** The request control epoch must equal the active control epoch across the entire execution lifecycle.
- **Owner:** `CapitalKernel`
- **Scope:** System Integrity
- **Inputs:** `request_control_epoch`, `active_control_epoch`
- **Check Location:** `CapitalKernel.verifyCapitalAction()`, `VaultSigner.processSignatureRequest()`
- **Severity:** CRITICAL
- **Authority Impact:** System Integrity Failure -> **Downgrades authority mode to `A2_REDUCE_ONLY`**.
- **Recovery Condition:** Reconcile with `RecoveryCertificate` signed at current epoch.
- **Verification Tests:** `capital-authority.test.mjs`

---

### `INV_4_REVOCATION_EPOCH_MATCH` (TOCTOU Fence)
- **Statement:** The revocation epoch captured at request initiation must equal the active epoch at the pre-sign barrier.
- **Owner:** `RevocationEngine` / `CapitalKernel`
- **Scope:** Security & Execution Gate
- **Inputs:** `request_revocation_epoch`, `currentEpoch`
- **Check Location:** `RevocationEngine.verifyRevocationBarrier()`, `CapitalKernel.verifyCapitalAction()`
- **Severity:** CRITICAL
- **Authority Impact:** Immediate rejection (`STALE_EPOCH`). If triggered by system-level fault, downgrades to `A2_REDUCE_ONLY`.
- **Recovery Condition:** Re-evaluate token candidate from genesis with fresh market evidence.
- **Verification Tests:** `release-blocking-governance.test.mjs` (Test 6)

---

### `INV_5_SURVIVAL_CERTIFICATE_VALID`
- **Statement:** Increasing exposure requires an unexpired, validated `SurvivalCertificate` verifying digital twin solvency.
- **Owner:** `SurvivalProofEngine` / `CapitalKernel`
- **Scope:** Dual Admission Control
- **Inputs:** `has_valid_survival_certificate`
- **Check Location:** `CapitalKernel.verifyCapitalAction()`
- **Severity:** FATAL for entry
- **Authority Impact:** Local rejection of entry.
- **Recovery Condition:** Compute new valid survival proof with acceptable Distance to Failure (DTF).
- **Verification Tests:** `release-blocking-governance.test.mjs` (Test 8)

---

### `INV_6_EXIT_LEQ_BALANCE`
- **Statement:** An exit or position reduction cannot relieve more cost basis than the confirmed balance of that position.
- **Owner:** `CapitalTruthEngine` / `CapitalKernel`
- **Scope:** Position Reduction (`REDUCE_EXPOSURE`)
- **Inputs:** `proposed_delta_sol`, `confirmed_position_balance_sol`
- **Check Location:** `CapitalTruthEngine.settleExit()`, `CapitalKernel.verifyCapitalAction()`
- **Severity:** FATAL
- **Authority Impact:** Local rejection; does NOT prevent future valid exits.
- **Recovery Condition:** Correct exit size to `min(requested, confirmed_balance)`.
- **Verification Tests:** `capital-authority.test.mjs`

---

### `INV_7_NON_NEGATIVE_AVAILABLE_CASH`
- **Statement:** Confirmed cash minus reserved cash minus emergency reserve must remain $\ge 0$.
- **Owner:** `CapitalTruthEngine`
- **Scope:** Portfolio Solvency
- **Inputs:** `confirmed_cash_sol`, `reserved_cash_sol`, `emergency_reserve_sol`
- **Check Location:** `CapitalTruthEngine.reserveCapital()`, `CapitalKernel.verifyCapitalAction()`
- **Severity:** FATAL
- **Authority Impact:** System Integrity Failure -> Downgrades authority to `A2_REDUCE_ONLY`.
- **Recovery Condition:** External capital rebalance or position exit settlement.
- **Verification Tests:** `capital-authority.test.mjs`

---

### `INV_8_REDUCE_ONLY_NO_INCREASE`
- **Statement:** In degraded authority modes (`A2_REDUCE_ONLY`, `A1_CANCEL_ONLY`, `A0_OBSERVE_ONLY`), new exposure is strictly prohibited while exits and reductions remain fully permitted.
- **Owner:** `CapitalKernel`
- **Scope:** Risk Enforcement
- **Inputs:** `action_type`, `authorityMode`
- **Check Location:** `CapitalKernel.verifyCapitalAction()`
- **Severity:** FATAL for `INCREASE_EXPOSURE`
- **Authority Impact:** Blocks entries; explicitly permits exits (`DECREASE_EXPOSURE`, `CANCEL`).
- **Recovery Condition:** Multi-subsystem recovery verified via `restoreAuthorityWithCertificate()`.
- **Verification Tests:** `release-blocking-governance.test.mjs` (Test 12)

---

### `INV_9_PROOF_NOT_REVOKED`
- **Statement:** Proof leases must not be revoked or expired prior to transaction signing.
- **Owner:** `ApprovalLeaseEngine` / `VaultSigner`
- **Scope:** Execution Proof
- **Inputs:** `is_proof_revoked`, `is_lease_valid`
- **Check Location:** `CapitalKernel.verifyCapitalAction()`, `VaultSigner.processSignatureRequest()`
- **Severity:** CRITICAL
- **Authority Impact:** Rejection of signature request (`EXPIRED_PROOF_LEASE`).
- **Recovery Condition:** Request fresh approval lease with current state root.
- **Verification Tests:** `release-blocking-governance.test.mjs` (Test 17)

---

### `INV_10_UNKNOWN_CAPITAL_LIMIT`
- **Statement:** In-flight capital with ambiguous status cannot exceed `maxUnknownCapitalSol`.
- **Owner:** `CapitalKernel`
- **Scope:** Accounting Uncertainty
- **Inputs:** `unknown_capital_sol`, `maxUnknownCapitalSol`
- **Check Location:** `CapitalKernel.verifyCapitalAction()`
- **Severity:** CRITICAL
- **Authority Impact:** Downgrades to `A2_REDUCE_ONLY`.
- **Recovery Condition:** Janus reconciliation resolves ambiguous in-flight transactions.
- **Verification Tests:** `capital-authority.test.mjs`

---

### `INV_11_UNRESOLVED_INTENTS_LIMIT`
- **Statement:** The number of unconfirmed in-flight intents cannot exceed `maxUnresolvedIntents`.
- **Owner:** `CapitalKernel`
- **Scope:** Submission Concurrency
- **Inputs:** `unresolved_intents_count`, `maxUnresolvedIntents`
- **Check Location:** `CapitalKernel.verifyCapitalAction()`
- **Severity:** CRITICAL
- **Authority Impact:** Downgrades to `A2_REDUCE_ONLY`.
- **Recovery Condition:** Confirm or expire pending transactions via `JanusReconciler`.
- **Verification Tests:** `capital-authority.test.mjs`

---

### `INV_12_CONSERVATION_OF_CAPITAL`
- **Statement:** Cash + Position Cost Basis + Reserved Cash + Realized Losses + Net Fees = Initial Principal + Realized Gains.
- **Owner:** `CapitalTruthEngine`
- **Scope:** Double-Entry Ledger
- **Inputs:** `confirmedCashSol`, `reservedCashSol`, `positions`, `realizedGainsSol`, `realizedLossesSol`, `fees`
- **Check Location:** `CapitalTruthEngine.getDoubleEntryReport()`
- **Severity:** FATAL
- **Authority Impact:** Throws `CONSERVATION_OF_CAPITAL_VIOLATION` on double-entry imbalance.
- **Recovery Condition:** Forensic flight recorder audit and reconciliation correction event.
- **Verification Tests:** `release-blocking-governance.test.mjs` (Test 13, Test 14)

---

### `INV_SIGN_001_INTENT_EQUIVALENCE`
- **Statement:** A signed transaction manifest must represent an authorized subset of the durable `EffectSpec`.
- **Owner:** `VeritasTransactionDecoder` / `VaultSigner`
- **Scope:** Pre-Sign Firewall
- **Inputs:** `manifest`, `effect_spec`, `commit_certificate`
- **Check Location:** `VaultSigner.processSignatureRequest()`
- **Severity:** CRITICAL
- **Authority Impact:** Signature refused (`INTENT_MISMATCH` or `EXCESSIVE_SOL_DEBIT`).
- **Recovery Condition:** Re-construct transaction adhering strictly to authorized bounds.
- **Verification Tests:** `release-blocking-governance.test.mjs` (Test 7, Test 16)

---

### `INV_SETTLE_001_IDEMPOTENT_SETTLEMENT`
- **Statement:** Any execution intent or exit intent can be settled exactly once. Duplicate settlement attempts must fail without mutating balances.
- **Owner:** `CapitalTruthEngine`
- **Scope:** Settlement Firewall
- **Inputs:** `intent_id`, `settledIntents: Set<string>`
- **Check Location:** `CapitalTruthEngine.settleExecution()`, `CapitalTruthEngine.settleExit()`
- **Severity:** FATAL
- **Authority Impact:** Throws `DUPLICATE_SETTLEMENT_ATTEMPT`.
- **Recovery Condition:** None needed; state remains uncorrupted.
- **Verification Tests:** `release-blocking-governance.test.mjs` (Test 14)
