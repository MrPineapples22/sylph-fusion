# SYLPH FUSION — REPOSITORY-WIDE CONNECTIVITY MATRIX
**Audit Date:** 2026-09-30  
**Status:** FULLY RECONCILED & CONNECTED  
**Certification Level:** C4 (Deterministic Architecture & Formal Governance Verified)

---

## 1. COMPREHENSIVE COMPONENT CONNECTIVITY CENSUS

| Component | Authoritative Owner? | Upstream Producer(s) | Downstream Consumer(s) | State Ownership | Freshness Policy | Failure Behavior | Connection Status | Tested? | Bypass Possible? |
|---|---|---|---|---|---|---|---|---|---|
| **Yellowstone/RPC Pool** | Yes (Raw Chain) | Solana Mainnet Validators | ChainTruthEngine, ProviderHealth | Ephemeral Socket / HTTP | Slot age < 400ms | Fail-closed to next peer | **CONNECTED** | Yes | No |
| **ProviderHealthTracker** | Yes (Health Truth) | RPC Pings, WS Heartbeats | SystemStrip, MarketHub | In-Memory Circular Buffer | < 500ms heartbeat | DEGRADED / STALE | **CONNECTED** | Yes | No |
| **ChainTruthEngine** | Yes (Slot Truth) | RPC/WS Events | PIT Feature Store, CapitalFlow | In-Memory Slot Tracker | Monotonic Slot | Halts pipeline if slot regresses | **CONNECTED** | Yes | No |
| **TokenInspector** | Yes (Token Security) | RPC Account Info | Unified Decision Engine | Read-Only Account Cache | Cache TTL 30s | Unknown -> VETO | **CONNECTED** | Yes | No |
| **PIT Feature Store** | Yes (Feature Truth) | Ingested Market Events | SPIE, Multi-Model Suite | Immutable Time-Series | Point-in-Time Slot | Rejects out-of-order ticks | **CONNECTED** | Yes | No |
| **WalletIntelligence** | Yes (Sybil / Insider) | Transfer Ledger, Graph | Unified Decision, Risk Engine | In-Memory Actor Registry | Updated on new transfer | Fallback to conservative risk | **CONNECTED** | Yes | No |
| **CapitalFlowGraph** | Yes (Micro-Flows) | Chain Events, Swaps | SPIE Engine, Multiplier-X | Directed Multi-Graph | Real-time sliding window | Confidence penalty | **CONNECTED** | Yes | No |
| **SpieEngine** | No (Evidence Only) | Market Microstructure | Unified Decision Engine | Ephemeral Evaluation | Per-Candidate Tick | Veto / Abstain on uncertainty | **CONNECTED** | Yes | No |
| **UnifiedDecisionEngine** | **YES (Decision Truth)** | SPIE, Vetoes, Risk, Models | Master Orchestrator, Capital Kernel | Append-Only Decision Map | Current tick snapshot | Strict VETO override | **CONNECTED** | Yes (Test 20) | **NO (Canonical)** |
| **CapitalTruthEngine** | **YES (Capital Truth)** | Kernel Authorizations, On-chain Settle | CapitalKernel, PortfolioEvac, Vault | Append-Only Double-Entry WAL | Real-time WAL state | Invariant violation abort | **CONNECTED** | Yes (Tests 13, 14, 19) | **NO (Strict WAL)** |
| **CapitalKernel** | **YES (Authority Truth)** | CapitalTruthEngine, Proof Leases | Execution Gate, VaultSigner | Authority Lattice (A0-A5) | Real-time validation | Capacity -> Local; Fault -> A2 | **CONNECTED** | Yes (Tests 1, 2, 8, 9, 12) | **NO** |
| **RevocationEngine** | **YES (Revocation Truth)**| Circuit Breakers, Operators | RevocationBarrier, VaultSigner | Monotonic Epoch + Active Map | Instantaneous | Epoch bump blocks in-flight | **CONNECTED** | Yes (Tests 4, 5, 6) | **NO** |
| **VeritasDecoder** | Yes (Intent Validation) | Serialized Tx, EffectSpec | VaultSigner | Stateless Pure Validator | Current execution slot | Mismatch -> REJECT | **CONNECTED** | Yes (Tests 7, 16) | **NO** |
| **VaultSigner** | **YES (Signer Custody)** | EffectSpec, CommitCert, Manifest | Submission Relayer | Keypair Isolation + Sign Registry| Slot lease validity | Rejection, Sign Quarantine | **CONNECTED** | Yes (Tests 16, 17, 18) | **NO (KMS Gate)** |
| **JanusReconciler** | **YES (Delivery Truth)** | RPC Polls, Jito Feedbacks | CapitalTruthEngine, HavenMode | Transaction State Journal | Blockhash validity window | Ambiguous -> Hold reservation | **CONNECTED** | Yes (Test 15) | **NO** |
| **PortfolioEvacEngine** | Yes (Solvency Truth) | Confirmed Positions (post-settle) | Risk Engine, Havens | In-Memory Active Position Map | Recomputed on position change | Stressed coverage warning | **CONNECTED** | Yes (Test 3) | **NO** |
| **OutcomeGroundTruth** | **YES (Outcome Truth)** | Settlement Events, PnL Delta | Drift Engine, Learning Pipeline | Cryptographic Outcome Journal | Finalized on-chain settlement | Right-censored tracking | **CONNECTED** | Yes (Test 19) | **NO** |

