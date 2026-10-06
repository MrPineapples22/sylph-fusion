/**
 * SYLPH FUSION — EXECUTABLE ALPHA & EXTREME RUNNER TYPES
 * Specifications: Sections I, IV, V, VI, VII, VIII, X, XI, XV, XVII, XIX, XXI, XXIII, XXXI, XLI, XLII, XLIII
 *
 * Invariant: HistoricalPeak != PredictiveEdge != ExecutableOpportunity != RealizedProfit
 * Target: ExpectedExecutableNetEdge
 */

import { createHash } from 'node:crypto';

// --- CANONICAL EVENT VOCABULARY (Section VIII) ---
export type ExecutableAlphaEventType =
  | 'MARKET_OBSERVATION'
  | 'EXECUTABLE_QUOTE'
  | 'QUOTE_EXPIRED'
  | 'SENSOR_ARRIVAL'
  | 'SENSOR_DIVERGENCE'
  | 'OBSERVATION_GAP'
  | 'MISSING_EXIT'
  | 'OUTCOME_CENSORED';

// --- MULTI-HORIZON OUTCOME & EXECUTABILITY LABELS (Sections XLII & XLIII) ---
export type OutcomeLabel =
  | 'REACHED_1_25X'
  | 'REACHED_1_5X'
  | 'REACHED_2X'
  | 'REACHED_3X'
  | 'REACHED_5X'
  | 'REACHED_10X'
  | 'REACHED_20X'
  | 'REACHED_100X'
  | 'COLLAPSED_25'
  | 'COLLAPSED_50'
  | 'COLLAPSED_80'
  | 'COLLAPSED_90'
  | 'EXIT_REACHABLE'
  | 'EXIT_UNREACHABLE'
  | 'ENTRY_LANDED'
  | 'ENTRY_NOLAND'
  | 'EXIT_LANDED'
  | 'EXIT_NOLAND'
  | 'MISSING_OUTCOME'
  | 'CENSORED_OUTCOME'
  | 'PROFITABLE_AFTER_COST'
  | 'UNPROFITABLE_AFTER_COST'
  | 'EXECUTABLE_2X'
  | 'EXECUTABLE_5X'
  | 'EXECUTABLE_10X'
  | 'OBSERVED_2X'
  | 'OBSERVED_5X'
  | 'OBSERVED_10X';

// --- POINT-IN-TIME RESEARCH STATE (Section VII) ---
export interface PriceEvidence {
  readonly priceSol: number;
  readonly priceUsd: number;
  readonly slot: bigint;
  readonly timestampMs: number;
  readonly source: string;
}

export interface LiquidityEvidence {
  readonly poolSolReservesLamports: bigint;
  readonly poolTokenReserves: bigint;
  readonly poolLiquidityUsd: number;
  readonly virtualSolReservesLamports?: bigint;
  readonly virtualTokenReserves?: bigint;
}

export interface MarketAuthenticityReport {
  readonly independentActorRatio: number;
  readonly economicVolumeRatio: number;
  readonly fundingDiversity: number;
  readonly liquidityPersistence: number;
  readonly temporalPersistence: number;
  readonly manipulationSymptoms: readonly string[];
  readonly isAuthentic: boolean;
}

export interface PhaseTransitionReport {
  readonly actorGrowthRate: number;
  readonly freshCapitalRate: number;
  readonly economicVolumeRate: number;
  readonly liquidityDepthRate: number;
  readonly exitCapacityRate: number;
  readonly concentrationRatio: number;
  readonly sellPressureRatio: number;
  readonly dtfScore: number;
  readonly phase: 'SUB_CRITICAL' | 'CRITICAL' | 'SUPER_CRITICAL' | 'FRACTURED';
}

export interface InformationState {
  readonly mutualInformationNats: number;
  readonly informationVelocity: number;
  readonly earliestDecisionTimeSeconds: number;
  readonly bayesErrorBound: number;
  readonly sensorTier: number;
  readonly isSufficient: boolean;
}

export interface ReachabilityState {
  readonly reachabilityRatio: number;
  readonly viabilitySlack: number;
  readonly distanceToLiquidationBoundary: number;
  readonly maxReachableMultiple: number;
  readonly backwardReachableExitProb: number;
  readonly isOneWayRunner: boolean;
}

export interface ExecutableQuoteSet {
  readonly buyQuoteUsd: number;
  readonly buyImpactBps: number;
  readonly maxBuyCapacityUsd: number;
  readonly sellQuotes: Readonly<Record<number, { readonly exitPriceUsd: number; readonly impactBps: number; readonly proceedsUsd: number }>>;
  readonly quoteValidUntilSlot: bigint;
  readonly quoteHash: string;
}

