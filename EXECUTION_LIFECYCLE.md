# SYLPH FUSION — EXECUTION LIFECYCLE & IDENTITY SPECIFICATION
**Standard:** Master Quantitative Upgrade §§ 8, 9, 25, 26  
**Core Invariant:** One immutable execution identity flows end-to-end. Portfolio mutations occur only after confirmed settlement.

---

## 1. THE COMPLETE CAPITAL & POSITION LIFECYCLE STATE MACHINE

Every trading action advances through formal states with explicit forward transitions and fail-closed rollback paths:

```text
       [NONE]
         │
         ▼
    [PROPOSED]  (Candidate scored; 0 capital mutation, 0 phantom position)
         │
         ▼
    [RESERVED]  (CapitalTruthEngine.reserveCapital: cash marked reserved in WAL)
         │
         ▼
   [AUTHORIZED] (CommitCertificate generated, CapitalKernel invariants pass)
         │
         ▼
   [TRANSACTION] (EffectSpec generated, route verified, manifest decoded)
         │
         ▼
     [SIGNED]   (VaultSigner verifies 15 pre-sign assertions, releases sig)
         │
         ▼
    [SUBMITTED] (Relayed via RPC/Jito; registered in JanusReconciler)
         │
    ┌────┴────────────────────────┐
    ▼                             ▼
[CONFIRMED]                 [AMBIGUOUS] (RPC timeout before blockhash expiry)
    │                             │
    │                      [RECONCILING] (Janus polls on-chain state)
    │                             │
    ├─────────────────────────────┘
    ▼
  [OPEN]        (settleExecution: confirmed position registered in truth)
    │
    ├─────────────────────────────┐
    ▼                             ▼
[REDUCING]                    [CLOSING]
    │                             │
    ▼                             ▼
[SETTLING]                    [SETTLING]
    │                             │
    └──────────────┬──────────────┘
                   ▼
                [CLOSED] (settleExit: cost basis relieved, realized PnL recorded)
```

---

## 2. EXECUTION IDENTITY PRESERVATION

A single, tamper-proof execution identifier (`intent_id` / `execution_id`) binds every phase of the lifecycle:

```text
DecisionTrace (eventId)
   └── intent_id: "intent_<mint>_<slot>_<timestamp>"
         ├── ReservationCertificate (reservation_id)
         ├── CommitCertificate (certificate_id, certificate_hash)
         ├── EffectSpec (max_sol_debit, allowed_programs)
         ├── TransactionManifest (programs, accounts, debit)
         ├── SignatureRequest / SignatureResponse (sign_operation_id)
         ├── JanusReconciler (signature, submitted_slot, expiration_slot)
         ├── CapitalTruthEvent (EXECUTION_SETTLED / POSITION_CLOSED)
         └── OutcomeGroundTruth (attribution to decisionId & strategyVersion)
```

---

## 3. REMOVAL OF PHANTOM POSITIONS

### Historical Bug Root Cause:
In earlier iterations, `MasterOrchestrator` invoked `this.portfolioEvac.registerPosition(...)` during the initial candidate screening phase (line 1528) with a placeholder size of 0.5 SOL. As a result, merely evaluating 5 prospective tokens permanently filled open-position capacity, preventing legitimate trades from executing.

### Permanent Resolution:
- Candidate discovery and scoring are purely analytical; they have zero side-effects on `PortfolioEvacuationEngine` or `CapitalTruthEngine`.
- Positions are registered in portfolio memory strictly within the post-settlement callback after verified on-chain confirmation.
