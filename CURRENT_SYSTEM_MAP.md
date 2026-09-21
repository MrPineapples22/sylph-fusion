# SOL-SYLPH — Current System Architecture Map
*Generated as Mandatory Deliverable #1 pursuant to Section 2 of the Intelligence Fabric Master Specification.*

---

## 1. End-to-End Operational Pipeline

```text
1. INPUT (PumpPortal WS, Solana RPC Quorum, DexScreener HTTP)
   ↓
2. PARSING (Raw WS frames, Borsh token-create/trade events, Yellowstone gRPC)
   ↓
3. STATE (ChainTruthEngine, ThreeClocks, MarketTruthEngine, VaultManager)
   ↓
4. FEATURES (PointInTimeFeatureStore, FeatureSnapshot, TemporalFirewall)
   ↓
5. SIGNALS (DecomposedHsiEngine, PumpScoreEngine, PoDEngine, HierarchicalRegimeEngine)
   ↓
6. DECISION (WorldModelEngine, MultiAgentFabric, Skeptic, EvidenceCouncil, AdaptivePolicyRouter)
   ↓
7. RISK (GlobalRiskGovernor, IndependentRiskEngine, TokenProgramInspector, SafetyMonitor)
   ↓
8. EXECUTION (ContextGate, ExecutionStateMachine, ZeroTrustSignerService, CohortEngine)
   ↓
9. POSITION (PositionManager, PositionDefenseState, ExitabilitySurface, ThesisMonitor)
   ↓
10. EXIT (ExitDecisionCore, DefenseLevels D0-D5, EmergencyExitEngine)
   ↓
11. OUTCOME (OutcomeTruthEngine, Multi-horizon checkpoints 5s-3h, CounterfactualEngine)
   ↓
12. LEARNING (AutonomousResearchLab, NegativeKnowledgeDB, DigitalTwin, DeterministicReplay)
```

---

## 2. Granular Stage Specifications