/**
 * Section VII: PointInTimeResearchState snapshot.
 * Critical invariant: Everything in this state existed at or before observedAtMs / observationSlot.
 * Zero future leakage allowed!
 */
export interface PointInTimeResearchState {
  readonly mint: string;
  readonly poolAddress: string;
  readonly observedAtMs: number;
  readonly observationSlot: bigint;
  readonly evidenceRoot: string;
  readonly stateRoot: string;
  readonly tokenAgeMs: number;
  readonly price: PriceEvidence;
  readonly liquidity: LiquidityEvidence;
  readonly authenticity: MarketAuthenticityReport;
  readonly phaseTransition: PhaseTransitionReport;
  readonly walletGraphRef?: string;
  readonly capitalGraphRef?: string;
  readonly inventoryGraphRef?: string;
  readonly informationState: InformationState;
  readonly reachabilityState: ReachabilityState;
  readonly executableQuotes: ExecutableQuoteSet;
  readonly knowledgeCutRoot: string;
}

// --- OBSERVATION QUALITY CERTIFICATE (Section VIII) ---
export interface ObservationQualityCertificate {
  readonly observationCoverage: number;
  readonly slotLag: number;
  readonly wallAgeMs: number;
  readonly interveningTrades: number;
  readonly missingnessRisk: number;
  readonly censoringRisk: number;
  readonly sourceAgreement: number;
  readonly sufficient: boolean;
  readonly blockers: readonly string[];
  readonly certificateDigest: string;
}

// --- 2X -> 10X RUNNER DISTINGUISHABILITY CERTIFICATE (Section X) ---
export interface RunnerDistinguishabilityCertificate {
  readonly baselineRunnerProbability: number; // Historical base rate ~2.77%
  readonly calibratedRunnerProbability: number;
  readonly failureProbability: number;
  readonly liftVsBaseRate: number;
  readonly calibrationError: number;
  readonly uncertaintyLow: number;
  readonly uncertaintyHigh: number;
  readonly eligibleForRunnerTreatment: boolean;
  readonly certificateDigest: string;
}

// --- DISTRIBUTION VALIDITY CERTIFICATE (Section XI) ---
export interface DistributionValidityCertificate {
  readonly sourceRegime: string;
  readonly targetRegime: string;
  readonly covariateShift: number;
  readonly conceptShift: number;
  readonly calibrationShift: number;
  readonly transportable: boolean;
  readonly blockers: readonly string[];
  readonly certificateDigest: string;
}

// --- LIQUIDATION SURFACE (Section XV) ---
export interface LiquidationPoint {
  readonly percentage: number; // 10, 25, 50, 75, 100
  readonly tokensSold: number;
  readonly netProceedsUsd: number;
  readonly effectivePriceUsd: number;
  readonly impactBps: number;
  readonly feeUsd: number;
}

export interface LiquidationCurve {
  readonly scenarioName: string;
  readonly points: readonly LiquidationPoint[];
  readonly maxCapacityUsd: number;
}

export interface LiquidationSurface {
  readonly currentMarkUsd: number;
  readonly base: LiquidationCurve;
  readonly stressed25: LiquidationCurve;
  readonly stressed50: LiquidationCurve;
  readonly stressedExitCapacityUsd: number;
  readonly liquidityHaircutUsd: number;
  readonly ownImpactUsd: number;
  readonly projectedFeesUsd: number;
  readonly computedAtMs: number;
  readonly slot: bigint;
  readonly surfaceDigest: string;
}

// --- EXECUTION LATENCY & LANE (Sections XVII & XIX) ---
export interface ExecutionLatencyTrace {
  readonly observationAt: number;
  readonly featuresReadyAt: number;
  readonly decisionAt: number;
  readonly permitIssuedAt: number;
  readonly buildCompletedAt: number;
  readonly signedAt: number;
  readonly submittedAt: number;
  readonly firstProviderAckAt?: number;
  readonly landedAt?: number;
  readonly terminalAt?: number;
}

export interface ExecutionLaneScorecard {
  readonly laneId: string;
  readonly resolvedAttempts: number;
  readonly landingRate: number;
  readonly sameSlotRate: number;
  readonly nextSlotRate: number;
  readonly p50LandingMs: number;
  readonly p95LandingMs: number;
  readonly p99LandingMs: number;
  readonly averageFeeUsd: number;
  readonly averageTipUsd: number;
  readonly averageImplementationShortfallUsd: number;
  readonly failureRate: number;
  readonly eligibleForOptimization: boolean;
}

