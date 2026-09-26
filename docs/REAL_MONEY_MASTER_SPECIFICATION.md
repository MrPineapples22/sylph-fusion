# SOL/SYLPH — Real-Money Autonomous Solana Trading Master Engineering Specification

**Document Class**: Production Architecture & Protocol Certification  
**Target Environment**: Solana Mainnet-Beta Autonomous Execution (Headless Daemon Operation)  
**Security Model**: Zero-Trust Isolation, On-Chain SYLPH Guard PDA Vault, Hardware Fenced Signing (AWS KMS Ed25519)  
**System Status**: Certified Architecture Blueprint & Active Verification Suite  

---

## Executive Summary & Architectural Law

The objective of **SOL/SYLPH** is to transform a profitable trading hypothesis into **exactly one intended, cryptographically authorized, economically bounded, correctly landed, canonical Solana state transition** while the operator's personal computer is turned off.

### The Fundamental Axiom: AI Is Not Authority
```
Market Evidence → Canonicalization → Feature Pipeline → SPIE / JEV / Laya / EINSTEIN
  ↓ (Advisory Ranking & EV Only)
Opportunity Certificate
  ↓ (Deterministic Evaluation)
Cluster Runtime Authority → Program Identity Authority → Token Semantic Authority → Venue Authority
  ↓
Risk Authority → Capital Sentinel → Strategy Budget Envelope
  ↓
Trade Certificate → Route Engine → Contention Model → Fee Authority → Simulation Certificate
  ↓
Solana Runtime Firewall → Execution Permit → Execution Generation
  ↓
Signing Firewall → Signer Fencing → AWS KMS Ed25519
  ↓
Persist Exact Signed Transaction (WAL Fsync) → Landing Authority
  ↓
Solana Cluster (Quorum Confirmation & Finalization)
  ↓
CPI Closure Audit → Raw Account Reconciliation → Settlement Certificate → PnL Truth
```

Machine Learning, heuristic classifiers, LLMs, and quant alpha models are strictly **advisory**. They discover opportunities, estimate alpha half-life, and predict regime shifts. Under no circumstances may an AI or ML system:
- Access private signing keys or KMS APIs.
- Modify capital allocations, position ceilings, or reserve floors.
- Alter fee, slippage, or Jito tip thresholds.
- Bypass hard risk gates or on-chain PDA constraints.
- Clear its own execution permits.

---

## 1. Current-State Reconstruction

An exhaustive forensic reconstruction of the existing dual-stack codebase (`d:\pump\SOL-SYLPH` Python Engine and `sylph-fusion` TypeScript Platform):

| Subsystem Component | Repository / Path | Operational Classification | Forensic Finding & Reality |
| :--- | :--- | :--- | :--- |
| **Monolithic Trading Engine (`SOS.py`)** | Python (`d:\pump\SOL-SYLPH`) | **Partially Implemented / Unsafe for Unattended Real Money** | High-frequency Pump.fun bonding curve runner, order-flow engine, and ML scoring. Performs raw RPC/WS interactions. Highly minified; lacks hardware signing isolation and PDA vault confinement. |
| **Dynamic Trailing & Sizing (`advanced_position_manager.py`)** | Python (`d:\pump\SOL-SYLPH`) | **Implemented** | Enforces Dynamic Staged Trailing Stops (<100% gain $\to$ 20% trail; 100-500% gain $\to$ 30% trail; >500% gain $\to$ 40% trail), anti-phantom price spike clamps, and 50/50 scale-outs. |
| **50 God-Tier Exit Controls (`exit_engine.py`)** | Python (`d:\pump\SOL-SYLPH`) | **Implemented** | Robust 50-control exit referee with D0–D5 defense levels, MFE/MAE provenance, and liquidity shock bailouts. |
| **Startup Reconciliation (`startup_reconciliation.py`)** | Python (`d:\pump\SOL-SYLPH`) | **Implemented** | Enforces 6 core invariants on boot from `trades.db`. Blocks all new entries if discrepancies exist while permitting emergency exits. |
| **Trade Lifecycle Ledger (`trade_lifecycle_manager.py`)** | Python (`d:\pump\SOL-SYLPH`) | **Implemented** | SQLite WAL journal with UUID4 trade IDs, append-only immutable events, and secondary CSV mirroring. |
| **Signing Firewall (`signing-firewall.ts`)** | TypeScript (`sylph-fusion`) | **Implemented** | Zero-trust firewall verifying frozen decoded transaction views, replay sets, program IDLs, and slippage/fee ceilings before signing. |
| **Isolated AWS KMS Ed25519 Signer (`aws-kms-ed25519.ts`)** | TypeScript (`sylph-fusion`) | **Implemented** | Hardware-isolated Ed25519 signer via AWS KMS. Checks key ARN, key spec (`ECC_NIST_EDWARDS25519`), and pre-verifies signatures. |
| **Durable Live Signer (`durable-live-signer.ts`)** | TypeScript (`sylph-fusion`) | **Implemented** | WAL journal fsync boundary preceding signer dispatch. Enforces grant validity, control epochs, and post-signing durability. |
| **Settlement Firewall (`settlement-firewall.ts`)** | TypeScript (`sylph-fusion`) | **Implemented** | Enforces immutable user payout destinations, idempotency keys, and reconciliation-clean prerequisites. |
| **Multi-User PDA Vault Manager (`vault-manager.ts`)** | TypeScript (`sylph-fusion`) | **Partially Implemented** | Segregates operational reserves, platform fees, and trading capital. Currently manages off-chain ledgers; requires on-chain Anchor Guard binding. |
| **Solaris Bimodal Router (`bimodal-router.ts`)** | TypeScript (`sylph-fusion`) | **Implemented** | Routes dynamically between Jito MEV bundles, Direct TPU QUIC, and congestion abstention based on leader schedules. |
| **Token-2022 Semantics Authority (`token-semantics.ts`)** | TypeScript (`sylph-fusion`) | **Implemented** | Detects transfer fees, transfer hooks, permanent delegates, non-transferability, and freeze/mint authorities. |
| **Release Certification Authority (`release-certification.ts`)** | TypeScript (`sylph-fusion`) | **Implemented** | 13-gate release certification engine. Enforces fail-closed rule: absence of evidence is not favorable evidence. |
| **On-Chain SYLPH Guard Program** | Solana Program (Rust/Anchor) | **Designed Only / Specification Formulated** | Target L2 custody architecture. Requires Anchor implementation of CAP-001 through CAP-015 with domain seeds. |
| **Account Capability Closure Hash** | Platform Execution | **Implemented in `real_money_contracts.py`** | Hashes normalized, sorted writable, readonly, executable, vault, and ALT accounts to bind the exact Solana transaction capability envelope. |

