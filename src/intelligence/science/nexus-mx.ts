/**
 * SYLPH FUSION — MULTIPLIER-X GEN-2
 * Module: src/intelligence/science/nexus-mx.ts
 *
 * Implements the NEXUS-MX Connecting Spine and Core Multiplier-X Gen-2 Contracts:
 * - Invariants 1.1–1.8 (Price != Capital, Wallet != Entity, Volume != Demand, etc.)
 * - Lineage-bound NexusLineage tracking across every lifecycle stage
 * - JournalEnvelope & OutcomeObservationCertificate (Observation Integrity)
 * - TokenEpisode canonical lifecycle entity
 * - ManipulationVector & LiquidityReality contracts
 * - Multiplier-X Gen-2 Barrier Probability Surfaces & Competing-Risk Engine
 * - Capturability-X latency & slippage discounting
 * - Realized-EV Engine & SPIE Output Contracts
 * - MultiplierCertificate & Verification Authority
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// 1. NEXUS-MX Universal Lineage Spine (Section 3)
// ---------------------------------------------------------------------------

export interface NexusLineage {
  readonly tokenEpisodeId: string;
  readonly eventJournalOffset: number;
  readonly canonicalSnapshotId: string;
  readonly featureSnapshotId: string;
  readonly modelGeneration: string;
  readonly configurationEpoch: number;
  readonly riskEpoch: number;
  readonly executionGeneration: number;
  readonly certificateId?: string;
  readonly decisionId?: string;
  readonly executionPermitId?: string;
  readonly orderAttemptId?: string;
  readonly settlementId?: string;
}

export function computeLineageDigest(lineage: NexusLineage): string {
  const serialized = JSON.stringify(lineage, Object.keys(lineage).sort());
  return createHash('sha256').update(serialized).digest('hex');
}

// ---------------------------------------------------------------------------
// 2. Event Journal Envelope (Section 4)
// ---------------------------------------------------------------------------

export interface JournalEnvelope {
  readonly journalId: string;
  readonly source: string;
  readonly receivedAt: number;
  readonly sourceTimestamp?: number;
  readonly slot?: number;
  readonly signature?: string;
  readonly mint?: string;
  readonly pool?: string;
  readonly wallet?: string;
  readonly schemaVersion: string;
  readonly payloadHash: string;
  readonly payload: unknown;
}

export function createJournalEnvelope(
  source: string,
  schemaVersion: string,
  payload: unknown,
  meta?: Partial<Omit<JournalEnvelope, 'journalId' | 'source' | 'schemaVersion' | 'payload' | 'payloadHash' | 'receivedAt'>>
): JournalEnvelope {
  const receivedAt = Date.now();
  const serialized = JSON.stringify(payload);
  const payloadHash = createHash('sha256').update(serialized).digest('hex');
  const journalId = `jnl_${receivedAt}_${payloadHash.slice(0, 12)}`;
  return {
    journalId,
    source,
    receivedAt,
    schemaVersion,
    payloadHash,
    payload,
    ...meta,
  };
}

// ---------------------------------------------------------------------------
// 3. Observation Integrity & Outcome Ascertainment (Section 6)
// ---------------------------------------------------------------------------

export type OutcomeObservationStatus =
  | 'FULLY_OBSERVED'
  | 'PARTIALLY_OBSERVED'
  | 'RIGHT_CENSORED'
  | 'LOST_TO_FOLLOWUP'
  | 'DATA_GAP'
  | 'SOURCE_CONFLICT'
  | 'TERMINAL_STATE_CONFIRMED';

export interface OutcomeObservationCertificate {
  readonly tokenEpisodeId: string;
  readonly firstObservedAt: number;
  readonly lastObservedAt: number;
  readonly firstObservedSlot: number;
  readonly lastObservedSlot: number;
  readonly observationStatus: OutcomeObservationStatus;
  readonly sourceCoverage: readonly string[];
  readonly gapDurationMs: number;
  readonly graduationVerified: boolean;
  readonly collapseVerified: boolean;
  readonly terminalEvidence?: readonly string[];
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// 4. Token Episode (Section 7)
// ---------------------------------------------------------------------------

export type LifecycleStage =
  | 'DISCOVERED'
  | 'EARLY_CURVE'
  | 'CURVE_EXPANSION'
  | 'CURVE_ACCELERATION'
  | 'NEAR_MIGRATION'
  | 'MIGRATING'
  | 'POST_MIGRATION'
  | 'EXPANSION'
  | 'MATURE'
  | 'DISTRESSED'
  | 'COLLAPSING'
  | 'DEAD';

export interface TokenEpisode {
  readonly id: string;
  readonly mint: string;
  readonly createdAt: number;
  readonly createdSlot: number;
  readonly discoveredAt: number;
  readonly creator: string;
  readonly currentStage: LifecycleStage;
  readonly observationCertificate: OutcomeObservationCertificate;
}

// ---------------------------------------------------------------------------
// 5. Capital Flow & Origin Graph (Sections 8-10)
// ---------------------------------------------------------------------------

export interface CapitalFlowMetrics {
  readonly grossBuySol: number;
  readonly grossSellSol: number;
  readonly organicBuySol: number;
  readonly organicSellSol: number;
  readonly organicNetSol: number;
  readonly newCapitalSol: number;
  readonly recycledCapitalSol: number;
  readonly freshCapitalRatio: number;      // Fresh / Total Inflow
  readonly creatorFundedRatio: number;     // Creator-associated / Total
  readonly capitalVelocity: number;        // Net Organic SOL / sec
  readonly capitalAcceleration: number;    // d(Velocity) / dt
  readonly capitalPersistence: number;     // Ratio of retained capital after pullbacks [0, 1]
}

export function computeCapitalBackedMultiplier(
  entryPriceSol: number,
  organicNetSolInflow: number,
  poolReservesSol: number,
  observedPriceSol?: number
): {
  displayedPriceMultiple: number;
  capitalBackedMultiple: number;
} {
  if (entryPriceSol <= 0 || poolReservesSol <= 0) {
    return { displayedPriceMultiple: 1.0, capitalBackedMultiple: 1.0 };
  }
  const reserveRatio = Math.max(0, (poolReservesSol + organicNetSolInflow) / poolReservesSol);
  const capitalBackedMultiple = Math.max(0.1, reserveRatio * reserveRatio);
  return {
    displayedPriceMultiple: (observedPriceSol !== undefined && observedPriceSol > 0) ? (observedPriceSol / entryPriceSol) : (reserveRatio * reserveRatio),
    capitalBackedMultiple,
  };
}

// ---------------------------------------------------------------------------
// 6. Manipulation Firewall & Unified Vector (Sections 14-20)
// ---------------------------------------------------------------------------

export interface ManipulationVector {
  readonly washProbability: number;
  readonly atomicSelfCancelProbability: number;
  readonly bundlerProbability: number;
  readonly txPaddingProbability: number;
  readonly lpiProbability: number;              // Liquidity Pool Price Inflation
  readonly coordinatedDumpProbability: number;
  readonly creatorSybilProbability: number;
  readonly fundingClusterProbability: number;
  readonly volumeAuthenticity: number;          // 1.0 - washShare [0, 1]
  readonly participationAuthenticity: number;   // Independent / Total Wallets [0, 1]
  readonly manipulationConfidence: number;      // Data quality [0, 1]
}

export class ManipulationFirewall {
  /**
   * Evaluates Liquidity Pool Price Inflation (LPI-X):
   * CapitalEfficiencyOfMove = log(P_t / P_0) / max(NetOrganicQuoteInflow, epsilon)
   */
  public static evaluateLpiHazard(
    priceRatio: number,
    netOrganicSolInflow: number,
    observedGrossSolVolume: number
  ): { lpiHazard: number; mechanicalPriceMove: boolean } {
    if (priceRatio <= 1.0) return { lpiHazard: 0, mechanicalPriceMove: false };
    const logMove = Math.log(priceRatio);
    const organicInflow = Math.max(0.01, netOrganicSolInflow);
    const efficiency = logMove / organicInflow;

    const lpiHazard = Math.min(1.0, Math.max(0, (efficiency - 0.5) / 2.0));
    const mechanicalPriceMove = lpiHazard > 0.65 || (priceRatio > 1.5 && observedGrossSolVolume < 1.0);
    return { lpiHazard, mechanicalPriceMove };
  }
}