### Stage 1: Input & Ingestion
- **Files**:
  - [`src/feed.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/feed.ts)
  - [`src/rpc.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/rpc.ts)
  - [`src/intelligence/truth/rpc-pool.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/truth/rpc-pool.ts)
- **Classes/Functions**:
  - `startFeed(callback)`
  - `RPCProviderPool.checkHealth()`, `getQuorumSlot()`
  - `RpcClient.getAccountInfo()`, `getLatestBlockhash()`
- **Inputs**: WebSocket packets from `wss://pumpportal.fun/api/data`, JSON-RPC over HTTPS.
- **Outputs**: Raw parsed token create and trade event dictionaries.
- **Dependencies**: `ws`, `@solana/web3.js`.
- **State Ownership**: `feed.ts` owns WebSocket reconnect state; `RPCProviderPool` owns provider latency/slot lag metrics.
- **Update Frequency**: Event-driven tick-by-tick (up to 2,000 events/sec peak).
- **Async Boundaries**: Background async WebSocket message listener task.
- **Error Handling**: Exponential backoff reconnects, 429 rate limit detection, circuit breaker isolation.
- **Persistence**: Session logs in `sessions/*.jsonl`.
- **Tests**: `test/intelligence/truth-and-temporal.test.mjs`.
- **Connections**: Feeds into Stage 2 (Parsing) and `ChainTruthEngine`.

---

### Stage 2: Parsing & Canonical Serialization
- **Files**:
  - [`src/feed.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/feed.ts)
  - [`src/intelligence/truth/types.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/truth/types.ts)
- **Classes/Functions**:
  - `parseEventPayload()`
  - `CanonicalEvent` construction
- **Inputs**: Raw JSON strings and buffers.
- **Outputs**: Strictly typed `CanonicalEvent<TPayload>` containing `slot`, `monotonicTimestampNs`, `commitment`, `sourceConfidence`, and `provenance`.
- **Dependencies**: `node:crypto`, `zod`.
- **State Ownership**: Stateless transformation.
- **Update Frequency**: Per received message.
- **Async Boundaries**: Synchronous CPU parsing offloaded from event loop.
- **Error Handling**: Malformed JSON drops logged with error taxonomy without crashing process.
- **Persistence**: Event payload SHA-256 stored in `CanonicalEvent.payload`.
- **Tests**: `test/kolscan.test.mjs`, `test/intelligence/truth-and-temporal.test.mjs`.
- **Connections**: Emits to `ChainTruthEngine` and `TemporalFirewall`.

---

### Stage 3: Chain Truth & Three-Clock State
- **Files**:
  - [`src/intelligence/truth/chain-truth.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/truth/chain-truth.ts)
  - [`src/intelligence/truth/three-clocks.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/truth/three-clocks.ts)
  - [`src/platform/ledger/event-ledger.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/platform/ledger/event-ledger.ts)
- **Classes/Functions**:
  - `ChainTruthEngine.registerEvent()`, `advanceSlotCommitment()`, `handleForkReorganization()`
  - `ThreeClocks.getTimestamps()`
  - `EventLedger.appendEvent()`
- **Inputs**: Canonical events, slot confirmation notifications.
- **Outputs**: Authoritative slot state (`processed`, `confirmed`, `finalized`), rollback dispatches.
- **Dependencies**: None (pure TypeScript/Node).
- **State Ownership**: `ChainTruthEngine` owns canonical slot history; `ThreeClocks` tracks Chain, Market, and Execution clocks.
- **Update Frequency**: Per slot (~400ms).
- **Async Boundaries**: In-process synchronous slot sequencing.
- **Error Handling**: Fork detection triggers forensic rollback handlers without deleting contradictory history.
- **Persistence**: Immutable hash-chained audit logs.
- **Tests**: `test/intelligence/truth-and-temporal.test.mjs`, `test/platform/vault-and-ledger.test.mjs`.
- **Connections**: Downstream to `TemporalFirewall` and `PointInTimeFeatureStore`.

---

### Stage 4: Features & Temporal Firewall
- **Files**:
  - [`src/intelligence/truth/temporal-firewall.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/truth/temporal-firewall.ts)
  - [`src/intelligence/truth/feature-store.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/truth/feature-store.ts)
  - [`src/candidate-snapshot.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/candidate-snapshot.ts)
- **Classes/Functions**:
  - `TemporalFirewall.assertAvailableBeforeDecision()`
  - `PointInTimeFeatureStore.recordSnapshot()`, `getPointInTimeSnapshot()`
- **Inputs**: Token trade sequences, reserve ratios, buyer address histories.
- **Outputs**: Immutable `FeatureSnapshot` with SHA-256 hash.
- **Dependencies**: `node:crypto`.
- **State Ownership**: `PointInTimeFeatureStore` owns token feature maps indexed by `mint` and `slot`.
- **Update Frequency**: Per trade and snapshot evaluation window.
- **Async Boundaries**: Synchronous calculation.
- **Error Handling**: Throws `TemporalLeakageError` immediately if $T_{\text{info}} > T_{\text{decision}}$.
- **Persistence**: Snapshot store retained for historical replay.
- **Tests**: `test/intelligence/truth-and-temporal.test.mjs`.
- **Connections**: Downstream to Signals and Adversarial engines.

---

### Stage 5: Signal Decomposition & Adversarial Decontamination
- **Files**:
  - [`src/intelligence/signals/hsi.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/signals/hsi.ts)
  - [`src/intelligence/signals/pumpscore.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/signals/pumpscore.ts)
  - [`src/intelligence/signals/regime.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/signals/regime.ts)
  - [`src/intelligence/adversarial/wallet-intelligence.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/adversarial/wallet-intelligence.ts)
  - [`src/intelligence/adversarial/clean-room.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/adversarial/clean-room.ts)
- **Classes/Functions**:
  - `DecomposedHsiEngine.evaluate()`
  - `PumpScoreEngine.calculatePumpScore()`, `PoDEngine.calculateDumpRisk()`
  - `HierarchicalRegimeEngine.evaluate()`
  - `WalletIntelligenceEngine.calculateEffectiveParticipants()`
  - `CleanRoomStateEngine.evaluateDecontamination()`
- **Inputs**: Token reserves, trade diversity, wallet funding graph, Sol macro returns.
- **Outputs**: 7-family decomposed HSI, PumpScore, PoD overhang, `DECEPTION_GAP`, manipulation attack cost.
- **Dependencies**: None.
- **State Ownership**: `WalletIntelligenceEngine` owns wallet identity nodes and funding clusters.
- **Update Frequency**: Evaluated on candidate updates.
- **Async Boundaries**: Synchronous math pipelines.
- **Error Handling**: Graceful fallback to neutral scores if sample count is insufficient.
- **Persistence**: Ephemeral in memory, logged to decision traces.
- **Tests**: `test/intelligence/signals-and-adversarial.test.mjs`.
- **Connections**: Feeds World Model, Skeptic, and Evidence Council.

---

### Stage 6: Decision Core, Multi-Agent Council & Policies
- **Files**:
  - [`src/intelligence/world/world-model.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/world/world-model.ts)
  - [`src/intelligence/agents/skeptic.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/agents/skeptic.ts)
  - [`src/intelligence/agents/evidence-council.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/agents/evidence-council.ts)
  - [`src/intelligence/policies/adaptive-router.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/policies/adaptive-router.ts)
- **Classes/Functions**:
  - `WorldModelEngine.forecast()`
  - `Skeptic.challenge()`
  - `EvidenceCouncil.evaluate()`
  - `AdaptivePolicyRouter.route()`
- **Inputs**: Clean-room signals, token age, regime multiplier, agent assessments.
- **Outputs**: Multi-horizon distribution (+5s to +15m), `ChallengeReport`, `EvidenceCouncilVerdict`, selected policy with `ABSTAIN/ENTER` intent.
- **Dependencies**: `node:crypto`.
- **State Ownership**: Council owns `EvidenceDependencyGraph` and registered agent profiles.
- **Update Frequency**: Per candidate evaluation.
- **Async Boundaries**: Synchronous deterministic decision formulation.
- **Error Handling**: Contradictions between agents halt execution and force `ABSTAIN`.
- **Persistence**: Decision context recorded with cryptographic SHA-256 step hashing.
- **Tests**: `test/intelligence/world-and-agents.test.mjs`.
- **Connections**: Transmits proposed allocations to Stage 7 (Risk & Safety).

---

### Stage 7: Risk Firewall & Formal Safety Constitution
- **Files**:
  - [`src/intelligence/safety/constitution.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/safety/constitution.ts)
  - [`src/intelligence/safety/safety-monitor.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/safety/safety-monitor.ts)
  - [`src/intelligence/execution/token-inspector.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/execution/token-inspector.ts)
  - [`src/platform/risk/independent-risk-engine.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/platform/risk/independent-risk-engine.ts)
- **Classes/Functions**:
  - `SafetyConstitution.getRules()`
  - `SafetyMonitor.evaluate()`
  - `TokenProgramInspector.inspect()`
  - `IndependentRiskEngine.evaluateTradeRisk()`
- **Inputs**: Token program bytecode authorities, double-entry conservation status, quote age, emergency stop flags.
- **Outputs**: `SafetyMonitorVerdict` (`canAuthorizeNewCapital: boolean`, `safetyStatus: 'GREEN_OPERATIONAL' | 'RED_LOCKED'`).
- **Dependencies**: None.
- **State Ownership**: `SafetyMonitor` holds last verdict; `SafetyConstitution` is static and immutable.
- **Update Frequency**: Checked on every execution authorization request.
- **Async Boundaries**: Synchronous gate.
- **Error Handling**: Fail-closed architecture. Any invariant breach instantly locks capital authority.
- **Persistence**: Violations permanently appended to safety logs.
- **Tests**: `test/intelligence/safety-and-twin.test.mjs`, `test/platform/risk-lifecycle-cohort.test.mjs`.
- **Connections**: Authorizes Stage 8 (Execution).

---

### Stage 8: Execution, Context Gate & Signing
- **Files**:
  - [`src/intelligence/context/context-gate.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/context/context-gate.ts)
  - [`src/intelligence/execution/execution-state-machine.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/execution/execution-state-machine.ts)
  - [`src/execution.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/execution.ts)
  - [`src/platform/signing/signer-service.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/platform/signing/signer-service.ts)
- **Classes/Functions**:
  - `ContextGate.authorize()`
  - `ExecutionStateMachine.transition()`
  - `Executor.build()`, `sendTransaction()`
  - `ZeroTrustSignerService.signTransaction()`
- **Inputs**: Authorized `OrderIntent`, Jupiter swap quotes, fresh blockhashes.
- **Outputs**: Built, signed, submitted Solana transaction or paper simulation fill.
- **Dependencies**: `@solana/web3.js`, `@pump-fun/pump-sdk`.
- **State Ownership**: `ExecutionStateMachine` owns order state from `CREATED` to `RECONCILED`.
- **Update Frequency**: On approved trade intents.
- **Async Boundaries**: Async RPC network submission.
- **Error Handling**: Requote timeouts, slippage exceedances, blockhash expiry rollback.
- **Persistence**: Transaction signatures and fill records stored in `fills.csv` and `session.jsonl`.
- **Tests**: `test/executor.test.mjs`, `test/intelligence/kernel-and-execution.test.mjs`.
- **Connections**: Hands fills off to Stage 9 (Position Defense) and Stage 10 (Exit).

---

### Stage 9: Position Defense & Exitability Surfaces
- **Files**:
  - [`src/intelligence/execution/position-defense.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/execution/position-defense.ts)
  - [`src/paper.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/paper.ts)
  - [`src/core.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/core.ts)
- **Classes/Functions**:
  - `PositionDefenseState.evaluate()`
  - `ExitabilitySurface.calculate()`
  - `ThesisMonitor.checkConditions()`
  - `PositionManager.update()`
- **Inputs**: Live price ticks, pool reserve changes, order flow toxicity.
- **Outputs**: Defense level (D0 Normal $\rightarrow$ D5 Emergency), executable exit value vs mark value.
- **Dependencies**: None.
- **State Ownership**: `PositionManager` owns live position balances; `PositionDefenseState` tracks risk levels.
- **Update Frequency**: Continuous on every price tick.
- **Async Boundaries**: In-process synchronous monitoring.
- **Error Handling**: Thesis invalidation automatically elevates defense level to D3/D4.
- **Persistence**: State checkpoints in `sessions/`.
- **Tests**: `test/paper.test.mjs`, `test/intelligence/position-defense-and-policies.test.mjs`.
- **Connections**: Drives Stage 10 (Exit Engine).

---

### Stage 10: Exit Engine & De-escalation
- **Files**:
  - [`src/intelligence/execution/position-defense.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/execution/position-defense.ts)
  - [`src/paper.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/paper.ts)
- **Classes/Functions**:
  - `ExitDecisionCore.evaluateExit()`
  - `EmergencyExitEngine.triggerFastExit()`
- **Inputs**: Target take-profits, trailing stops, defense triggers, liquidity decay alerts.
- **Outputs**: Exit order intent, realized gains/losses.
- **Dependencies**: `@solana/web3.js`.
- **State Ownership**: `PositionManager` mutates open position state to closed.
- **Update Frequency**: High-priority real-time loop.
- **Async Boundaries**: Fast-path async execution dispatch.
- **Error Handling**: Slippage mitigation via partial reduction ladders.
- **Persistence**: Realized trades logged to double-entry journal and CSV.
- **Tests**: `test/paper-exit-ladder.test.mjs`.
- **Connections**: Feeds Stage 11 (Outcome Truth).

---

### Stage 11: Outcome Truth & Counterfactuals
- **Files**:
  - [`src/intelligence/science/outcome-truth.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/science/outcome-truth.ts)
  - [`src/intelligence/science/counterfactual.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/science/counterfactual.ts)
  - [`src/intelligence/science/evidence-ladder.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/science/evidence-ladder.ts)
- **Classes/Functions**:
  - `OutcomeTruthEngine.evaluateOutcome()`
  - `CounterfactualEngine.evaluateDecision()`
  - `ScientificValidationEngine.runFalsificationSuite()`
- **Inputs**: Post-trade price trajectories at checkpoints (5s, 10s, 30s, 1m, 3m, 5m, 10m, 15m, 30m, 1h, 3h).
- **Outputs**: Versioned outcome labels (`RUNNER`, `RUG`, `HARD_DUMP`, `FLAT`), filter value scores, Evidence Ladder tiers (0–7).
- **Dependencies**: None.
- **State Ownership**: Immutable historical outcome records.
- **Update Frequency**: Evaluated at future checkpoint intervals.
- **Async Boundaries**: Background evaluation tasks.
- **Error Handling**: Missing historical ticks flagged as incomplete rather than zeroed.
- **Persistence**: Stored in episodic memory archives.
- **Tests**: `test/intelligence/science-and-research.test.mjs`.
- **Connections**: Transmits findings to Stage 12 (Learning & Governance).

---

### Stage 12: Autonomous Research Lab & Digital Twin
- **Files**:
  - [`src/intelligence/research/autonomous-lab.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/research/autonomous-lab.ts)
  - [`src/intelligence/research/negative-db.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/research/negative-db.ts)
  - [`src/intelligence/twin/digital-twin.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/twin/digital-twin.ts)
  - [`src/intelligence/governance/manifest.ts`](file:///c:/Users/juans/Documents/Codex/2026-09-16/sylph-fusion/src/intelligence/governance/manifest.ts)
- **Classes/Functions**:
  - `AutonomousResearchLab.evaluateHypothesis()`
  - `NegativeKnowledgeDB.recordFailure()`
  - `DigitalTwin.replayEventStream()`
  - `StrategyGovernance.evaluateProductionGates()`, `promoteToChampion()`
- **Inputs**: Historical event logs, candidate hypothesis statements.
- **Outputs**: `ResearchProposal` (read-only), negative knowledge records, `ReplayFingerprint`, `ProductionSafetyCertificate`.
- **Dependencies**: `node:crypto`.
- **State Ownership**: `StrategyGovernance` owns active champion manifest.
- **Update Frequency**: Scheduled research batch runs when P0-P2 load is $< 0.75$.
- **Async Boundaries**: Compute-throttled worker tasks.
- **Error Handling**: Invariant: Research cannot self-promote to Champion or access live signing keys.
- **Persistence**: Proposal manifests and negative knowledge entries saved to disk.
- **Tests**: `test/intelligence/science-and-research.test.mjs`, `test/intelligence/safety-and-twin.test.mjs`, `test/intelligence/master-intelligence-e2e.test.mjs`.
- **Connections**: Governs production release candidates.