---

## 2. Gap Analysis Against Master Blueprint

```
Master Blueprint Requirement              Current State                     Gap Classification & Remediation Plan
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
1. Exactly-Once Execution Generation      trades.db SQLite + UUID4          PARTIAL GAP: Bound generation indices to 
                                                                            atomic message_hash; reject ambiguous transitions.
2. Persist-Before-Broadcast Invariant    durable-live-signer.ts fsync      COMPLETED in platform; wire directly into 
                                                                            Python SOS.py live dispatch loop.
3. Multi-Provider Quorum Reconciliation   RPCProviderPool & QuorumRoot       COMPLETED in TypeScript platform; must become 
                                                                            mandatory barrier before Python trade finalization.
4. Token-2022 Transfer Hook Closure      token-semantics.ts                PARTIAL GAP: Requires dynamic on-chain resolution 
                                                                            of ExtraAccountMetaList prior to envelope sealing.
5. Causal Slot Barrier & Monotonicity     StreamIntegrityAuthority          COMPLETED: minContextSlot enforced on RPC queries; 
                                                                            quarantine providers exhibiting slot regression.
6. Leader-Aware Landing Engine            SOLARIS leader-schedule.ts        COMPLETED: 432k slot indexing with Jito/vanilla split; 
                                                                            needs direct SWQoS telemetry integration.
7. Hot Account Saturation Model          DynamicTipAndContentionOracle     COMPLETED: Pool write-lock contention modeling.
8. On-Chain PDA Vault + SYLPH Guard       vault-manager.ts (off-chain)      CRITICAL ARCHITECTURAL GAP: Deploy on-chain Anchor 
                                                                            Guard enforcing CAP-001..CAP-015 invariants.
9. Raw Integer Token Accounting           Floats in SOS.py legacy loops     REMEDIATED: Implemented to_raw_units/from_raw_units; 
                                                                            ban floats in authoritative balance mutations.
10. Dynamic Economic vs Protocol Expiry   MAX_QUOTE_AGE_SEC & BlockHeight   COMPLETED: Stop broadcast on economic expiry even 
                                                                            if lastValidBlockHeight has not elapsed.
```

---

## 3. Target Architecture & Authority Flow Graph

The complete production system consists of three distinct privilege tiers:

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                LEVEL 1 — COLD TREASURY                                │
│   Hardware multisig / Cold storage. Zero network exposure. SYLPH has NO ACCESS.       │
└──────────────────────────────────────────┬────────────────────────────────────────────┘
                                           │ Controlled One-Way Provisioning
┌──────────────────────────────────────────▼────────────────────────────────────────────┐
│                             LEVEL 2 — FUNDING & CONTROL                               │
│   Operator sets immutable CapitalMandate, authorized executor, and emergency freeze.   │
└──────────────────────────────────────────┬────────────────────────────────────────────┘
                                           │ Delegated Risk Budget
┌──────────────────────────────────────────▼────────────────────────────────────────────┐
│                         LEVEL 3 — ACTIVE TRADING CAPITAL                              │
│                                                                                       │
│  ┌───────────────────────┐   Opportunity    ┌──────────────────────────────────────┐  │
│  │ Intelligence Stack    │  ──────────────> │ Execution Authority                  │  │
│  │ SPIE / JEV / Models   │   Certificate    │ TokenSemantics / Venue / Exitability │  │
│  └───────────────────────┘                  └──────────────────┬───────────────────┘  │
│                                                                │ TradeCertificate     │
│  ┌───────────────────────┐   Execution      ┌──────────────────▼───────────────────┐  │
│  │ Signing Firewall      │ <──────────────  │ Risk Authority & Capital Sentinel    │  │
│  │ Envelope & Closure    │     Permit       │ Sizing / Budget Envelope / Reserves  │  │
│  └───────────┬───────────┘                  └──────────────────────────────────────┘  │
│              │ Sealed Message Hash                                                    │
│  ┌───────────▼───────────┐   Signed Tx      ┌──────────────────────────────────────┐  │
│  │ AWS KMS Ed25519       │  ──────────────> │ Persist-Before-Broadcast Journal     │  │
│  │ Hardware Signer       │                  │ WAL Commit (Disk Fsync)              │  │
│  └───────────────────────┘                  └──────────────────┬───────────────────┘  │
│                                                                │ Durable Transaction  │
│  ┌───────────────────────┐                  ┌──────────────────▼───────────────────┐  │
│  │ On-Chain SYLPH Guard  │ <─────────────── │ Landing Authority                    │  │
│  │ PDA Vault Program     │   Multi-Path     │ TPU QUIC / Jito / SWQoS Router       │  │
│  └───────────┬───────────┘                  └──────────────────────────────────────┘  │
│              │ Finalized Landed State                                                 │
│  ┌───────────▼─────────────────────────────────────────────────────────────────────┐  │
│  │ Settlement Quorum → CPI Closure Audit → Raw Reconciliation → PnL Truth          │  │
│  └─────────────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Source Tree & File Plan