// ---------------------------------------------------------------------------
// 7. Liquidity Reality & Realizable Exit Curves (Sections 21-22)
// ---------------------------------------------------------------------------

export interface RealizableExitCurve {
  readonly displayedMultiple: number;
  readonly realizableMultipleAt100Usd: number;
  readonly realizableMultipleAt500Usd: number;
  readonly realizableMultipleAt1000Usd: number;
  readonly realizableMultipleAt5000Usd: number;
  readonly exitabilityScore: number;           // [0, 1]
  readonly routeRedundancyCount: number;
  readonly liquidityDecayPct: number;
}

export class LiquidityRealityEngine {
  /**
   * Computes realizable return after constant-product price impact across position sizes
   */
  public static computeRealizableExitCurve(
    displayedMultiple: number,
    poolLiquidityUsd: number,
    routeRedundancyCount: number = 1
  ): RealizableExitCurve {
    const calculateRealizable = (notionalUsd: number): number => {
      if (poolLiquidityUsd <= 0 || displayedMultiple <= 0) return 0;
      const reserveUsd = Math.max(10, poolLiquidityUsd / 2);
      const impact = Math.min(0.95, notionalUsd / reserveUsd);
      return Math.max(0, displayedMultiple * (1.0 - impact));
    };

    const rm100 = calculateRealizable(100);
    const rm500 = calculateRealizable(500);
    const rm1000 = calculateRealizable(1000);
    const rm5000 = calculateRealizable(5000);

    const exitabilityScore = Math.min(1.0, Math.max(0,
      (poolLiquidityUsd / 20_000) * (routeRedundancyCount > 1 ? 1.2 : 1.0)
    ));

    return {
      displayedMultiple,
      realizableMultipleAt100Usd: Number(rm100.toFixed(2)),
      realizableMultipleAt500Usd: Number(rm500.toFixed(2)),
      realizableMultipleAt1000Usd: Number(rm1000.toFixed(2)),
      realizableMultipleAt5000Usd: Number(rm5000.toFixed(2)),
      exitabilityScore: Number(exitabilityScore.toFixed(3)),
      routeRedundancyCount,
      liquidityDecayPct: 0.0,
    };
  }
}

