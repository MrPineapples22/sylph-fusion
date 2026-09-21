# SOL-SYLPH — Master Integration Plan
*Generated as Mandatory Deliverable #3 pursuant to Section 2 of the Intelligence Fabric Master Specification.*

---

## 1. Phased Integration Sequence

To ensure continuous system stability without disrupting the active 24-hour soak runner (`task-192`), the integration of Major Updates #1 through #14 is organized into 5 sequential execution blocks:

```text
BLOCK 1: Temporal Foundation & Context Fabric (Updates #1, #12, #13)
   ↓
BLOCK 2: Actor Intelligence & Cross-Launch Graph (Updates #2, #3)
   ↓
BLOCK 3: Microstructure, Flow Toxicity & Liquidity Depth (Update #4)
   ↓
BLOCK 4: Adaptive Policies & OOD Sentinel (Updates #5, #11)
   ↓
BLOCK 5: Position Defense, Thesis Monitor & Exitability (Update #14)
   ↓
MASTER ORCHESTRATOR SYNTHESIS & FULL TEST CERTIFICATION
```

---

## 2. Block-by-Block Execution Breakdown

### Block 1: Temporal Foundation & Context Fabric
- **Target Modules**:
  - `src/intelligence/truth/three-clocks.ts`: Explicit `ChainClock`, `MarketClock`, and `ExecutionClock`.
  - `src/intelligence/context/context-snapshot.ts`: Multi-layer context state (Sol, Network, Jito, Meme breadth).
  - `src/intelligence/context/context-gate.ts`: Pre-execution `ContextGate.authorize()` checks.
  - `src/intelligence/execution/latency-trace.ts`: Monotonic generation race guards and signal half-life decay.
- **Verification**: `test/intelligence/context-and-clocks.test.mjs`.

### Block 2: Actor Intelligence & Cross-Launch Graph
- **Target Modules**:
  - `src/intelligence/adversarial/actor-graph.ts`: `ActorKnowledgeGraph` linking wallets, creators, funders, and token deployments.
  - `src/intelligence/adversarial/coordination-score.ts`: Coordination scoring across timing, transaction sizes, and funding lineage.
- **Verification**: `test/intelligence/microstructure-and-actors.test.mjs`.

### Block 3: Market Microstructure & Flow Toxicity
- **Target Modules**:
  - `src/intelligence/microstructure/depth-engine.ts`: Non-linear price impact $PriceImpact(size)$.
  - `src/intelligence/microstructure/flow-toxicity.ts`: Flow acceleration and adverse selection models over 250ms to 1m windows.
  - `src/intelligence/microstructure/exitability.ts`: Real executable liquidation capacity.
- **Verification**: `test/intelligence/microstructure-and-actors.test.mjs`.

### Block 4: Adaptive Policies & OOD Sentinel
- **Target Modules**:
  - `src/intelligence/policies/adaptive-router.ts`: Context-specific trading policies with first-class `ABSTAIN/OBSERVE`.
  - `src/intelligence/safety/ood-sentinel.ts`: `OODSentinel` and Confidence Firewall with epistemic states (`KNOWN`, `NOVEL`, `OOD`, `UNKNOWN`).
- **Verification**: `test/intelligence/position-defense-and-policies.test.mjs`.

### Block 5: Autonomous Position Defense & Thesis Monitor
- **Target Modules**:
  - `src/intelligence/execution/position-defense.ts`: `PositionDefenseState`, `ExitabilitySurface` (25/50/75/100% tranches), `ThesisMonitor`, and defense levels D0–D5.
- **Verification**: `test/intelligence/position-defense-and-policies.test.mjs`.

### Block 6: Master Orchestrator Synthesis & Full Regression
- **Target Modules**:
  - `src/intelligence/master-orchestrator.ts`: Integrate all new engines into the master pipeline.
  - Verification: Full regression across all core (104), platform (17), and intelligence tests with 0 failures.