```
d:/pump/SOL-SYLPH/
├── .agents/
│   ├── AGENTS.md                           # Autonomous bot rules & ML patterns
│   └── skills/sol-sylph-ml-patterns/       # Core ML engineering patterns
├── config.py                               # Canonical immutable trading configuration
├── startup_reconciliation.py               # Boot recovery & 6 core event invariants
├── trade_lifecycle_manager.py              # SQLite WAL trade journal & event sourcing
├── exit_engine.py                          # 50 God-Tier exit controls & D0-D5 defense
├── advanced_position_manager.py            # Dynamic staged trailing stops & clamps
├── lib/
│   ├── real_money_contracts.py             # Typed dataclass contracts & raw integer math
│   ├── sylph_guard_invariants.py           # On-chain PDA Guard & CAP-001..CAP-015 validation
│   ├── canonical_identity.py               # Deterministic mint & ticker mapping
│   ├── position_state_machine.py           # Formal finite state machine for positions
│   └── yellowstone_geyser.py               # High-speed gRPC stream ingestion
├── tests/
│   ├── test_real_money_contracts.py        # Contract hashing, integer math & CAP test suite
│   ├── test_god_tier_50_exits.py           # 50 exit controls verification
│   └── test_production_readiness.py        # End-to-end production readiness suite
└── sylph-fusion/ (Platform Core)
    ├── src/platform/
    │   ├── signing/
    │   │   ├── signing-firewall.ts         # Zero-trust message decoding & gate enforcement
    │   │   ├── durable-live-signer.ts      # Durable WAL commit before KMS dispatch
    │   │   ├── aws-kms-ed25519.ts          # AWS KMS Ed25519 hardware signing client
    │   │   └── settlement-firewall.ts      # Payout idempotency & destination verification
    │   ├── vault/
    │   │   ├── vault-manager.ts            # Multi-user segregated vault balance manager
    │   │   └── types.ts                    # Segregated balance & lifecycle types
    │   ├── execution/
    │   │   ├── helios/                     # Direct TPU QUIC execution engine
    │   │   └── solaris/                    # Bimodal router, leader schedule, tip oracle
    │   ├── security/
    │   │   ├── token-semantics.ts          # Token-2022 hook & fee classification
    │   │   └── hard-veto-kernel.ts         # Deterministic pass/fail veto pipeline
    │   └── certification/
    │       └── release-certification.ts    # 13 mandatory release gates
    └── terminal/
        └── server.mjs                      # Live operator dashboard on port 8793
```

---

## 5. Formal State Machines

### 5.1 Monotonic Execution State Machine
```
           ┌───────────┐
           │  UNKNOWN  │
           └─────┬─────┘
                 │ Submit to Network (Landed Observation)
                 ▼
           ┌───────────┐
           │ PROCESSED │
           └─────┬─────┘
                 │ Cluster Confirmation (Quorum ≥ 2 Independent Providers)
                 ▼
           ┌───────────┐
           │ CONFIRMED │
           └─────┬─────┘
                 │ Max Commit / Root Slot (Root Finalization Reached)
                 ▼
      ┌──────────────────────┐
      │  FINALIZED_SUCCESS   │ ◄── TERMINAL (Landed, Quorum Clean, Reconciled)
      └──────────────────────┘

Alternative Terminal Branches:
  - Any State ──(Program Error / Simulation Revert)──► FINALIZED_FAILED
  - UNKNOWN   ──(BlockHeight > LastValidBlockHeight + Quorum Agrees Transaction Absent)──► VERIFIED_EXPIRED_NOT_SEEN
```
*Monotonicity Rule*: Execution state can NEVER regress. A provider returning `UNKNOWN` after another provider returned `CONFIRMED` represents provider divergence, not transaction status rollback.

### 5.2 Position Lifecycle State Machine
```
┌───────────┐     Alpha & Gates Passed     ┌──────────────┐     Transaction Confirmed     ┌──────┐
│ CANDIDATE │ ───────────────────────────> │ PENDING_BUY  │ ────────────────────────────> │ OPEN │
└───────────┘                              └──────┬───────┘                               └───┬──┘
                                                  │ Expiry / Blocked                          │
                                                  ▼                                           │ Gain ≥ 20%
                                            ┌───────────┐                                     │ (50/50 Rule)
                                            │ REJECTED  │                                     ▼
                                            └───────────┘                             ┌──────────────┐
                                                                                      │ PARTIAL_EXIT │
                                                                                      └───────┬──────┘
                                                                                              │ Stop / Trail /
                                                                                              │ Target Triggered
                                                                                              ▼
                                           ┌───────────┐     Full Fill Confirmed      ┌──────────────┐
                                           │  CLOSED   │ <─────────────────────────── │ EXIT_PENDING │
                                           └─────┬─────┘                              └──────────────┘
                                                 │ Double-Entry Audit
                                                 ▼
                                           ┌────────────┐
                                           │ RECONCILED │ ◄── TERMINAL
                                           └────────────┘
```

