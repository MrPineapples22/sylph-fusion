# SYLPH FUSION — CANONICAL SYSTEM TOPOLOGY MAP
**Document Version:** 2.0.0 (Institutional Architecture Certification)  
**Authority:** Principal Systems Architect & Quantitative Infrastructure Lead  
**Classification:** Authoritative Technical Specification

---

## 1. END-TO-END CANONICAL EXECUTION FLOW

```text
               [SOLANA RPC / YELLOWSTONE gRPC / PUMP WEBSOCKETS]
                                      │
                                      ▼
                        [Provider Health & Freshness Tracker]
                                      │
                                      ▼
                           [Chain Truth Engine]
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
   [Point-in-Time Feature Store]            [Token Program Inspector]
                 │                                         │
                 ▼                                         ▼
  [Wallet Intelligence & Actor Graph]        [Token Security & Veto Rules]
                 │                                         │
                 ▼                                         ▼
      [Capital Flow Graph]                   [Decomposed HSI & Microstructure]
                 │                                         │
                 ▼                                         ▼
   [Multi-Model Suite / Multiplier-X]       [Digital Market Twin / SPIE Engine]
                 │                                         │
                 └────────────────────┬────────────────────┘
                                      │
                                      ▼
                       [UNIFIED DECISION ENGINE]
                (Canonical Reconciliation Boundary)
                     • Vetoes strictly override EV
                     • Generates immutable DecisionId
                     • Attaches cryptographic Provenance
                                      │
                                      ▼
                         [STRATEGY & RISK BOUNDARY]
                     • Dynamic Route Identity
                     • Position & Correlation Bounds
                     • Drawdown & Liquidity Constraints
                                      │
                                      ▼
                        [CAPITAL KERNEL (LATTICE)]
                     • Modes: A0 -> A1 -> A2 -> A3 -> A4 -> A5
                     • 12 Formal Non-Negotiable Invariants
                     • Max Open Positions: Local Rejection
                     • System Integrity Violations -> Downgrade
                                      │
                                      ▼
                       [CAPITAL TRUTH ENGINE (WAL)]
                     • Append-Only Cryptographic Ledger
                     • Atomic Reservation & Commit Certificates
                     • Strict Double-Entry Conservation
                                      │
                                      ▼
                     [PRE-SIGN REVOCATION BARRIER]
                     • Scopes: GLOBAL, TOKEN, POSITION, ROUTE, WALLET, PROGRAM, SIGNER
                     • TOCTOU Revocation Epoch Fencing
                     • Selective Archival & Recovery Resolution
                                      │
                                      ▼
                     [INTENT EQUIVALENCE (VERITAS)]
                     • EffectSpec vs TransactionManifest
                     • Zero-Trust Program & ATA Validation
                     • Sol Debit & Jito Tip Bounds
                                      │
                                      ▼
                      [VAULT SIGNER (ZONE 0 GATE)]
                     • Hardware / KMS Isolation
                     • 15 Pre-Sign Atomic Assertions
                     • Post-Sign Revocation Race Quarantine
                                      │
                                      ▼
                     [SUBMISSION & RELAY PIPELINE]
                     • Multi-RPC Quorum / Jito Bundles
                     • Nonce / Expiration Slot Binding
                                      │
                                      ▼
                      [JANUS RECONCILIATION ENGINE]
                     • Ambiguous Delivery Resolution
                     • Slot Timeout vs Signature Status
                     • Prevents Double-Spend Retries
                                      │
                                      ▼
                        [ON-CHAIN SETTLEMENT ENGINE]
                     • Atomic settleExecution / settleExit
                     • Token & SOL Delta Balance
                     • Idempotent Intent Tracking (Set<string>)
                     • Realized PnL & Fee Attribution
                                      │
                                      ▼
                   [OUTCOME TRUTH & LEARNING PIPELINE]
                     • OutcomeGroundTruthLedger
                     • Ties Settlement -> Decision -> Model Version
                     • Drift Engine & Champion-Challenger Promotion
```

