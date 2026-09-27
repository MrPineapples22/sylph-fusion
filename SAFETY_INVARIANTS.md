# SYLPH FUSION — FORMAL SAFETY INVARIANTS SPECIFICATION

**Document Status:** Living Master Engineering Specification  
**Authority:** Section 103 (Absolute Invariants) & Section 4 (Non-Negotiable Safety Rules)  
**Enforcement Policy:** Strict Fail-Closed. Any detected invariant violation immediately halts risk-increasing authority and triggers emergency defensive protocols.  
**Verification Baseline:** 1,017 / 1,017 tests passing (100% deterministic pass rate, 0 failures)

---

## 1. Absolute Invariant Registry

The 18 non-negotiable system invariants are formally specified below:

### Invariant 1: No Unknown Transaction Releases Capital
- **Formal Definition:** $\forall tx \in \text{Transactions}, \quad \text{Status}(tx) = \text{UNKNOWN} \implies \text{CapitalReserved}(tx) = \text{CapitalRequested}(tx)$.
- **Enforcement Location:** `src/platform/ledger/clearing.ts`, `src/platform/signing/settlement-firewall.ts`, `src/core.ts`.
- **Violation Action:** Capital remains 100% reserved. An RPC timeout or "not found" response is classified as `UNKNOWN_TRANSACTION` and triggers multi-provider ledger coverage sweeps. Capital is NEVER released back to available balance without finalized on-chain proof of non-inclusion past `lastValidBlockHeight + 32`.
- **Verification Tests:** `test/platform/clearing.test.mjs` (3/3 pass), `test/adversarial-chaos.test.mjs:NEMESIS-002` (pass).

### Invariant 2: No Execution Without an Economic Intent
- **Formal Definition:** $\forall tx \in \text{ExecutedTransactions}, \quad \exists ! \; intent \in \text{EconomicIntents} \quad \text{s.t.} \quad tx.\text{intentId} = intent.\text{id}$.
- **Enforcement Location:** `src/platform/control/command-seal.ts`, `src/platform/execution/execution-witness.ts`, `src/command-gateway.ts`.
- **Violation Action:** Any transaction construction attempt lacking a cryptographically signed, unexpired `EconomicIntent` envelope is rejected prior to simulation or route planning.
- **Verification Tests:** `test/platform/command-seal.test.mjs` (3/3 pass), `test/platform/execution-witness.test.mjs` (3/3 pass).

### Invariant 3: No Economic Intent Executes Twice
- **Formal Definition:** $\forall intent \in \text{EconomicIntents}, \quad |\{ tx \in \text{ExecutedTransactions} : tx.\text{intentId} = intent.\text{id} \}| \le 1$.
- **Enforcement Location:** `src/platform/control/command-seal.ts`, `src/platform/signing/durable-live-signer.ts`, `src/store.ts`.
- **Violation Action:** Intent IDs and anti-replay nonces are tracked in a persistent execution journal. Repeated submissions with the same `intentId` return the cached execution receipt or raise `DUPLICATE_INTENT_ERROR`.
- **Verification Tests:** `test/platform/command-seal.test.mjs` (anti-replay pass), `test/platform/kms-signing-statemachine.test.mjs` (pass).

### Invariant 4: No Stale Fence Can Sign
- **Formal Definition:** $\forall req \in \text{SignRequests}, \quad req.\text{fenceEpoch} \ne \text{CurrentFenceEpoch} \implies \text{Sign}(req) = \text{REJECTED}$.
- **Enforcement Location:** `src/platform/control/command-seal.ts`, `src/platform/signing/durable-live-signer.ts`.
- **Violation Action:** The isolated signer bastion queries the external distributed coordinator; any mismatch between request epoch and current epoch aborts signing immediately with `STALE FENCE REJECTION`, preventing split-brain dual execution.
- **Verification Tests:** `test/platform/command-seal.test.mjs` (stale fence pass), `test/adversarial-chaos.test.mjs:NEMESIS-007` (pass).

### Invariant 5: No Signature Without a Durable Intent
- **Formal Definition:** $\forall sig \in \text{Signatures}, \quad \text{PersistedInJournal}(sig.\text{intentId}) = \text{TRUE} \quad \text{prior to signing dispatch}$.
- **Enforcement Location:** `src/platform/signing/durable-live-signer.ts:48`.
- **Violation Action:** State transitions from `PREPARED` to `SIGNING_IN_FLIGHT` on disk before dispatching to KMS. If the journal write fails, signing is blocked.
- **Verification Tests:** `test/platform/kms-signing-statemachine.test.mjs` (3/3 pass), `test/adversarial-chaos.test.mjs:NEMESIS-001` (pass).