### 5.3 Venue Transition State Machine (Pump Graduation)
```
┌──────────────┐    Bonding Curve 100% Filled    ┌───────────────────────┐
│ CURVE_ACTIVE │ ──────────────────────────────> │ GRADUATION_TRIGGERED  │
└──────────────┘                                 └───────────┬───────────┘
                                                             │ SOL Migration Initiated
                                                             ▼
┌──────────────┐    Highest Liquidity Discovered ┌───────────────────────┐
│  AMM_ACTIVE  │ <────────────────────────────── │  PUMPSWAP_DISCOVERY   │
└──────────────┘    (PumpSwap / Raydium Pair)    └───────────────────────┘
```
*Graduation Rule*: A completed curve is NOT a dead token. New exposure is paused during `GRADUATION_TRIGGERED` and resumes once `AMM_ACTIVE` pair liquidity is verified on PumpSwap or Raydium.

### 5.4 Incident & Loss Containment Ladder
```
NORMAL (All systems nominal, full autonomous execution permitted)
  │
  ├── RPC timeout / latency spike (Single provider failure)
  ▼
CAUTION (Re-route through secondary RPC, log diagnostic alert)
  │
  ├── Provider disagreement / slot divergence > 3 slots
  ▼
RESTRICTED (Halve new position sizing, require 3-node confirmation)
  │
  ├── Reconciliation discrepancy / token quantity mismatch
  ▼
NO_INCREASE (Prohibit all new BUYs; manage open positions only)
  │
  ├── Unexplained asset delta / off-chain drift / feed blackout > 30s
  ▼
CLOSE_ONLY (Orderly wind-down; liquidate positions via emergency routes)
  │
  ├── Unauthorized KMS signing attempt / signature verification failure
  ▼
SIGNING_HALTED (Revoke all active live signing grants, isolate KMS)
  │
  ├── On-chain SYLPH Guard CAP invariant violation / critical breach
  ▼
VAULT_FROZEN (Trigger on-chain emergency pause; manual intervention required)
```

---

## 6. Typed Data Contracts

All data contracts enforce immutable fields, explicit types, and deterministic SHA-256 digests.

### 6.1 AccountCapabilityEnvelope & CapabilityClosureHash
```python
@dataclass(slots=True, frozen=True)
class AccountCapabilityEnvelope:
    fee_payer: str
    signers: Tuple[str, ...]
    writable_accounts: Tuple[str, ...]
    readonly_accounts: Tuple[str, ...]
    executable_accounts: Tuple[str, ...]
    vault_accounts: Tuple[str, ...]
    token_accounts: Tuple[str, ...]
    route_accounts: Tuple[str, ...]
    transfer_hook_accounts: Tuple[str, ...]
    alt_resolved_accounts: Tuple[str, ...]

    def compute_capability_closure_hash(self) -> str:
        normalized = {
            "fee_payer": self.fee_payer,
            "signers": sorted(list(self.signers)),
            "writable_accounts": sorted(list(self.writable_accounts)),
            "readonly_accounts": sorted(list(self.readonly_accounts)),
            "executable_accounts": sorted(list(self.executable_accounts)),
            "vault_accounts": sorted(list(self.vault_accounts)),
            "token_accounts": sorted(list(self.token_accounts)),
            "route_accounts": sorted(list(self.route_accounts)),
            "transfer_hook_accounts": sorted(list(self.transfer_hook_accounts)),
            "alt_resolved_accounts": sorted(list(self.alt_resolved_accounts)),
        }
        return compute_sha256_digest(normalized)
```

### 6.2 ExecutionPermit & ExecutionGeneration
```python
@dataclass(slots=True, frozen=True)
class ExecutionPermit:
    permit_id: str
    trade_id: str
    execution_generation: int
    message_hash: str
    capability_closure_hash: str
    semantic_closure_hash: str
    simulation_id: str
    authorized_signer: str
    fee_payer: str
    control_epoch: int
    protocol_deadline_block_height: int
    economic_deadline_ms: int
    issued_at_ms: int
    permit_signature: str

@dataclass(slots=True, frozen=True)
class ExecutionGeneration:
    trade_id: str
    generation_index: int
    message_hash: str
    serialized_message_b64: str
    blockhash: str
    last_valid_block_height: int
    economic_deadline_ms: int
    capability_closure_hash: str
    semantic_closure_hash: str
    runtime_hash: str
    permit_hash: str
    state: ExecutionTerminalStatus
    persisted_at_ms: int
    signature: Optional[str] = None
    terminal_at_ms: Optional[int] = None
```

---

## 7. Named Invariant Catalog

