# SYLPH FUSION — RECONCILIATION & SETTLEMENT MODEL
**Standard:** Master Quantitative Upgrade §§ 29, 30, 31  
**Core Invariant:** RPC error != transaction failure. Ambiguous submissions must be reconciled against on-chain reality before any retry.

---

## 1. SUBMISSION DELIVERY STATE MACHINE

Transactions submitted to Solana validators traverse explicit delivery states managed by `JanusReconciler`:

```text
       [NOT_SUBMITTED]
              │
              ▼
        [SUBMITTING]
              │
              ▼
         [SUBMITTED]
         │         │
         ▼         ▼
    [CONFIRMED]  [AMBIGUOUS] (RPC drop, network timeout, blockhash valid)
         │         │
         │         ▼
         │   [RECONCILING] (Poll getSignatureStatuses across backup RPCs)
         │         │
         │    ┌────┴────────────────────────┐
         │    ▼                             ▼
         │  [LANDED]                   [EXPIRED] (Current slot > expiry slot)
         │    │                             │
         └───►├─────────────────────────────┘
              ▼
         [FINALIZED] (Economic settlement recorded in CapitalTruthEngine)
```

---

## 2. THE AMBIGUOUS DELIVERY CONTRACT

When an RPC connection drops or times out during submission:
1. **Never Blindly Resubmit:** Creating a new transaction with a new blockhash while the previous transaction is still valid in the validator mempool risks a catastrophic double-spend.
2. **Retain Reservation:** `JanusReconciler` mandates `should_retain_reservation === true` until the submitted transaction's `expiration_slot` is surpassed by the cluster.
3. **Resend Exact Signature:** While `current_slot <= expiration_slot`, the identical signed serialized transaction is rebroadcast to multiple RPC nodes (`should_resend_exact_signature === true`).
4. **Release Only Upon Verified Expiration:** Only after the cluster slot exceeds `expiration_slot` and confirmed receipt confirms the transaction never landed is the reservation released (`should_rebuild_new_transaction === true`).

---

## 3. STARTUP RECONCILIATION & CRASH RECOVERY

Upon process initialization or crash-restart:
1. **Conservative Initialization:** The system initializes into `A0_OBSERVE_ONLY`.
2. **Journal Ingestion:** Replays the Write-Ahead Log (`CanonicalCapitalEvent[]`) to reconstruct balances and reservations.
3. **On-Chain Balance Sync:** Queries Solana RPC for actual hot wallet SOL balance and token ATAs.
4. **Discrepancy Reconciliation:** If confirmed cash differs from on-chain truth, records a `RECONCILIATION_CORRECTION` event in the ledger.
5. **Pending Transaction Resolution:** Checks signature status for any in-flight intents in the journal.
6. **Lattice Promotion:** Only after all pending executions are resolved and double-entry conservation validates is authority promoted to `A5_NORMAL`.
