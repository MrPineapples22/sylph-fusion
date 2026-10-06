/**
 * SYLPH FUSION — RESEARCH MATRIX BRIDGE
 * Sections XXIX, LIV, and LXII: Mapping all 50 studies into AutonomousRDGovernorX
 *
 * Every one of the 50 studies is registered as a formal ResearchHypothesis.
 * Critical Invariants:
 * 1. Initial state is ALWAYS UNTESTED with 0 assumed Sharpe.
 * 2. Every study has explicit, falsifiable death conditions.
 * 3. Proposer is 'research-matrix-bridge' (cannot self-promote or verify).
 */

import { type ResearchHypothesis, createUntestedHypothesis } from '../../research-governor/research-claim.js';
import { type AutonomousRDGovernorX } from '../../research-governor/rd-governor.js';

export interface StudyDefinition {
  readonly hypothesisId: string;
  readonly description: string;
  readonly mechanism: string;
  readonly falsificationCondition: string;
}

export const ALL_50_EXECUTABLE_ALPHA_STUDIES: readonly StudyDefinition[] = [
  // --- Study Family 1: Observability ---
  {
    hypothesisId: 'EXECUTABLE-PEAK-X',
    description: 'Executable price peaks achievable with bounded slippage and fees are systematically lower than observed chart ATHs.',
    mechanism: 'Discrete block boundaries, liquidity depth limits, and quote decay shave returns from theoretical maximums.',
    falsificationCondition: 'Realized executable fills match or exceed recorded candle high extremes across >10% of samples.',
  },
  {
    hypothesisId: 'MULTI-FEED-RACE-X',
    description: 'Concurrent multi-sensor feeds provide earlier and more reliable state convergence than single-provider RPC.',
    mechanism: 'Geyser streaming, WebSocket diffs, and multiple endpoints mitigate provider-specific dropouts.',
    falsificationCondition: 'Multi-feed aggregation fails to reduce slot-lag or information variance vs single standard RPC.',
  },
  {
    hypothesisId: 'OBSERVABILITY-GAP-X',
    description: 'Gaps in observation intervals conceal catastrophic liquidity drains and front-running cascades.',
    mechanism: 'Discontinuous price reporting hides adverse selection in rapid down-moves.',
    falsificationCondition: 'Unobserved intervals show statistically identical return distributions to continuously observed intervals.',
  },
  {
    hypothesisId: 'INFORMATIVE-CENSORING-X',
    description: 'Abruptly truncated token histories represent informative censoring (liquidity rugs / freeze) rather than random dropouts.',
    mechanism: 'Failed tokens halt trading and lose liquidity, causing sensors to drop missing data non-randomly.',
    falsificationCondition: 'Censored tokens later resume normal trading and positive mean returns in >5% of instances.',
  },
  {
    hypothesisId: 'MNAR-WORST-CASE-X',
    description: 'Treating Missing-Not-At-Random observations as 100% losses removes backtest survivorship bias.',
    mechanism: 'Assuming missing exit outcomes are zero loss inflates strategy expectancy artificially.',
    falsificationCondition: 'Historical recovery audits demonstrate censored outcomes retain >20% capital value on average.',
  },

  // --- Study Family 2: Information Frontier ---
  {
    hypothesisId: 'EARLIEST-INFORMATION-TIME-X',
    description: 'A minimum observation duration T* exists before which mutual information is insufficient to predict extreme runners.',
    mechanism: 'Initial trades reflect sniper noise and deployer funding rather than sustainable organic adoption.',
    falsificationCondition: 'Predictions made before T* achieve positive out-of-sample lift over the 2.77% base rate.',
  },
  {
    hypothesisId: 'BAYES-ERROR-FRONTIER-X',
    description: 'Bayes error rate sets a strict upper bound on runner classification accuracy given point-in-time features.',
    mechanism: 'Irreducible aleatoric market uncertainty bounds classifier precision regardless of model complexity.',
    falsificationCondition: 'Prospective empirical error drops below the theoretical Le Cam and Fano Bayes bounds.',
  },
  {
    hypothesisId: 'VALUE-OF-SENSOR-X',
    description: 'Additional low-latency sensors have diminishing marginal information value per dollar of infrastructure cost.',
    mechanism: 'Redundant feeds duplicate transaction receipts without revealing hidden mempool intent.',
    falsificationCondition: 'Sub-millisecond feeds yield linear or super-linear improvements in realized execution P&L.',
  },
  {
    hypothesisId: 'INFORMATION-VELOCITY-X',
    description: 'The rate of information arrival dI/dt peaks during early bonding curve accumulation and rapidly decays.',
    mechanism: 'Entropy reduction is concentrated during initial wallet dispersion.',
    falsificationCondition: 'Information velocity remains constant or increases linearly throughout token lifecycle.',
  },
  {
    hypothesisId: 'SELECTIVE-PREDICTION-X',
    description: 'Allowing the system to abstain when confidence is low drastically improves precision on covered trades.',
    mechanism: 'Filtering out ambiguous states concentrates capital into genuinely distinguishable opportunities.',
    falsificationCondition: 'Selective abstention fails to improve net Sharpe or win rate vs forced full coverage.',
  },

  // --- Study Family 3: Runner Distinguishability ---
  {
    hypothesisId: '2X-10X-RUNNER-DISTINGUISHABILITY-X',
    description: 'Point-in-time evidence at first executable 2x crossing can distinguish future 10x runners from collapse candidates.',
    mechanism: 'Capital renewal, inventory absorption, and flow reproduction separate sustainable runners from transient pumps.',
    falsificationCondition: 'Prospective calibrated precision fails to exceed the 2.77% base rate by at least 2.5x lift after costs.',
  },

  // --- Study Family 4: Distribution Shift ---
  {
    hypothesisId: 'POST-MIGRATION-SELECTION-X',
    description: 'Post-migration tokens represent a survivorship-selected population that cannot be pooled with new launches.',
    mechanism: 'Only tokens surviving bonding curve graduation migrate; pooling them biases launch models.',
    falsificationCondition: 'Unconditioned new launches display equivalent survival and runner distributions to post-migration pools.',
  },
  {
    hypothesisId: 'MIGRATION-CAUSAL-EFFECT-X',
    description: 'Migration to AMM pools does not causally create runner momentum; it reflects preexisting survivor traits.',
    mechanism: 'Graduation is an effect of capital accumulation, not an independent generator of future returns.',
    falsificationCondition: 'Exogenous synthetic migration triggers sustained 10x runs in randomly selected tokens.',
  },
  {
    hypothesisId: 'REGIME-TRANSPORTABILITY-X',
    description: 'Models trained on mature AMM pairs suffer catastrophic covariate and concept shift when applied to bonding curves.',
    mechanism: 'Liquidity geometry, fee structures, and participant motivations differ fundamentally between venues.',
    falsificationCondition: 'Unadjusted mature AMM models maintain calibration and profitability on bonding curves.',
  },
  {
    hypothesisId: 'FIXED-REFERENCE-SHIFT-X',
    description: 'Denominating returns in SOL vs USD produces divergent alpha signals during macro SOL volatility.',
    mechanism: 'Token/SOL ratios mask fiat drawdowns or gains caused by underlying L1 currency moves.',
    falsificationCondition: 'SOL-denominated and USD-denominated ranking metrics produce identical trade orderings in all regimes.',
  },
  {
    hypothesisId: 'PROTOCOL-MIGRATION-FREEZE-X',
    description: 'The interval during bonding curve migration creates an unexecutable trading freeze with severe slippage risk.',
    mechanism: 'Raydium pool seeding halts transactions, exposing open inventory to adverse market movement.',
    falsificationCondition: 'Zero execution latency or slippage penalty observed across 100 consecutive migration transitions.',
  },

  // --- Study Family 5: Transition-Path Physics ---
  {
    hypothesisId: 'EXTREME-RUNNER-COMMITTOR-X',
    description: 'Committor function q_up(x) accurately computes probability of reaching 10x before hitting absorbing failure boundaries.',
    mechanism: 'Transition path theory models continuous price dynamics across metastable potential energy surfaces.',
    falsificationCondition: 'Empirical transition frequencies deviate from predicted q_up by >20% out-of-sample.',
  },
  {
    hypothesisId: 'FAILURE-COMMITTOR-X',
    description: 'Backward failure committor q_fail(x) predicts imminent liquidity collapse and freefall before price moves.',
    mechanism: 'Concentration of deployer holdings and decaying order depth signal unrecoverable collapse states.',
    falsificationCondition: 'Tokens with q_fail > 0.65 recover to new ATHs in >10% of prospective trials.',
  },
  {
    hypothesisId: 'TRANSITION-PATH-X',
    description: 'Reactive trajectories from 2x to 10x follow narrow, predictable paths through low-energy resistance saddles.',
    mechanism: 'Successful tokens navigate specific sequences of volume replenishment and holder diversification.',
    falsificationCondition: '10x runners exhibit isotropic, unconstrained diffusion across arbitrary state configurations.',
  },
  {
    hypothesisId: 'REACTIVE-FLUX-X',
    description: 'Net reactive probability flux J_AB quantifies the prospective throughput of tokens entering runner status.',
    mechanism: 'Probability currents reveal whether aggregate market momentum is net-forward or leaking to failure sinks.',
    falsificationCondition: 'Positive net reactive flux correlates negatively or neutrally with runner realization.',
  },
  {
    hypothesisId: 'PATHWAY-BOTTLENECK-X',
    description: 'Specific activation energy barriers (e.g. early insider breakeven zones) create severe transition bottlenecks.',
    mechanism: 'Large clustered sell walls at psychological round numbers choke probability current.',
    falsificationCondition: 'Barrier crossing success rates are uncorrelated with cluster size or order book depth.',
  },
  {
    hypothesisId: 'QUASI-STATIONARY-RUNNER-X',
    description: 'Price plateaus represent metastable quasi-stationary distributions that eventually decay into collapse.',
    mechanism: 'Sideways volatility without organic capital expansion exhausts marginal buyer liquidity.',
    falsificationCondition: 'Prolonged plateaus (>30 mins) lead to runners at equal or higher rates than fast transitions.',
  },
  {
    hypothesisId: 'ACTION-RESIDUAL-X',
    description: 'Onsager-Machlup action functional residuals identify anomalous, manipulated, or unsustainable price trajectories.',
    mechanism: 'Artificial wash trading departs from minimum-action physical paths driven by authentic order flow.',
    falsificationCondition: 'High action-residual trajectories achieve identical out-of-sample holding longevity as authentic paths.',
  },

  // --- Study Family 6: Flow Reproduction ---
  {
    hypothesisId: 'BUY-REPRODUCTION-X',
    description: 'Branching process reproduction number R_buy > 1.0 is a necessary condition for sustained runner expansion.',
    mechanism: 'Each incoming buyer must recruit or induce more than one secondary buyer to overcome natural decay.',
    falsificationCondition: 'Runners reach 10x with R_buy persistently below 0.80.',
  },
  {
    hypothesisId: 'SELL-REPRODUCTION-X',
    description: 'Sell reproduction number R_sell < 1.0 is required to prevent cascading stop-loss liquidations.',
    mechanism: 'When one sale triggers more than one panic sale, freefall collapse is mathematically guaranteed.',
    falsificationCondition: 'Tokens survive and reach 10x when R_sell remains > 1.50 for over 60 seconds.',
  },
  {
    hypothesisId: 'EXOGENOUS-CAPITAL-X',
    description: 'Distinguishing fresh exogenous SOL from recycled or self-funded volume filters out false momentum.',
    mechanism: 'Recycled capital across multiple tokens indicates sybil wash-trading that evaporates under exit pressure.',
    falsificationCondition: 'Tokens driven by >80% recycled or deployer-funded flow sustain runner gains past 24 hours.',
  },
  {
    hypothesisId: 'CAPITAL-GENERATION-DEPTH-X',
    description: 'Generational propagation depth >= 2 is necessary to survive initial sniper profit-taking.',
    mechanism: 'Multi-wave adoption indicates organic distribution beyond initial insider clusters.',
    falsificationCondition: 'Gen-0 and Gen-1 exclusive tokens generate sustained multi-day runners.',
  },
  {
    hypothesisId: 'CAPITAL-SURVIVAL-X',
    description: 'Measuring capital retention half-life identifies extraction siphons before complete pool exhaustion.',
    mechanism: 'Siphons extract >80% of newly arriving capital within 30 seconds of deposit.',
    falsificationCondition: 'Tokens with capital half-life < 15 seconds sustain long-term liquidity and positive returns.',
  },
  {
    hypothesisId: 'INVENTORY-ABSORPTION-X',
    description: 'Quantifying floating insider overhang vs organic pool depth determines maximum safe position sizing.',
    mechanism: 'Unabsorbed insider inventory acts as a latent supply shock that destroys thin liquidity books.',
    falsificationCondition: 'Overhang ratios > 0.75 show zero correlation with post-entry drawdown magnitude.',
  },

  // --- Study Family 7: Liquidation Topology ---
  {
    hypothesisId: 'LIQUIDATION-HYPERGRAPH-X',
    description: 'Multi-venue routing hypergraphs reveal hidden single points of failure in token exit capacity.',
    mechanism: 'Relying solely on primary pool liquidity ignores route breakage and aggregator timeouts.',
    falsificationCondition: 'Primary pool capacity perfectly predicts net realized exit proceeds in 100% of stress tests.',
  },
  {
    hypothesisId: 'EXIT-MIN-CUT-X',
    description: 'Max-flow min-cut network analysis identifies the exact bottleneck limiting safe position liquidation.',
    mechanism: 'The minimal cut across liquidity edges sets the upper bound on executable position size Q_safeExit.',
    falsificationCondition: 'Positions exceeding min-cut capacity exit with less than 50 bps unexpected slippage.',
  },
  {
    hypothesisId: 'LIQUIDITY-REGENERATION-X',
    description: 'Pool liquidity replenishment rate determines whether staged selling achieves higher net recovery.',
    mechanism: 'Slow regeneration means subsequent sales face compounding slippage and reserve depletion.',
    falsificationCondition: 'Pools with zero regeneration replenish depth spontaneously during continuous sell pressure.',
  },
  {
    hypothesisId: 'LIQUIDITY-FATIGUE-X',
    description: 'Sequential partial exits progressively exhaust small AMM reserves non-linearly.',
    mechanism: 'Modeling staged sales with static initial reserves overestimates proceeds due to reserve depletion.',
    falsificationCondition: 'Sequential 25% sales yield identical cumulative proceeds to unadjusted single-block models.',
  },

  // --- Study Family 8: Microstructure Execution ---
  {
    hypothesisId: 'STAGED-LIQUIDATION-X',
    description: 'Staging exits across multiple slots reduces own-impact slippage in moderate-depth pools.',
    mechanism: 'Spreading order flow allows organic micro-inflows to absorb portions of the position.',
    falsificationCondition: 'Staged selling always results in lower net proceeds than instantaneous single-block dumps.',
  },
  {
    hypothesisId: 'OWN-IMPACT-FEEDBACK-X',
    description: 'Trader own-impact feedback loop alters market price and triggers secondary participant reactions.',
    mechanism: 'Large market sell orders trigger trailing stops and automated bot sell algorithms.',
    falsificationCondition: 'Sells exceeding 5% of pool depth produce zero observable impact on subsequent order flow.',
  },
  {
    hypothesisId: 'QUOTE-vs-PROGRAM-SIMULATION-X',
    description: 'Pre-flight program simulation provides more accurate executable bounds than static REST/RPC quotes.',
    mechanism: 'On-chain simulation accounts for accurate reserve states, account locks, and exact fee deductions.',
    falsificationCondition: 'Static quotes match landed transaction amounts with zero discrepancy across volatile blocks.',
  },
  {
    hypothesisId: 'QUOTE-DECAY-X',
    description: 'Executable quotes decay in value exponentially as elapsed slots and intervening trades accumulate.',
    mechanism: 'Adverse selection ensures stale quotes are filled only when the market moves against the trader.',
    falsificationCondition: 'Quotes older than 3 slots execute at quoted mark price without slippage violations.',
  },
  {
    hypothesisId: 'DECISION-TO-LANDING-X',
    description: 'Latency from decision timestamp to on-chain inclusion slot is the primary driver of execution shortfall.',
    mechanism: 'Price discovery in active Solana pairs moves multiple percentage points per slot.',
    falsificationCondition: 'Execution shortfall is completely uncorrelated with decision-to-landing latency.',
  },

  // --- Study Family 9: Landing Physics ---
  {
    hypothesisId: 'LANE-CONDITIONAL-LANDING-X',
    description: 'Transaction landing probability is highly conditioned on submission lane (Jito bundle vs TPU direct).',
    mechanism: 'Jito leader schedules and validator MEV client distribution determine bundle inclusion odds.',
    falsificationCondition: 'All submission lanes exhibit identical landing rates regardless of validator leader or fee.',
  },
  {
    hypothesisId: 'FEE-RESPONSE-SURFACE-X',
    description: 'Priority fee bid curves exhibit diminishing returns and sharp thresholds during network congestion.',
    mechanism: 'Bidding above the 75th percentile priority fee provides marginal landing gain during block saturation.',
    falsificationCondition: 'Landing probability scales linearly with priority fee micro-lamports up to infinity.',
  },
  {
    hypothesisId: 'CU-EFFICIENCY-X',
    description: 'Tight compute unit (CU) limits optimize validator packing probability and lower failure rates.',
    mechanism: 'Validators prioritize transactions with high CU price and minimal requested CU limits.',
    falsificationCondition: 'Requesting maximum 1.4M CU has zero negative impact on inclusion speed vs tight 80k CU limits.',
  },
  {
    hypothesisId: 'ACCOUNT-CONTENTION-X',
    description: 'High write-lock contention on hot pool vaults causes transaction serialization and drops.',
    mechanism: 'Multiple concurrent swaps targeting the same pool cannot execute in parallel in Sealevel runtime.',
    falsificationCondition: 'Transactions targeting saturated pools experience zero lock-wait delays or dropped slots.',
  },

  // --- Study Family 10: Exit Control ---
  {
    hypothesisId: 'RUNNER-HOLD-vs-RECOVERY-X',
    description: 'Dynamic principal recovery outperforms naive buy-and-hold across long-tail launch distributions.',
    mechanism: 'Extracting principal eliminates downside tail risk while preserving upside convexity on free tokens.',
    falsificationCondition: 'Pure unhedged hold strategies achieve higher net portfolio Sharpe and lower ruin probability.',
  },
  {
    hypothesisId: 'DYNAMIC-STOPPING-X',
    description: 'Bellman-style dynamic optimal stopping maximizes realized expectancy over fixed price ladders.',
    mechanism: 'Dynamic stopping adapts to real-time committor shifts, liquidity fatigue, and execution urgency.',
    falsificationCondition: 'A fixed 1.5x / 2.0x exit ladder achieves higher counterfactual P&L across all market regimes.',
  },
  {
    hypothesisId: 'COUNTERFACTUAL-EXIT-TOURNAMENT-X',
    description: 'Shadow execution of competing exit policies establishes empirical superiority without capital risk.',
    mechanism: 'Replaying identical market trajectories through divergent policy logic isolates policy edge.',
    falsificationCondition: 'All competing exit policies produce statistically indistinguishable counterfactual returns.',
  },

  // --- Study Family 11: Search Economics ---
  {
    hypothesisId: 'RUNNER-SEARCH-COST-X',
    description: 'Accumulated search costs and friction from failed attempts must be deducted to evaluate true runner edge.',
    mechanism: 'Evaluating runner profits in isolation ignores the capital burnt finding the 0.397% winners.',
    falsificationCondition: 'Aggregated search costs are negligible (<1% of runner gains) in unselected candidate streams.',
  },
  {
    hypothesisId: 'TAIL-CONCENTRATION-X',
    description: 'Strategy profitability that vanishes when removing the single top trade is fragile and unpromotable.',
    mechanism: 'Single-outlier dependence indicates luck rather than structural executable edge.',
    falsificationCondition: 'A strategy dependent on a single outlier out-of-sample maintains profitability in subsequent years.',
  },

  // --- Study Family 12: Portfolio Survival ---
  {
    hypothesisId: 'PORTFOLIO-RUIN-X',
    description: 'Chronological candidate streams with overlapping positions create severe drawdown and ruin risks.',
    mechanism: 'Correlated market downturns and simultaneous token collapses drain bankroll faster than independent models predict.',
    falsificationCondition: 'Monte Carlo chronological ruin probability is identical to un-ordered IID bootstrap simulations.',
  },

  // --- Study Family 13: Selective Trading ---
  {
    hypothesisId: 'SELECTIVE-PREDICTION-COVERAGE-X',
    description: 'Restricting trading coverage to the top 0.7% of highest-confidence opportunities yields positive net expectancy.',
    mechanism: 'Filtering out ambiguous candidates eliminates search costs and concentrates capital.',
    falsificationCondition: 'High-coverage trading (e.g. 20% of launches) produces higher net risk-adjusted expectancy.',
  },

  // --- Study Family 14: Prospective Law Court ---
  {
    hypothesisId: 'EXECUTABLE-LAW-COURT-X',
    description: 'Prospective evaluation with frozen policy parameters prevents backtest overfitting and search bias.',
    mechanism: 'Locking code hash and thresholds before trial ensures test statistics reflect true prospective performance.',
    falsificationCondition: 'Unfrozen adaptive parameter tuning during trial generalizes better out-of-sample than frozen laws.',
  },
];

export class ResearchMatrixBridge {
  public static registerAllStudies(governor: AutonomousRDGovernorX): number {
    let registered = 0;
    for (const def of ALL_50_EXECUTABLE_ALPHA_STUDIES) {
      const hyp: ResearchHypothesis = createUntestedHypothesis({
        hypothesisId: def.hypothesisId,
        proposerAgentId: 'research-matrix-bridge',
        description: def.description,
        mechanism: def.mechanism,
        falsificationCondition: def.falsificationCondition,
      });

      // Avoid double-registration error
      if (!governor.getHypothesis(def.hypothesisId)) {
        governor.registerHypothesis(hyp);
        registered++;
      }
    }
    return registered;
  }
}