### 7.1 Capital & On-Chain Guard Invariants (CAP-xxx)
- **CAP-001**: *No Unauthorized Withdrawal Destination*. Every transfer out of the vault must strictly target the immutable operator treasury or an authorized vault-owned token account.
- **CAP-002**: *Maximum Input Constraint*. No execution may debit lamports or tokens exceeding the mandate's single-position ceiling.
- **CAP-003**: *Exactly-Once Generational Consumption*. An execution generation $(trade\_id, generation\_index)$ may be executed at most once. Replays must revert on-chain.
- **CAP-004**: *Dual-Deadline Expiry*. Any execution attempted after `current_time >= economic_deadline_ms` OR `block_height > protocol_deadline_block_height` must be rejected.
- **CAP-005**: *Active Executor Authentication*. Only the current fenced executor public key recorded in the mandate PDA may invoke trading instructions.
- **CAP-006**: *Mandate Immutability by Executor*. The automated executor possesses zero authority to modify the mandate PDA parameters or risk ceilings.
- **CAP-007**: *Separation of Executor and Administrator*. The administrator public key cannot equal the active automated executor key.
- **CAP-008**: *CPI Whitelist Enforcement*. On-chain CPI calls are strictly restricted to certified DEX and AMM programs recorded in the mandate.
- **CAP-009**: *Trade Output Confinement*. All purchased token balances must remain in vault-derived PDAs; they cannot be routed to external hot addresses.
- **CAP-010**: *Emergency Halt Interlock*. When `emergency_state == True`, all instructions creating new token exposure revert immediately.
- **CAP-011**: *Control Epoch Monotonicity*. Transactions referencing stale control epochs are invalid.
- **CAP-012**: *No Arbitrary Top-Level Sibling CPI*. Transaction envelopes cannot contain arbitrary external program instructions alongside Guard calls.
- **CAP-013**: *Canonical Bump Enforcement*. PDAs must use canonical bumps derived from off-curve validation. Alternate bumps are rejected.
- **CAP-014**: *Cryptographic Permit Binding*. Guard execution requires a valid Ed25519 signature over the `ExecutionPermit` hash.
- **CAP-015**: *Capability Closure Containment*. The hash of all accounts supplied in the transaction must equal `permit.capability_closure_hash`.

### 7.2 Execution Invariants (EXEC-xxx)
- **EXEC-001**: *Single Active Generation*. For any TradeIntent, at most one unresolved execution generation can exist at any instant.
- **EXEC-002**: *Message Immutability Post-Certification*. After simulation and permit generation, the serialized message bytes and message hash cannot be mutated.
- **EXEC-003**: *Predecessor Terminality*. A successor generation cannot be constructed until the predecessor is provably in a terminal state (`FINALIZED_SUCCESS`, `FINALIZED_FAILED`, `VERIFIED_EXPIRED_NOT_SEEN`).
- **EXEC-004**: *Distinct Message Uniqueness*. Distinct execution intents must compile to distinct serialized messages via cryptographic execution nonces.
- **EXEC-005**: *Persist-Before-Broadcast*. No transaction payload may be transmitted over network sockets prior to synchronous WAL fsync commit.
- **EXEC-006**: *Ambiguity Rebroadcast Fence*. If network acknowledgement times out, the engine may rebroadcast only the identical signed transaction bytes; creating a new transaction is forbidden until expiry is certified.
- **EXEC-007**: *Recent Blockhash Exclusivity*. Trading transactions must strictly use recent confirmed blockhashes. Durable nonces are prohibited for autonomous market execution.
- **EXEC-008**: *Economic Deadline Superiority*. Broadcasters must cease transmission as soon as the economic opportunity expires, even if the blockhash remains protocol-valid.
- **EXEC-009**: *Local Account Lock Saturation Check*. High-contention pool accounts must be evaluated against local write-lock saturation before dispatch.
- **EXEC-010**: *Single Execution Envelope Introspection*. Exactly one execution-capable Guard invocation is permitted per transaction envelope.

### 7.3 Signing Invariants (SIGN-xxx)
- **SIGN-001**: *Zero Direct KMS Access by Intelligence*. Machine learning, scoring models, and strategy engines are physically barred from KMS APIs.
- **SIGN-002**: *Signing Firewall Mandatory Mediation*. All signing requests must pass through `SigningFirewall` with complete decoded transaction views.
- **SIGN-003**: *Raw Message Signing Only*. Solana messages must be signed using RAW Ed25519; pre-hashed Ed25519ph is prohibited.
- **SIGN-004**: *KMS Output Signature Self-Verification*. Every signature returned by KMS must be cryptographically verified against the local public key before use.
- **SIGN-005**: *Signer Velocity Rate Limits*. Total signatures per minute, BUY signatures per minute, and hourly notional volume must satisfy hard systemic caps.
- **SIGN-006**: *Fencing Token Lease Invariance*. Only the active leaseholder node within the current control epoch may request signatures.
- **SIGN-007**: *Replay Detection Set*. Re-requesting a signature for an already-consumed request ID or message hash returns an immediate rejection.
- **SIGN-008**: *Fee Payer Solvency Pre-Check*. Signatures are denied if the dedicated fee payer balance falls below the minimum reserve floor.
- **SIGN-009**: *Mainnet Interlock Guard*. Signing for `mainnet-beta` fails closed unless the explicit hardware production interlock is enabled.
- **SIGN-010**: *Unmatched Signing Event Alarm*. Any KMS sign operation lacking a matching `PreparedSigningIntent` journal record triggers an immediate system halt.