### Invariant 6: No Live Signature Without an Execution Witness
- **Formal Definition:** $\forall sig \in \text{LiveSignatures}, \quad \exists ! \; W \in \text{ExecutionWitnesses} \quad \text{s.t.} \quad W.\text{messageHash} = \text{SHA256}(sig.\text{message})$.
- **Enforcement Location:** `src/platform/execution/execution-witness.ts`, `src/platform/signing/signing-firewall.ts`.
- **Violation Action:** Unwitnessed messages trigger `WitnessInvariantViolationError` and are dropped by the signing firewall.
- **Verification Tests:** `test/platform/execution-witness.test.mjs` (3/3 pass), `test/adversarial-chaos.test.mjs:NEMESIS-009` (pass).

### Invariant 7: No Execution Witness Without Exact Simulation
- **Formal Definition:** $\forall W \in \text{ExecutionWitnesses}, \quad W.\text{simulated} = \text{TRUE} \land W.\text{simulatedMessageHash} = W.\text{messageHash}$.
- **Enforcement Location:** `src/platform/execution/execution-witness.ts`, `src/execution-engine.ts`.
- **Violation Action:** If any instruction, account, ALT, compute budget, or priority fee is modified post-simulation, the witness is invalidated and must be rebuilt and re-simulated.
- **Verification Tests:** `test/platform/execution-witness.test.mjs` (3/3 pass), `test/adversarial-chaos.test.mjs:NEMESIS-009` (pass).

### Invariant 8: No Open/Increase Without Capital Reservation
- **Formal Definition:** $\forall cmd \in \{\text{OPEN}, \text{INCREASE}\}, \quad \text{AvailableCapital} \ge \text{RequiredCapital}(cmd) \implies \text{Reserve}(\text{RequiredCapital}(cmd))$.
- **Enforcement Location:** `src/platform/execution/execution-witness.ts`, `src/platform/ledger/dimension-ledger.ts`, `src/platform/ledger/clearing.ts`.
- **Violation Action:** Capital envelope reservations are atomic. If available unreserved capital is insufficient to cover principal + maximum fees + rent, execution aborts with `INSUFFICIENT_UNRESERVED_CAPITAL`.
- **Verification Tests:** `test/platform/dimension-ledger.test.mjs` (3/3 pass), `test/platform/clearing.test.mjs` (3/3 pass).

### Invariant 9: No Open/Increase Without Exitability
- **Formal Definition:** $\forall cmd \in \{\text{OPEN}, \text{INCREASE}\}, \quad \text{ExitProofScore}(token) \ge \text{E3_EXACT_SIMULATION}$.
- **Enforcement Location:** `src/platform/execution/escape-root.ts`, `src/platform/execution/venue-economics.ts`, `src/exit-policy.ts`.
- **Violation Action:** If liquidity is deteriorating, transfer hooks are unverified, or exit route simulation fails, new entry is blocked with `EXITABILITY_UNVERIFIED`.
- **Verification Tests:** `test/platform/escape-root.test.mjs` (3/3 pass), `test/platform/venue-economics.test.mjs` (2/2 pass).

### Invariant 10: No Open/Increase Without Survival SOL
- **Formal Definition:** $\forall cmd \in \{\text{OPEN}, \text{INCREASE}\}, \quad \text{LiquidSOLPostEntry} \ge \text{PortfolioEmergencyRequirement}$.
- **Enforcement Location:** `src/platform/execution/escape-root.ts:140`.
- **Violation Action:** Dynamic portfolio survival requirement accounts for base fees, priority fees, Jito tips, and failed retries across all open positions. If proposed entry would infringe upon survival reserve, entry is rejected with `SURVIVAL_TREASURY_INSUFFICIENT`.
- **Verification Tests:** `test/platform/escape-root.test.mjs` (survival treasury pass), `test/adversarial-chaos.test.mjs:NEMESIS-005` (pass).