// ---------------------------------------------------------------------------
// 8. Multiplier-X Probability Surface & Competing Risks (Sections 29-36)
// ---------------------------------------------------------------------------

export interface MultiplierBarrierPredictions {
  readonly p2x: number;
  readonly p3x: number;
  readonly p5x: number;
  readonly p10x: number;
  readonly p20x: number;
  readonly p50x: number;
  readonly p100x: number;
  readonly expectedTimeToTouchSec: {
    readonly touch2x: number;
    readonly touch5x: number;
    readonly touch10x: number;
  };
}

export interface CompetingRiskHazards {
  readonly collapseHazardRate: number;      // Drawdown > 40%
  readonly rugHazardRate: number;           // Dev / insider dump
  readonly liquidityDrainHazardRate: number;// Pool withdrawal
  readonly manipulationHazardRate: number;  // Fake pump-and-dump
  readonly migrationStallHazardRate: number;// Curve abandoned
  readonly compositeFailureHazard: number;  // 1 - prod(1 - h_i)
}

export interface UncertaintyDecomposition {
  readonly epistemicUncertainty: number;    // Model parameter variance [0, 1]
  readonly aleatoricUncertainty: number;    // Inherent market noise [0, 1]
  readonly dataQualityUncertainty: number;  // Missingness/staleness [0, 1]
  readonly totalUncertaintyMargin: number;  // ± Margin
}

// ---------------------------------------------------------------------------
// 9. Capturability-X & Realized EV Engine (Sections 37-40)
// ---------------------------------------------------------------------------

export interface CapturabilityAssessment {
  readonly totalLatencyBudgetMs: number;
  readonly expectedSlippageBps: number;
  readonly expectedPriceImpactBps: number;
  readonly jitoTipEfficiency: number;
  readonly pFill: number;
  readonly pExit: number;
  readonly capturableUpsideRatio: number;   // Realizable / Displayed [0, 1]
}

export interface RealizedEVAssessment {
  readonly expectedValueSolPerSol: number;  // Net EV per 1 SOL risk capital
  readonly winProbability: number;
  readonly expectedProfitRatio: number;
  readonly expectedLossRatio: number;
  readonly tailRiskAdjustment: number;
  readonly isViable: boolean;
}

export class RealizedEVEngine {
  /**
   * Computes expected net PnL accounting for competing risks and execution friction:
   * EV = sum(P_i * Return_i) - Costs - TailRiskAdjustment
   */
  public static calculateEV(
    multipliers: MultiplierBarrierPredictions,
    risks: CompetingRiskHazards,
    capturability: CapturabilityAssessment,
    roundtripCostBps: number = 300 // Base fee + Jito + Priority + DEX fee
  ): RealizedEVAssessment {
    const costRatio = roundtripCostBps / 10_000;
    const pSuccess = multipliers.p2x * (1.0 - risks.compositeFailureHazard);
    const pFailure = risks.compositeFailureHazard;

    const capturableGain = (2.0 * capturability.capturableUpsideRatio) - 1.0;
    const expectedProfit = Math.max(0, pSuccess * capturableGain);
    const expectedLoss = pFailure * 0.15; // Typical 15% structural stop
    const tailAdjustment = risks.rugHazardRate * 0.5;

    const netEV = expectedProfit - expectedLoss - costRatio - tailAdjustment;

    return {
      expectedValueSolPerSol: Number(netEV.toFixed(4)),
      winProbability: Number(pSuccess.toFixed(3)),
      expectedProfitRatio: Number(expectedProfit.toFixed(3)),
      expectedLossRatio: Number(expectedLoss.toFixed(3)),
      tailRiskAdjustment: Number(tailAdjustment.toFixed(4)),
      isViable: netEV > 0.05 && capturability.pFill >= 0.85 && capturability.pExit >= 0.85,
    };
  }
}