### 7.4 Data & Causal Invariants (DATA-xxx)
- **DATA-001**: *Causal Slot Barrier*. Market events, quotes, simulations, and executions must enforce `minContextSlot`. Stale RPC responses are rejected.
- **DATA-002**: *Provider Monotonicity Guarantee*. A provider returning a slot or block height lower than its prior response is quarantined immediately.
- **DATA-003**: *Fork Invalidation Tracking*. Decisions depending on unconfirmed/processed slots must track evidence blockhashes and invalidate if a fork occurs.
- **DATA-004**: *Raw Integer Token Accounting*. All balances, deltas, and transfers must be represented as integer base units ($10^{\text{decimals}}$).
- **DATA-005**: *Separation of Rent from Trading PnL*. Reclaimed rent from closed token accounts must never be accounted as trading alpha.
- **DATA-006**: *Lock-Safe Telemetry Snapshotting*. CSV and database reads must use atomic copies (`.tmp.csv`) to prevent OS-level file handle locks.
- **DATA-007**: *Temporal Feature Firewall*. Feature pipelines must enforce point-in-time constraints; zero future data leakage is permitted.
- **DATA-008**: *Reconciliation Monotonicity*. Confirmed on-chain balance snapshots override and fence internal speculative projections.
- **DATA-009**: *Deterministic Token Mint Dominance*. Token identity must be keyed by base58 mint address, never mutable human tickers or symbols.
- **DATA-010**: *Multi-Provider Quorum Agreement*. Confirmation requires agreement between at least two independent RPC infrastructure providers.

### 7.5 Settlement & Reconciliation Invariants (SETTLE-xxx)
- **SETTLE-001**: *Double-Entry Conservation*. Total assets (Vault Capital + Platform Fees + In-Flight Holdings) must equal Total Liabilities (Deposits + Realized PnL).
- **SETTLE-002**: *Post-Execution CPI Closure Audit*. Inner CPI instructions must be parsed and audited against the certified route class post-landing.
- **SETTLE-003**: *Idempotent Settlement Records*. Payouts and withdrawals must be keyed to unique settlement IDs; duplicate payouts are impossible.
- **SETTLE-004**: *Unclean Reconciliation Freeze*. If on-chain balance deltas fail to match execution outcomes, new entries are locked immediately.
- **SETTLE-005**: *Mark-to-Market Liquidation Sanity*. Stagnant positions must be marked against executable bid depth, not optimistic mid-market quotes.
- **SETTLE-006**: *Zero Slippage Deviation on Settlement*. Realized slippage exceeding the authorized maximum triggers a post-trade semantic incident.
- **SETTLE-007**: *Fee Burn Exhaustion Ceiling*. When hourly fees exceed the infrastructure loss budget, system degrades to `CLOSE_ONLY`.
- **SETTLE-008**: *On-Chain Delta Attribution*. Every lamport and token change must be attributed to an exact transaction signature.
- **SETTLE-009**: *Non-Destructive Account Closure*. Accounts with non-zero balances, pending executions, or active delegations cannot be closed.
- **SETTLE-010**: *PnL Truth Equation Enforcement*. On-chain equity must equal Opening Equity + Deposits - Withdrawals + Realized PnL - All Fees.

### 7.6 Token Semantic Invariants (TOKEN-xxx)
- **TOKEN-001**: *Token-2022 Hard Vetoes*. Tokens possessing permanent delegate, default frozen state, or non-transferable extensions are vetoed.
- **TOKEN-002**: *Transfer Fee Accounting Invariance*. For tokens with transfer fees, slippage and minimum output must calculate gross vs net tokens explicitly.
- **TOKEN-003**: *Transfer Hook Capability Closure*. Transfer hook programs and their derived accounts must be fully resolved in the capability envelope.
- **TOKEN-004**: *Mint Authority Revocation Baseline*. Tokens with active, unrevoked mint authority are blocked from autonomous entry.
- **TOKEN-005**: *Freeze Authority Revocation Baseline*. Tokens with active, unrevoked freeze authority are blocked from autonomous entry.
- **TOKEN-006**: *Semantic Mutation Horizon*. If scheduled transfer fee or authority changes will activate before the expected exit horizon, entry is vetoed.
- **TOKEN-007**: *Anti-Sniper Unique Buyer Floor*. Tokens younger than 10 seconds or with fewer than 3 unique buyers are blocked from entry.
- **TOKEN-008**: *Pair Asset Legitimacy*. Pair asset mints must be verified (Native SOL / WSOL / USDC); unknown pair assets are vetoed.
- **TOKEN-009**: *Continuous Exitability Verification*. Positions lacking an active, liquid sell route in the exitability monitor trigger an exit alarm.
- **TOKEN-010**: *Post-Graduation AMM Discovery*. Migrated bonding curves must complete AMM liquidity verification before trading resumes.

### 7.7 Program Trust Invariants (PROGRAM-xxx)
- **PROGRAM-001**: *Program Identity Fingerprint*. Executable program hash and upgrade authority must be verified against certified baselines.
- **PROGRAM-002**: *Program Upgrade Shock Response*. If a trading program executable hash changes on-chain, all new entries are blocked immediately.
- **PROGRAM-003**: *Address Lookup Table (ALT) Deactivation Fence*. ALTs scheduled for deactivation or modified after certification invalidate the permit.
- **PROGRAM-004**: *Instruction Introspection Firewall*. Sibling top-level instructions are inspected; unauthorized transfers revert the transaction.
- **PROGRAM-005**: *Transaction Format Certification*. Transactions must use certified formats (Legacy / V0 / V1) with explicit resource limit configuration.
- **PROGRAM-006**: *Compute Unit Optimization Bound*. Requested compute units must reflect calibrated family profiles; over-requesting 1.4M CU is prohibited.
- **PROGRAM-007**: *Jupiter Adapter Boundary Isolation*. Aggregator route plans must normalize into canonical SYLPH route representations.
- **PROGRAM-008**: *Jito Tip Account Rotation*. Jito tip transfers must query current tip accounts; hardcoding a single static tip account is forbidden.
- **PROGRAM-009**: *TPU Direct Endpoint Verification*. Direct leader TPU QUIC transmission must authenticate against verified cluster leader schedules.
- **PROGRAM-010**: *Differential Runtime Conformance*. Program instructions must be verified against Solana runtime fixtures before live promotion.

