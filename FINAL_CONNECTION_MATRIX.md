# SOL-SYLPH — Final Producer/Consumer Connection Matrix
*Generated as Final Deliverable pursuant to Section 79 of the Intelligence Fabric Master Specification.*

---

## Complete Subsystem Connection Matrix

| Producer Subsystem | Output Data Contract | Consumer Subsystem | Consumer Input Expected | Error / Degradation Path |
| :--- | :--- | :--- | :--- | :--- |
| **PumpPortal WS Adapter** | Raw token create / trade JSON | `feed.ts` Parsing Pipeline | Raw string buffer | Reconnect backoff, circuit breaker trip |
| **`feed.ts` Parser** | `CanonicalEvent` | `ChainTruthEngine` | `CanonicalEvent` with slot & timestamps | Drop malformed frame; increment error counter |
| **`ChainTruthEngine`** | Reconciled slot state & forks | `ThreeClocks`, `TemporalFirewall` | Slot commitment, block time | Forensic rollback without deleting history |
| **`ThreeClocks`** | `ThreeClocksSnapshot` | `TemporalFirewall`, Context Gate | Monotonic & market timestamps | Fallback to local monotonic clock on lag |
| **`TemporalFirewall`** | Verified point-in-time boundary | `PointInTimeFeatureStore` | $T_{\text{info}} \le T_{\text{decision}}$ assertion | Throws `TemporalLeakageError`; halts decision |
| **`PointInTimeFeatureStore`**| `FeatureSnapshot` (SHA-256) | Feature Extractors, Signals | Historical feature vectors | Stale data flag; zero future exposure |
| **`WalletIntelligenceEngine`**| `EffectiveIndependentParticipants` | `DecomposedHsiEngine`, CleanRoom | Cluster count, dispersal ratio | Falls back to raw count if clusters unknown |
| **`ActorKnowledgeGraph`** | `ActorProfile`, Recurrence Risk | `AdaptivePolicyRouter`, Council | Serial rugger flag, reputation | Defaults to neutral reputation (50) |
| **`CoordinationScoreEngine`**| `CoordinationEvaluation` | `CleanRoomStateEngine`, Decision | Coordination score (0-1), Sybil flag | Low confidence fallback for $< 2$ trades |
| **`LiquidityDepthEngine`** | `LiquidityDepthProfile` | `PositionDefenseEngine`, Gate | $PriceImpact(size)$, safe capacity | Linear depth approximation if curve sparse |
| **`FlowToxicityEngine`** | `HorizonFlowMetrics` | `PositionDefenseEngine`, World | Toxicity score, net flow velocity | Zero toxicity if volume is balanced |
| **`DecomposedHsiEngine`** | `DecomposedHsiReport` | `CleanRoomStateEngine`, World | 7 evidence families (0-100) | Neutral family scores on low sample count |
| **`PumpScoreEngine` / `PoD`**| Momentum & Overhang scores | `CleanRoomStateEngine`, World | Curve velocity, sniper overhang | Clamped to safe 0-100 ranges |
| **`CleanRoomStateEngine`** | `DeceptionGapReport` | `WorldModelEngine`, Skeptic | Deception gap, manipulation cost | Flags severe deception if divergence $\ge 25$ |
| **`WorldModelEngine`** | `WorldModelForecast` | Agent assessments, Council | Multi-horizon distributions (+5s-+15m)| Widens uncertainty intervals on volatility |
| **Agent Assessments** | `AgentAssessment` Fabric | `EvidenceCouncil` | Typed assessments with assumptions | Excludes assessments exceeding latency SLO |
| **`The Skeptic`** | `ChallengeReport` | `EvidenceCouncil` | Fatal flaws, fragile assumptions | Vetoes thesis if manipulability cost $< 0.2$ SOL |
| **`EvidenceCouncil`** | `EvidenceCouncilVerdict` | `AdaptivePolicyRouter`, Decision | State, `EffectiveEvidenceCount` | Halts execution on logical contradiction |
| **`OODSentinel`** | `OodAssessment` | `AdaptivePolicyRouter`, Gate | Epistemic state (`KNOWN` to `UNKNOWN`)| Clamps capital multiplier to 0.0 on OOD |
| **`AdaptivePolicyRouter`** | `PolicyDecision` | Decision Kernel, Opportunity Board| Selected policy, action, stop/TP | Forces `OBSERVE` on uncertainty |
| **`PortfolioOpportunityEngine`**| Opportunity Board, Tail Loss | `SafetyMonitor`, Risk Governor | $ES_{90}/ES_{95}/ES_{99}$, risk capacity | Prefers cash when risk-adjusted payoff unviable|
| **`SafetyConstitution`** | 10 Immutable Safety Rules | `SafetyMonitor` | Static invariant definitions | Hard constraints cannot be traded away |
| **`SafetyMonitor`** | `SafetyMonitorVerdict` | `ContextGate`, Decision Kernel | `canAuthorizeNewCapital: boolean` | Fail-closed: locks capital on any violation |
| **`ContextGate`** | `ContextGateResult` | `ZeroTrustSignerService` | `AUTHORIZE` / `REQUOTE` / `WAIT` | Aborts signing if quote $> 1200\text{ms}$ or route dead |
| **`ZeroTrustSignerService`** | Signed Solana Transaction | `ExecutionStateMachine` | Verified signature buffer | Rejects unwhitelisted destination addresses |
| **`ExecutionStateMachine`** | Transaction Fill / Receipt | `PositionDefenseEngine`, Ledger | `CONFIRMED` $\rightarrow$ `RECONCILED` fill | Reconciles with chain balance before booking |
| **`PositionDefenseEngine`** | `PositionDefenseStateReport` | `ExitDecisionCore`, UI View Model| Defense levels D0-D5, Exitability | Thesis invalidation escalates to D4/D5 |
| **`OutcomeTruthEngine`** | `OutcomeTruthRecord` | `CounterfactualEngine`, Research | Checkpoints (5s-3h), MFE, MAE | Incomplete historical ticks flagged as unverified |
| **`CounterfactualEngine`** | `CounterfactualComparison` | `AutonomousResearchLab` | Filter value score, timing comparison | Shadow tracking only; cannot execute trades |
| **`AutonomousResearchLab`** | `ResearchProposal` | `StrategyGovernance` | Backtest Sharpe, Hypothesis | Read-only; cannot self-promote to live |
| **`StrategyGovernance`** | `StrategyManifest`, Gate Report | Master Orchestrator | Champion manifest, Safety Certificate | Human approval boundary required for live |
| **Master Orchestrator** | `AetherFluxViewModel` | Aether Flux Presentation Cockpit | Table rows, Top-3, Status, Links | UI cockpit untouched; displays viewmodel |