// --- RUNNER HOLD & EXIT TYPES (Sections XXI, XXIII, XXXVI, XXXVII) ---
export type RunnerState =
  | 'PROTECTED'
  | 'RUNNER_CANDIDATE'
  | 'EXTREME_RUNNER'
  | 'PRINCIPAL_RECOVERED'
  | 'DISTRIBUTION'
  | 'FAILURE_REGIME'
  | 'EMERGENCY_EXIT'
  | 'CLOSED';

export interface RunnerHoldCertificate {
  readonly positionId: string;
  readonly mint: string;
  readonly runnerState: RunnerState;
  readonly informationSufficient: boolean;
  readonly calibratedRunnerProb: number;
  readonly liftVsBaseRate: number;
  readonly failureCommittor: number;
  readonly capitalRenewalScore: number;
  readonly inventoryLiabilityAcceptable: boolean;
  readonly exitReachabilityPositive: boolean;
  readonly liquidityStressAcceptable: boolean;
  readonly authenticityStillValid: boolean;
  readonly holdAuthorized: boolean;
  readonly validUntilSlot: bigint;
  readonly certificateDigest: string;
}

export type ExitActionType =
  | 'HOLD'
  | 'PARTIAL_REDUCE'
  | 'RECOVER_PRINCIPAL'
  | 'FULL_LIQUIDATION'
  | 'EMERGENCY_DUMP';

export interface ExitProposal {
  readonly policyId: string;
  readonly action: ExitActionType;
  readonly targetFraction: number; // 0.0 to 1.0
  readonly expectedProceedsUsd: number;
  readonly expectedImpactBps: number;
  readonly urgency: 'LOW' | 'NORMAL' | 'HIGH' | 'EMERGENCY';
  readonly rationale: string;
}

export interface ExitAttemptRecord {
  readonly attemptId: string;
  readonly positionId: string;
  readonly mint: string;
  readonly evidenceRoot: string;
  readonly stateRoot: string;
  readonly authoritativePolicyId: string;
  readonly authoritativeAction: ExitProposal;
  readonly shadowActions: readonly ExitProposal[];
  readonly executablePositionValueUsd: number;
  readonly stressedExitCapacityUsd: number;
  readonly decisionAt: number;
  readonly slot: bigint;
  readonly runnerState: RunnerState;
  readonly previousRecordHash?: string;
  readonly recordHash: string;
}

// --- EXECUTABLE ALPHA CERTIFICATE (Section XXXI) ---
export interface ExecutableAlphaCertificate {
  readonly certificateId: string;
  readonly mint: string;
  readonly poolAddress: string;
  readonly stateRoot: string;
  readonly evidenceRoot: string;
  readonly observationQualityRoot: string;
  readonly informationCertificateRoot: string;
  readonly distributionCertificateRoot: string;
  readonly authenticityRoot: string;
  readonly runnerProbability: number;
  readonly failureProbability: number;
  readonly reachability: number;
  readonly viability: number;
  readonly desiredStakeUsd: number;
  readonly entryCapacityUsd: number;
  readonly stressedExitCapacityUsd: number;
  readonly expectedGrossEdgeUsd: number;
  readonly expectedFeesUsd: number;
  readonly expectedImpactUsd: number;
  readonly expectedLandingCostUsd: number;
  readonly expectedNetEdgeUsd: number;
  readonly uncertaintyLowUsd: number;
  readonly uncertaintyHighUsd: number;
  readonly decision: 'ENTER' | 'ABSTAIN' | 'REJECT';
  readonly blockers: readonly string[];
  readonly policyVersion: string;
  readonly releaseRoot: string;
  readonly certificateDigest: string;
}

export function computeCertificateDigest(cert: Omit<ExecutableAlphaCertificate, 'certificateDigest'>): string {
  const payload = [
    cert.certificateId,
    cert.mint,
    cert.poolAddress,
    cert.stateRoot,
    cert.evidenceRoot,
    cert.observationQualityRoot,
    cert.informationCertificateRoot,
    cert.distributionCertificateRoot,
    cert.authenticityRoot,
    cert.runnerProbability.toFixed(4),
    cert.failureProbability.toFixed(4),
    cert.decision,
    cert.expectedNetEdgeUsd.toFixed(4),
    cert.blockers.join(','),
  ].join('::');
  return createHash('sha256').update(payload).digest('hex');
}