---

## 8. Subsystem Failure Matrix & Degradation Ladder

| Subsystem Failure Scenario | Primary Detection Mechanism | Immediate System State Transition | Impact on New BUYs | Impact on Active Position Exits | Recovery / Resumption Condition |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Primary RPC Endpoint Drops** | Circuit Breaker / Ping Probe | **CAUTION** | Conditional (Failover to secondary) | Fully Available (Multi-path) | Primary RPC returns healthy for 3 consecutive sweeps. |
| **RPC Provider State Regression** | Provider Monotonicity Guard | **RESTRICTED** | Blocked on Regressed Provider | Available via Monotonic Quorum | Quarantined provider resyncs to cluster slot height. |
| **Slot Divergence Between Providers (>3 Slots)** | RPC Quorum Engine | **RESTRICTED** | Blocked | Available (Requires 2-node agreement) | Cross-provider agreement falls within 1 slot. |
| **WebSocket Feed Silent > 5s** | Temporal Liveness Watchdog | **NO_INCREASE** | **BLOCKED** | Available via REST Polling | Active trade stream events resume at valid slot rate. |
| **ML Inference Engine NaN / Error** | Model Output Sanitizer | **NO_INCREASE** | **BLOCKED** | Fully Available (Heuristic Exits) | Model reload succeeds and outputs valid calibrated probabilities. |
| **Fee Payer Reserve Below Floor** | FeePayerBudget Sentinel | **NO_INCREASE** | **BLOCKED** | Available (Emergency Reserve) | Fee payer wallet balance replenished above safety threshold. |
| **Hourly Fee Burn Exceeds Budget** | Fee Burn Sentinel | **CLOSE_ONLY** | **BLOCKED** | Available | Hourly burn window resets or operator raises budget. |
| **Unreconciled Token Delta Discrepancy** | Continuous Reconciler | **NO_INCREASE** | **BLOCKED** | Available | On-chain balance agrees with reconstructed event ledger. |
| **Program Upgrade Shock Detected** | Program Identity Authority | **NO_INCREASE** | **BLOCKED** | Available via Fallback Routes | Program upgrade certified via shadow execution & diff. |
| **AWS KMS Access Denied / IAM Error** | Isolated Signer Client | **SIGNING_HALTED** | **BLOCKED** | **BLOCKED** (Signer down) | AWS KMS connectivity & IAM permissions restored. |
| **On-Chain Guard CAP Invariant Violation** | CPI Closure / Transaction Error | **VAULT_FROZEN** | **BLOCKED** | **BLOCKED** | Operator manual investigation & on-chain administrative reset. |

---

## 9. Comprehensive Adversarial Test Plan

The system must be subjected to adversarial and chaos testing across 8 distinct verification lanes:

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                ADVERSARIAL TEST LANES                                 │
├───────────────────────┬───────────────────────┬───────────────────────────────────────┤
│ Lane 1: Concurrency   │ Lane 2: Adversarial   │ Lane 3: Fault & Chaos                 │
│ & Replay Attacks      │ Token Semantics       │ Injection                             │
│ - Duplicate permit    │ - Token-2022 hooks    │ - RPC slot regression                 │
│ - Simultaneous bursts │ - Permanent delegate  │ - Ambiguous timeout                   │
│ - Re-entrant calls    │ - Default frozen      │ - WebSocket dropouts                  │
├───────────────────────┼───────────────────────┼───────────────────────────────────────┤
│ Lane 4: Envelope      │ Lane 5: Signer        │ Lane 6: Differential                  │
│ Capability Violation  │ Fencing & Isolation   │ Runtime Verification                  │
│ - Account substitute  │ - Split-brain leases  │ - LiteSVM execution                   │
│ - Unauthorized CPI    │ - Tampered message    │ - V0 vs V1 transaction                │
│ - Sibling transfers   │ - Expired grant       │ - ALT deactivation                    │
├───────────────────────┴───────────────────────┴───────────────────────────────────────┤
│ Lane 7: Mainnet Shadow Twin (Passive Non-Signing Mirror)                              │
│ Lane 8: Micro-Live Canary (<$10 Position Envelope, Real Solana Landing)              │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Key Test Scenarios:
1. **Adversarial Duplicate Execution (`EXEC-001`, `CAP-003`)**: Dispatch two simultaneous threads with identical `TradeIntent`. Verify thread A secures permit and thread B is rejected with `REPLAY_DETECTED`.
2. **Ambiguous Delivery Network Cutoff (`EXEC-006`)**: Submit transaction to local cluster, drop the HTTP response, and simulate client timeout. Verify engine rebroadcasts the exact same signed bytes and never issues a new transaction.
3. **Malicious Sibling Instruction (`CAP-012`, `PROGRAM-004`)**: Construct a transaction envelope containing the valid SYLPH Guard instruction and an unauthorized System Program transfer. Verify instruction introspection rejects the envelope before signing.
4. **Token-2022 Transfer Fee Evasion (`TOKEN-002`)**: Simulate a token with a 500 bps transfer fee. Verify gross vs net accounting enforces adequate output to avoid false stop-outs.
5. **KMS Split-Brain Signer Contention (`SIGN-006`)**: Spin up two daemon processes in different regions with identical keys. Verify fencing token and control epoch prevent the non-leader node from acquiring signing grants.