### Invariant 11: No Position Without Reconcilable Inventory
- **Formal Definition:** $\forall pos \in \text{Positions}, \quad \sum_{l \in pos.\text{lots}} l.\text{remainingRawQuantity} = \text{VerifiedOnChainBalance}(pos.\text{mint})$.
- **Enforcement Location:** `src/platform/ledger/lot-root.ts`, `src/platform/lifecycle/start-seal.ts`.
- **Violation Action:** Any discrepancy between lot quantities and on-chain token balance halts execution authority into `REDUCE_ONLY` until manual or automated reconciliation completes.
- **Verification Tests:** `test/platform/lot-root.test.mjs` (3/3 pass), `test/platform/start-seal.test.mjs` (3/3 pass), `test/adversarial-chaos.test.mjs:NEMESIS-004` (pass).

### Invariant 12: No Model Decision Without Model Artifact Identity
- **Formal Definition:** $\forall d \in \text{Decisions}, \quad \exists ! \; M \in \text{ModelArtifacts} \quad \text{s.t.} \quad d.\text{modelEpoch} = M.\text{epoch} \land M.\text{weightsHash} = \text{SHA256}(\text{weights})$.
- **Enforcement Location:** `src/intelligence/science/model-epoch.ts`.
- **Violation Action:** Predictions generated by uncertified, drifting, or unstamped model weights are discarded with `UNCERTIFIED_MODEL_EPOCH`.
- **Verification Tests:** `test/intelligence/model-epoch.test.mjs` (2/2 pass).

### Invariant 13: No Training Row With Future Information
- **Formal Definition:** $\forall (x_t, y_t) \in \text{TrainingData}, \quad \forall f \in x_t, \quad f.\text{availableAt} \le t_{\text{decision}} < t_{\text{target}}$.
- **Enforcement Location:** `src/intelligence/science/model-epoch.ts`, `src/intelligence/attribution/trade-learning-service.ts`.
- **Violation Action:** Features tagged with future context slots or arrival timestamps $> t_{\text{decision}}$ trigger an immediate pipeline assertion error (`FUTURE_FEATURE_LEAKAGE`).
- **Verification Tests:** `test/intelligence/model-epoch.test.mjs` (point-in-time pass).

### Invariant 14: No Provider Claim Without Provenance
- **Formal Definition:** $\forall fact \in \text{CriticalFacts}, \quad |\{ g \in \text{CorrelationGroups}(\text{Providers}(fact)) \}| \ge 2 \land \text{Disagreement}(fact) = \text{FALSE}$.
- **Enforcement Location:** `src/platform/ingestion/quorum-root.ts`, `src/platform/ingestion/contract-canary.ts`.
- **Violation Action:** Endpoints sharing failure domains (same operator/region) only count as 1 group. Provider disagreement produces status `CONFLICTED` and is never silently averaged.
- **Verification Tests:** `test/platform/quorum-root.test.mjs` (3/3 pass), `test/adversarial-chaos.test.mjs:NEMESIS-008` (pass).

### Invariant 15: No Production Release Without Exact Artifact Identity
- **Formal Definition:** $\text{LiveSigningPermitted} = \text{TRUE} \iff \text{RuntimeSeal}.\text{releaseRoot} = \text{AuthorizedReleaseRoot} \land \text{BytecodeHashMatches}$.
- **Enforcement Location:** `src/platform/certification/build-seal.ts`, `src/platform/certification/release-certification.ts`.
- **Violation Action:** Any tampering with compiled artifacts or compiler version mismatch immediately revokes live signing capability.
- **Verification Tests:** `test/platform/build-seal.test.mjs` (1/1 pass).

### Invariant 16: No Healthy/Certified State Without Evidence
- **Formal Definition:** $\text{Status} = \text{HEALTHY} \iff \forall g \in \text{MandatoryGates}, \quad g.\text{evidenceTimestamp} > t_{\text{now}} - \text{MaxStaleMs} \land g.\text{state} = \text{PASSED}$.
- **Enforcement Location:** `src/platform/certification/release-certification.ts:88`.
- **Violation Action:** Absence of evidence is classified as `UNKNOWN`, never favorable. Live capital authority defaults to `BLOCKED`.
- **Verification Tests:** `test/platform/release-certification.test.mjs`.