---

## 2. ORPHANED PRODUCER & STARVED CONSUMER RESOLUTION

### A. Repaired Disconnections:
1. **CapitalTruthEngine Exit Settlement:**
   - *Previous Defect:* `CapitalTruthEngine` lacked a close/reduction path, causing confirmed positions to increase monotonically and permanently lock open-position capacity at 5/5.
   - *Resolution:* Implemented `settleExit(...)` and `closePosition(...)`, relieving cost basis, recording `POSITION_CLOSED` in the WAL, and updating realized PnL/losses in the double-entry report.
2. **Dynamic Route Binding:**
   - *Previous Defect:* Hardcoded `'Orca_Whirlpool_Route'` was assigned indiscriminately to early pump.fun tokens.
   - *Resolution:* Dynamically planned route identity (`Pump_Bonding_Curve` vs `Raydium_Main_Pool`) flows from candidate topology directly into `EffectSpec`, `TransactionManifest`, and `VaultSigner`.
3. **Candidate Phantom Position Bug:**
   - *Previous Defect:* Candidate evaluation at tick discovery invoked `PortfolioEvacuationEngine.registerPosition(...)` with 0.5 SOL before any decision was authorized.
   - *Resolution:* Removed premature registration; portfolio positions are now registered strictly post-settlement.
4. **Sticky Global Authority Downgrade:**
   - *Previous Defect:* Normal position capacity rejection (`current_open_positions_count >= maxOpenPositions`) triggered a global downgrade to `A2_REDUCE_ONLY`, freezing the bot forever.
   - *Resolution:* Separated local action rejections (`INV_1`, `INV_6`) from system integrity violations (`INV_3`, `INV_4`, `INV_7`, `INV_9`, `INV_10`, `INV_11`). Global authority remains `A5_NORMAL` on local rejections.
5. **Revocation TOCTOU Race Condition:**
   - *Previous Defect:* Request revocation epoch was captured at the barrier check rather than request start.
   - *Resolution:* Monotonic request revocation epoch is captured at event start; any interim revocation advances `currentEpoch`, triggering an immediate barrier block (`STALE_EPOCH`).
6. **Scoped Revocation Support:**
   - *Previous Defect:* Revocation barrier only evaluated global and token-level entities.
   - *Resolution:* Added full support and typing for `GLOBAL`, `TOKEN`, `POSITION`, `ROUTE`, `WALLET`, `PROGRAM`, `STRATEGY`, and `SIGNER`.