---

## 10. Implementation Order (P0 / P1 / P2)

```
PHASE P0: Critical Capital Safety & Durability (Prerequisite for Any Real Capital)
  ├─ 1. Exactly-once execution generation with atomic message_hash binding.
  ├─ 2. Persist-before-broadcast journal with synchronous WAL fsync.
  ├─ 3. Raw integer token math (10^decimals) across all balance and position state.
  ├─ 4. AccountCapabilityEnvelope and CapabilityClosureHash enforcement in SigningFirewall.
  ├─ 5. Dual-deadline verification (Protocol block height vs Economic alpha decay).
  ├─ 6. Multi-provider causal slot barrier and monotonicity guard.
  ├─ 7. Token-2022 hard semantic vetoes (permanent delegate, default frozen, pausable).
  └─ 8. Fee burn sentinel and hourly infrastructure loss ceilings.

PHASE P1: Institutional Custody & Execution Optimization
  ├─ 1. On-Chain SYLPH Guard Anchor program implementation (CAP-001..CAP-015).
  ├─ 2. PDA Vault integration (L2 custody model).
  ├─ 3. Post-execution CPI closure tree auditing.
  ├─ 4. Solaris leader-schedule-aware landing with direct TPU QUIC routing.
  ├─ 5. Mainnet shadow twin engine running in parallel with live feed.
  └─ 6. Automated counterfactual execution attribution lab.

PHASE P2: Advanced Infrastructure & Protocol Adaptability
  ├─ 1. Full Solana V1 transaction resource optimization (loaded account bytes, heap).
  ├─ 2. Multi-region signer fencing with distributed consensus leases.
  ├─ 3. Hardware security module (HSM) multi-party computation (MPC) cold fallback.
  └─ 4. Dynamic AMM post-graduation cross-venue routing (PumpSwap + Raydium + Meteora).
```

---

## 11. Migration Strategy

To transition from the current dual-stack architecture to the unified autonomous platform without destabilizing operational research or live paper telemetry:

```
STEP 1: Dual-Module Decoupling
  - Maintain the Python engine (SOS.py) for market discovery, candidate filtering, and ML inference.
  - Route candidate opportunities via IPC / WebSocket to the TypeScript Platform execution pipeline.

STEP 2: Platform Execution Interlock
  - Bind all execution dispatching through the TypeScript SigningFirewall and DurableLiveSigner.
  - Disable raw RPC sendTransaction in Python; all execution requests emit signed ExecutionPermits.

STEP 3: Ledger & Journal Unification
  - Synchronize SQLite trades.db and TypeScript EventLedger using the canonical SHA-256 event schema.
  - Enforce startup reconciliation across both state layers on system boot.

STEP 4: Shadow Staging Verification
  - Run the platform in Mainnet Shadow Twin mode for 72 continuous hours.
  - Measure 0 duplicate executions, 100% reconciliation accuracy, and zero invariant violations.

STEP 5: Promotion to Micro-Live Canary
  - Activate L0/L1 hot wallet execution bounded to $10 maximum capital envelope.
  - Re-evaluate performance and safety metrics across 50 consecutive completed trades.
```

---

## 12. Live Certification Criteria

Autonomous unattended operation with real capital requires satisfying objective, verifiable benchmarks across three promotion tiers:

### Tier 1: Micro-Live Canary ($10 Maximum Exposure)
- [ ] 72 hours continuous operation in Mainnet Shadow mode with zero crashes.
- [ ] Zero duplicate transaction submissions observed on-chain.
- [ ] 100% startup reconciliation pass across all 6 core event invariants.
- [ ] Signing firewall rejected 100% of synthetic adversarial replay attempts.
- [ ] Multi-provider quorum confirmed across ≥2 independent RPC backends.
- [ ] Raw integer accounting verified ($10^{\text{decimals}}$ exact balance matching).

### Tier 2: Limited Autonomous Trading ($100 Maximum Exposure)
- [ ] ≥ 50 consecutive Micro-Live trades executed with clean post-execution CPI audits.
- [ ] Realized slippage within ±1.5% of simulated quotes.
- [ ] Zero unjournaled signatures in AWS KMS audit log.
- [ ] Dynamic staged trailing stops successfully executed partial and full exits.
- [ ] Fee burn sentinel verified: infrastructure fees $\le 12\%$ of gross profits.
- [ ] Token-2022 semantic monitor successfully vetoed 100% of malicious candidate tokens.

### Tier 3: Normal Autonomous Trading (Full Mandate Budget)
- [ ] SYLPH Guard PDA Vault deployed and certified on Mainnet-Beta.
- [ ] Zero CAP-001 through CAP-015 invariant violations across 200 trades.
- [ ] Profit Factor $\ge 2.0$ with Net Realized PnL $> 0$ after all fees and tips.
- [ ] Process survives abrupt termination (SIGKILL) and recovers state deterministically without manual intervention.
- [ ] 13 mandatory gates in `ReleaseCertificationAuthority` evaluated to `PASSED`.

---

*Certified by SOL/SYLPH Principal Systems & Security Engineering Authority.*