---

## 2. SUBSYSTEM INVENTORY & CONTRACTS

| Subsystem Node | Source Location | Authoritative Truth Owned | Upstream Inputs | Downstream Consumers | Failure Mode |
|---|---|---|---|---|---|
| **ChainTruthEngine** | `src/intelligence/chain/` | Canonical slot, block time, raw blocks | Yellowstone gRPC, Solana RPC | PIT Feature Store, Capital Flow | Fail-closed, halts downstream |
| **TokenInspector** | `src/intelligence/token/` | Mint/Freeze authority, program owner, transfer hooks | RPC getAccountInfo | Unified Decision Engine, Safety Kernel | Unknown authority treated as active |
| **WalletIntelligence** | `src/intelligence/adversarial/` | Funding clusters, insider dispersal, sybil velocity | Transaction graph, historical ledger | Unified Decision, Risk Waterfall | Informational downgrade, risk veto |
| **CapitalFlowGraph** | `src/intelligence/graph/` | Micro-flow topology, coordinated buy clusters | Chain events, transfer streams | SPIE Engine, Multi-Model Suite | Confidence attenuation |
| **UnifiedDecisionEngine** | `src/intelligence/decision/` | Canonical Opportunity Decision & Provenance | SPIE, Veto Rules, Risk Limits, Models | Strategy Policy, Capital Kernel | Hard veto overrides all upside |
| **CapitalTruthEngine** | `src/intelligence/capital/` | Cash, reservations, positions, double-entry ledger | Kernel auth, settlement receipts | Portfolio Evacuation, Risk Engine | Invariant assertion crash / state lock |
| **CapitalKernel** | `src/intelligence/capital/` | Global Authority Mode (A0-A5 Lattice) | CapitalTruth snapshot, proof leases | Execution Authority, Vault Signer | Local rejection vs A2_REDUCE_ONLY |
| **RevocationEngine** | `src/intelligence/revocation/` | RevocationEpoch, active/resolved scoped revocations | Circuit breakers, feed monitors, risk | Pre-sign Barrier, Vault Signer | Epoch bump aborts all in-flight ops |
| **VeritasDecoder** | `src/intelligence/vault/` | Transaction Manifest & Intent Equivalence | Serialized tx bytes, EffectSpec | VaultSigner | Immediate rejection (`INTENT_MISMATCH`) |
| **VaultSigner** | `src/intelligence/vault/` | Custody Isolation, atomic signatures | EffectSpec, CommitCert, Manifest | Submission Pipeline | Refusal to sign, instant quarantine |
| **JanusReconciler** | `src/intelligence/reconciliation/` | Delivery status (CONFIRMED, TIMEOUT, EXPIRED) | RPC status, slot clock | CapitalTruthEngine, Haven Mode | Hold reservation until slot expiration |
| **OutcomeTruth** | `src/intelligence/learning/` | Verified economic outcomes, attribution | Settlement events, DecisionTrace | DriftEngine, Research Lab | Right-censored tracking |

---

## 3. PARALLEL TELEMETRY & OPERATOR PROJECTION

The Operator Terminal and telemetry strip consume read-only snapshots from the unified pipeline:
- **Token Safety Projection:** Derived from `TokenProgramInspector` and `CleanRoomStateEngine` (e.g. `ELIGIBLE`, `VETOED`).
- **Capital Authority Projection:** Derived from `CapitalKernel` (e.g. `A5_NORMAL`, `A2_REDUCE_ONLY`, `A0_OBSERVE_ONLY`).
- **Signer Projection:** Derived from `VaultSigner` (e.g. `READY`, `UNAVAILABLE`, `QUARANTINED`).
- **Market Data Freshness:** Derived from `ProviderHealthTracker` (e.g. `FRESH`, `STALE`, `DISCONNECTED`).

**Guaranteed Separation:** The UI never merges token safety with capital authority into a single boolean; an eligible token cannot be executed if capital authority is `A2_REDUCE_ONLY`.