### Invariant 17: Close/Reduce Must Remain Stronger Than Entry During Incidents
- **Formal Definition:** $\text{SystemIncidentActive} \implies \text{EntryAllowed} = \text{FALSE} \land \text{ExitAllowed} = \text{TRUE} \land \text{Priority}(\text{CLOSE}) > \text{Priority}(\text{OPEN})$.
- **Enforcement Location:** `src/platform/execution/orchestra-x.ts`, `src/lifecycle/system-lifecycle.ts`.
- **Violation Action:** Any system incident, RPC degradation, or safety halt transitions the engine into `REDUCE_ONLY`. Risk-increasing operations are discarded, while emergency exit and position reduction lanes remain prioritized and funded.
- **Verification Tests:** `test/platform/orchestra-x.test.mjs` (priority ordering pass).

### Invariant 18: Never Mix Tokens with SOL Units in Ledger
- **Formal Definition:** $\forall op \in \{+, -\}, \quad \text{Dimension}(a) \ne \text{Dimension}(b) \implies a \; op \; b = \text{ERROR}$.
- **Enforcement Location:** `src/platform/ledger/dimension-ledger.ts`.
- **Violation Action:** Throws `DimensionMismatchError`. PnL must use explicit `PriceCertificate` and `PnLValuationCertificate` instead of adding token deltas and SOL deltas.
- **Verification Tests:** `test/platform/dimension-ledger.test.mjs` (3/3 pass).


### Invariant 19: No Graduation Without Verified Pool Liquidity (LIFECYCLE-Ω)
Tokens completing the Pump bonding curve enter `COMPLETE_UNMIGRATED` or `MIGRATION_PENDING` and are valued as `UNPRICED_MIGRATING`. An open position is never valued at zero or stopped out solely due to migration. Transition to `AMM_ACTIVE` requires verified on-chain pool reserves.

### Invariant 20: Absolute Lamport/Token Conservation with Exact Rounding (NUMERAIRE)
All financial quantities (lamports, token base units, fees, reserves) must be represented as branded `bigint` integers. Conversions require explicit scale and rounding policies (`FLOOR`, `CEIL`, `BANKERS`, `CONSERVATIVE_IN`, `CONSERVATIVE_OUT`). Total assets must satisfy exact conservation across all capital states.

### Invariant 21: No Sign If Transaction Resource Graph Mutates (SENTINEL-ALT)
Transactions must maintain identical `AccountSetHash`, `WritableSetHash`, `SignerSetHash`, `ResourceBudgetHash`, and `LookupResolutionHash` between review, simulation, and signing. Any discrepancy triggers `TRANSACTION_IDENTITY_DRIFT` and immediate rejection.

### Invariant 22: Live Execution Deviating > 15% Halts Strategy on Simulation Drift (SIMULACRUM-X)
Every proposed execution must generate an immutable `SimulationCertificate`. When on-chain execution residuals exceed 15% in slippage, fees, or price impact, `SIMULATION_MODEL_DRIFT` is declared and execution authority is suspended.

### Invariant 23: Certified Training Records Require Point-in-Time Temporal Finality (LABELFORGE)
Only training examples certified as `ECONOMIC_FINAL` with zero future lookahead features may be ingested for model training. Datasets must employ chronological splits with embargo gaps and cluster-aware isolation.

### Invariant 24: High-Risk Operator Commands Require Cryptographic Multi-Party Approval; AI Cannot Self-Approve (TRIBUNAL)
Commands classified as HIGH risk (mainnet enablement, capital ceiling raises, signer configuration changes) require multi-party cryptographic authorization from verified human operators. AI agents are structurally barred from self-approving high-risk commands.

### Invariant 25: Trading Authority Cannot Access Treasury Capital or Breach Ceiling (TREASURY-SHIELD)
Trading execution authority is strictly bounded by the `TradingCapital` envelope. Accumulated profits exceeding the trading ceiling are automatically swept to cold `TreasuryCapital`. External transfers require dedicated credentials and destination allowlisting; incident locks freeze all external sweeps.

### Invariant 26: Strategy Promotion Requires Measured Lower Confidence Bound Net EV (HELIX)
Strategies roll out through a strict 10-stage canary. Promotion to real-capital tiers requires a positive 95% Lower Confidence Bound on net EV over certified sample sizes. Breaches of maximum drawdown immediately trigger automatic demotion to `SHADOW`.

### Invariant 27: Research and AI Systems Have Zero Signing or Capital Ledger Authority (AIRGAP-R)
The SYLPH Research and Intelligence layers are physically airgapped from the Signer, Capital Authority, and Settlement layers. AI outputs are advisory and veto-capable only; they possess zero autonomous signing, broadcast, or ledger-mutation rights.
