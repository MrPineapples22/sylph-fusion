# SOL-SYLPH — State Ownership & Authority Charter
*Generated as Mandatory Deliverable #5 pursuant to Section 2 of the Intelligence Fabric Master Specification.*

---

## 1. Single Authoritative Ownership Principle

No piece of state may exist in duplicate with conflicting sources of truth. Every domain of state in SOL-SYLPH has exactly ONE authoritative owner. Downstream consumers maintain read-only views or reference the authoritative owner.

---

## 2. Domain State Authority Matrix

| State Domain | Authoritative Owner | Location in Codebase | Mutability | Persistence Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **Solana Slot & Reorgs** | `ChainTruthEngine` | `src/intelligence/truth/chain-truth.ts` | Append-only / Rollback | Memory + Forensic event store |
| **System Clocks** | `ThreeClocks` | `src/intelligence/truth/three-clocks.ts` | Monotonic forward | Ephemeral per tick |
| **Historical Features** | `PointInTimeFeatureStore` | `src/intelligence/truth/feature-store.ts` | Strictly Immutable | SHA-256 snapshot archive |
| **Wallet & Actor Graph** | `ActorKnowledgeGraph` | `src/intelligence/adversarial/actor-graph.ts` | Append / Relationship edge update | Graph store |
| **Financial Ledger & Balances**| `EventLedger` & `DoubleEntryJournal` | `src/platform/ledger/` | Cryptographic append-only | SHA-256 hash-chained JSONL |
| **Segregated Vault Balances** | `VaultManager` | `src/platform/vault/vault-manager.ts` | Controlled state machine | Ledger reconciliation |
| **Active Live Positions** | `PositionManager` | `src/paper.ts` / `src/core.ts` | Mutated by fills/exits only | Periodic session checkpoint |
| **Position Risk & Defense** | `PositionDefenseState` | `src/intelligence/execution/position-defense.ts` | Real-time tick evaluation | In-memory + audit trace |
| **System Capital Authority** | `SafetyMonitor` | `src/intelligence/safety/safety-monitor.ts` | Fail-closed state latch | Memory + Incident flight recorder |
| **Order Execution Lifecycle** | `ExecutionStateMachine` | `src/intelligence/execution/execution-state-machine.ts` | Strict sequential transition | `fills.csv` + execution log |
| **Active Champion Strategy** | `StrategyGovernance` | `src/intelligence/governance/manifest.ts` | Immutable manifest versioning | Manifest archive |
| **Historical Failures** | `NegativeKnowledgeDB` | `src/intelligence/research/negative-db.ts` | Permanent append-only | Disk JSON database |
| **GUI Presentation** | Aether Flux View Model | `src/intelligence/master-orchestrator.ts` | Read-only presentation projection | Rendered to Tkinter cockpit |

---

## 3. Critical Invariant on Presentation Layer

The Aether Flux GUI cockpit (`terminal/`) is strictly a **presentation projection**. Under no circumstances may the GUI act as a source of state, originate capital authorizations, or override the `SafetyMonitor` or `IndependentRiskEngine`.