// ---------------------------------------------------------------------------
// 10. SPIE Gen-2 & Multiplier Certificate (Sections 41-44)
// ---------------------------------------------------------------------------

export interface SPIEGen2Output {
  readonly evidenceQuality: number;
  readonly capitalBackedMomentum: number;
  readonly executableLiquidity: number;
  readonly entityAdjustedParticipation: number;
  readonly controllerAdjustedWalletQuality: number;
  readonly competingFailureHazard: number;
  readonly realizableExecutionQuality: number;
  readonly marketRegimeScore: number;
  readonly compositeScore: number;
}

export interface MultiplierCertificate {
  readonly certificateId: string;
  readonly lineage: NexusLineage;
  readonly mint: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly capitalFlow: CapitalFlowMetrics;
  readonly manipulation: ManipulationVector;
  readonly exitCurve: RealizableExitCurve;
  readonly multipliers: MultiplierBarrierPredictions;
  readonly competingRisks: CompetingRiskHazards;
  readonly uncertainty: UncertaintyDecomposition;
  readonly capturability: CapturabilityAssessment;
  readonly realizedEV: RealizedEVAssessment;
  readonly spie: SPIEGen2Output;
  readonly decision: 'ENTER_ELIGIBLE' | 'WAIT_CONFIRMATION' | 'VETO_HARD' | 'VETO_STATISTICAL';
  readonly primaryEvidence: readonly string[];
  readonly riskFactors: readonly string[];
  readonly invalidationConditions: readonly string[];
  readonly certificateHash: string;
}

export class MultiplierCertificateAuthority {
  public static issueCertificate(
    lineage: NexusLineage,
    mint: string,
    capitalFlow: CapitalFlowMetrics,
    manipulation: ManipulationVector,
    exitCurve: RealizableExitCurve,
    multipliers: MultiplierBarrierPredictions,
    competingRisks: CompetingRiskHazards,
    uncertainty: UncertaintyDecomposition,
    capturability: CapturabilityAssessment,
    spie: SPIEGen2Output,
    validDurationMs: number = 5000
  ): MultiplierCertificate {
    const now = Date.now();
    const ev = RealizedEVEngine.calculateEV(multipliers, competingRisks, capturability);

    let decision: MultiplierCertificate['decision'] = 'WAIT_CONFIRMATION';
    const primaryEvidence: string[] = [];
    const riskFactors: string[] = [];
    const invalidationConditions: string[] = [
      'PRICE_DROP_EXCEEDING_STOP_15PCT',
      'CONTROLLER_DUMP_EXCEEDING_5PCT_SUPPLY',
      'LIQUIDITY_DRAIN_EVENT',
      'EXCESSIVE_LATENCY_SKEW_OVER_1000MS',
    ];

    if (manipulation.lpiProbability > 0.70 || manipulation.coordinatedDumpProbability > 0.60) {
      decision = 'VETO_HARD';
      riskFactors.push('CRITICAL_MANIPULATION_HAZARD');
    } else if (exitCurve.exitabilityScore < 0.20) {
      decision = 'VETO_HARD';
      riskFactors.push('INSUFFICIENT_EXITABILITY_DEPTH');
    } else if (ev.isViable && spie.compositeScore >= 70 && uncertainty.totalUncertaintyMargin <= 0.25) {
      decision = 'ENTER_ELIGIBLE';
      primaryEvidence.push(`ORGANIC_NET_INFLOW_${capitalFlow.organicNetSol.toFixed(1)}_SOL`);
      primaryEvidence.push(`REALIZED_EV_+${ev.expectedValueSolPerSol}_SOL_PER_SOL`);
      primaryEvidence.push(`P_2X_${(multipliers.p2x * 100).toFixed(0)}%`);
    } else {
      decision = 'VETO_STATISTICAL';
      riskFactors.push('SUB_THRESHOLD_NET_EV_OR_SPIE');
    }

    const payloadToHash = {
      lineage,
      mint,
      now,
      decision,
      multipliers,
      competingRisks,
      ev,
    };
    const certificateHash = createHash('sha256').update(JSON.stringify(payloadToHash)).digest('hex');
    const certificateId = `cert_mx2_${now}_${certificateHash.slice(0, 16)}`;

    return {
      certificateId,
      lineage: { ...lineage, certificateId },
      mint,
      issuedAtMs: now,
      expiresAtMs: now + validDurationMs,
      capitalFlow,
      manipulation,
      exitCurve,
      multipliers,
      competingRisks,
      uncertainty,
      capturability,
      realizedEV: ev,
      spie,
      decision,
      primaryEvidence,
      riskFactors,
      invalidationConditions,
      certificateHash,
    };
  }
}
