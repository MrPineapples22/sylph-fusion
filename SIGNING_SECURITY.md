# SYLPH FUSION — SIGNING SECURITY & CUSTODY ISOLATION
**Standard:** Master Quantitative Upgrade §§ 27, 28  
**Core Invariant:** Raw private keys never touch application memory. Signing requires matching durable authorized intent.

---

## 1. ZONE 0 CUSTODY ISOLATION ARCHITECTURE

The signing subsystem (`VaultSigner`) operates in an isolated cryptographic enclave (Zone 0).
- The raw keypair is never exposed to the AI, strategy, or terminal threads.
- Private key operations cannot be invoked via external HTTP/RPC requests.
- All signing requests must present a complete cryptographic envelope containing:
  - `EffectSpec` (Authorized bounding contract)
  - `TransactionManifest` (Decoded instructions & debit requirements)
  - `CommitCertificate` (Write-ahead log commitment proof)
  - Active Control Epoch & Revocation Epoch
  - Software Production Root Hash

---

## 2. THE 15 PRE-SIGN ATOMIC ASSERTIONS

Before `VaultSigner` produces a signature, the following assertions are evaluated sequentially:

1. **Simulation & Hardware Gate:** Rejects live signing if KMS / custody enclave is uninitialized.
2. **Capability Whitelist:** Accepts only `SIGN_ENTRY`, `SIGN_POSITION_REDUCTION`, `SIGN_EXIT`, `SIGN_EXECUTION_FEE`. Arbitrary transfers are blocked (`UNAUTHORIZED_CAPABILITY`).
3. **Control Epoch Verification:** `request.active_control_epoch === commit_cert.control_epoch === vault.currentControlEpoch`.
4. **Revocation Epoch Verification:** `request.active_revocation_epoch === commit_cert.revocation_epoch === vault.currentRevocationEpoch`.
5. **Software Root Attestation:** `request.production_root === vault.productionRoot` (prevents unauthorized binary execution).
6. **Durable WAL Confirmation:** `commit_certificate.is_durable_committed === true`.
7. **Proof Lease Validity:** `request.proof_lease_valid === true`.
8. **Hard Transaction Cap:** `effect_spec.max_sol_debit <= vault.maxSolPerTx`.
9. **Daily Spending Cap:** Cumulative daily spend does not exceed `dailyCapSol`.
10. **Intent Equivalence:** `VeritasTransactionDecoder.verifyIntentEquivalence(effect_spec, manifest)` returns `is_equivalent === true`.
11. **Program Whitelist:** All programs in `manifest.programs` exist within `effect_spec.allowed_programs`.
12. **Zero Unknown Instructions:** `manifest.has_unknown_instructions === false`.
13. **Zero Authority Delegation:** `manifest.transfers_authority === false` and `manifest.assigns_delegate === false`.
14. **Commit Certificate Debit Bound:** `manifest.estimated_sol_debit <= commit_certificate.max_sol_debit`.
15. **Post-Sign TOCTOU Race Quarantine:** If `RevocationEpoch` advanced during the milliseconds of signature generation, the signature is permanently quarantined (`QUARANTINED`) and never released to the relayer.

---

## 3. DURABLE SIGNING JOURNAL

Every signature operation generates an immutable `SignedOperationRecord` stored in the journal:
- `sign_operation_id`
- `intent_id`
- `signature`
- `signing_state` (`RELEASED`, `QUARANTINED`, `REJECTED`)
- `execution_timestamp_ms`

This journal guarantees idempotency, prevents signature replay, and ensures complete auditability across crash restarts.
