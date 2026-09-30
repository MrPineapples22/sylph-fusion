# SYLPH FUSION — STATE OWNERSHIP & AUTHORITY BOUNDARIES
**Specification Standard:** Master Quantitative Upgrade § 2.1  
**Core Invariant:** Exactly ONE authoritative owner per critical system fact. No competing truth.

---

## 1. CANONICAL STATE REGISTRY

| Domain Fact | Authoritative Owner | State Storage / Type | Allowed Mutations | Consumer Access Mode |
|---|---|---|---|---|
| **Provider Health** | `ProviderHealthTracker` | Circular latency buffer, consecutive error counters | Heartbeat pings, RPC failures, WS timeouts | Read-only capability query |
| **Market Slot & Clock** | `ChainTruthEngine` | Monotonic slot & commitment state | Confirmed block events, RPC slot pings | Read-only point-in-time check |
| **Token Identity & Security** | `TokenProgramInspector` | Account state cache, immutable mint pubkey | On-chain account change events | Pure query; never keyed by ticker symbol |
| **Microstructure EV & Factors**| `SpieEngine` | Ephemeral evaluation vector | Evaluated per candidate tick | Input to Unified Decision Engine |
| **Opportunity Decision** | `UnifiedDecisionEngine` | Append-only decision journal | Reconciled across Vetoes, Risk, SPIE, and ML | Read-only immutable decision artifact |
| **Capital Availability & Cash** | `CapitalTruthEngine` | Double-entry append-only event ledger (WAL) | `reserveCapital`, `settleExecution`, `settleExit` | Immutable snapshot (`CapitalState`) |
| **Confirmed Positions** | `CapitalTruthEngine` | `Map<string, ConfirmedPosition>` | `settleExecution` (open), `settleExit` (close) | Read-only query (`getOpenPositionsCount`) |
| **Global Authority Mode** | `CapitalKernel` | `AuthorityMode` (A0 to A5 Lattice) | System-integrity failure trip, `RecoveryCertificate` | Read-only query (`getAuthorityMode`) |
| **Revocation Epoch & Scopes** | `RevocationEngine` | Monotonic integer `currentEpoch` + active map | `triggerRevocation`, `resolveRevocation`, `expire` | Pre-sign barrier check (`verifyRevocationBarrier`) |
| **Route Identity & Limits** | `ExecutionPlanning` / `Veritas` | Concrete route string (`EffectSpec.allowed_programs`) | Execution route selection | Bound to TransactionManifest & CommitCert |
| **Signing Authority & Custody** | `VaultSigner` | Hardware keypair / KMS, signed registry | Atomic signature after 15 pre-sign assertions | Pure signing response |
| **Transaction Delivery Status** | `JanusReconciler` | Submitted transaction state machine | RPC status polls, signature confirmations | Ambiguity reconciliation before retry |
| **Realized PnL & Fees** | `CapitalTruthEngine` | Double-entry balance sheet | `settleExit`, fee attribution | Double-entry conservation audit |
| **Outcome Truth & Attribution** | `OutcomeGroundTruthLedger` | Chained outcome record with feature hash | Settlement finalization event | Learning pipeline, Drift Engine |

---

## 2. PROHIBITED COMPETITIVE TRUTH PATTERNS

1. **No Multiple Position Counters:**
   `PortfolioEvacuationEngine` and `RiskEngine` do NOT maintain independent counts of confirmed positions. They query `CapitalTruthEngine.getOpenPositionsCount()` and receive position registrations strictly after on-chain settlement.
2. **No Speculative Capital Mutation:**
   Discovering, scoring, simulating, or recommending a token NEVER mutates capital, reservations, or cash balance. Only valid lifecycle transitions (`reserveCapital` -> `writeCommitCertificate` -> `settleExecution`) mutate balance truth.
3. **No Optimistic Health Defaults:**
   An unobserved or unreachable provider is classified as `UNKNOWN` or `DISCONNECTED`, never coerced to `HEALTHY` via fallback booleans (`?? true`).
4. **No Bypassing Unified Decision:**
   Upstream opportunity models (Multiplier-X, SPIE, NEXUS-MX) do not command execution directly. All signals must pass through `UnifiedDecisionEngine.reconcile()`, where security vetoes possess absolute priority.
