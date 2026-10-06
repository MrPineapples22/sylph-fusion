/**
 * SYLPH FUSION — CANONICAL RESEARCH POLICY STATE V1
 * Specification: Master Blueprint Section 5 (Research Policy State)
 *
 * Point-in-time state representation containing Market, Flow, Inventory,
 * Authenticity, Information, Reachability, Rare-Event, and Execution dimensions.
 *
 * Invariant: Never fabricate unavailable fields. Use KNOWN / UNKNOWN / STALE / UNOBSERVABLE
 * semantics. Unknown evidence must never automatically become favorable evidence.
 */

export type FieldObservationStatus = 'KNOWN' | 'UNKNOWN' | 'STALE' | 'UNOBSERVABLE';

export interface FieldObservation<T> {
  readonly status: FieldObservationStatus;
  readonly value: T | null;
  readonly observedAtMs: number;
  readonly confidence: number; // 0..1
}

export function createField<T>(value: T | null | undefined, observedAtMs = Date.now(), statusOverride?: FieldObservationStatus): FieldObservation<T> {
  if (statusOverride) {
    return { status: statusOverride, value: value ?? null, observedAtMs, confidence: statusOverride === 'KNOWN' ? 1 : 0 };
  }
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
    return { status: 'UNKNOWN', value: null, observedAtMs, confidence: 0 };
  }
  return { status: 'KNOWN', value, observedAtMs, confidence: 1 };
}

export interface MarketState {
  readonly tokenAgeSeconds: FieldObservation<number>;
  readonly priceSol: FieldObservation<number>;
  readonly priceUsd: FieldObservation<number>;
  readonly priceReturnsBps: FieldObservation<number>;
  readonly priceVelocityBpsPerSec: FieldObservation<number>;
  readonly priceAccelerationBpsPerSec2: FieldObservation<number>;
  readonly marketCapUsd: FieldObservation<number>;
  readonly fdvUsd: FieldObservation<number>;
  readonly realQuoteReservesSol: FieldObservation<number>;
  readonly virtualTokenReserves: FieldObservation<bigint>;
  readonly executableDepthSol: FieldObservation<number>;
  readonly spreadBps: FieldObservation<number>;
  readonly quoteAgeMs: FieldObservation<number>;
  readonly volatilityBps: FieldObservation<number>;
  readonly transactionVelocityPerSec: FieldObservation<number>;
}

export interface FlowState {
  readonly buyCount: FieldObservation<number>;
  readonly sellCount: FieldObservation<number>;
  readonly buySellRatio: FieldObservation<number>;
  readonly economicBuyVolumeSol: FieldObservation<number>;
  readonly economicSellVolumeSol: FieldObservation<number>;
  readonly independentBuyers: FieldObservation<number>;
  readonly independentSellers: FieldObservation<number>;
  readonly buyerArrivalRatePerSec: FieldObservation<number>;
  readonly sellerArrivalRatePerSec: FieldObservation<number>;
  readonly capitalRenewalRateSolPerSec: FieldObservation<number>;
}

export interface InventoryState {
  readonly top10HolderConcentrationPct: FieldObservation<number>;
  readonly creatorHoldingPct: FieldObservation<number>;
  readonly costBasisDistributionEntropy: FieldObservation<number>;
  readonly embeddedProfitInventorySol: FieldObservation<number>;
  readonly sellLiabilitySol: FieldObservation<number>;
  readonly inventoryActivationSurfaceBps: FieldObservation<number>;
  readonly inventoryDephasingScore: FieldObservation<number>;
  readonly costBasisResetQualityScore: FieldObservation<number>;
  readonly whaleLiquidationExposureSol: FieldObservation<number>;
}

export interface AuthenticityState {
  readonly independentActorRatio: FieldObservation<number>;
  readonly economicVolumeRatio: FieldObservation<number>;
  readonly fundingDiversityScore: FieldObservation<number>;
  readonly washTradingProbability: FieldObservation<number>;
  readonly bundlerCoordinatorProbability: FieldObservation<number>;
  readonly manipulationSymptomsDetected: FieldObservation<boolean>;
  readonly liquidityPersistenceScore: FieldObservation<number>;
  readonly temporalPersistenceScore: FieldObservation<number>;
}

export interface InformationState {
  readonly informationSufficiency: FieldObservation<boolean>;
  readonly mutualInformationScore: FieldObservation<number>;
  readonly informationVelocityPerSec: FieldObservation<number>;
  readonly informationAccelerationPerSec2: FieldObservation<number>;
  readonly calibrationConfidence: FieldObservation<number>;
  readonly effectiveSampleSize: FieldObservation<number>;
  readonly domainShiftScore: FieldObservation<number>;
  readonly structuralInformationGain: FieldObservation<number>;
}

export interface ReachabilityState {
  readonly nominalExtremeReturnProb: FieldObservation<number>;
  readonly economicReachabilityProb: FieldObservation<number>;
  readonly capturableProbability: FieldObservation<number>;
  readonly viabilityMarginBps: FieldObservation<number>;
  readonly minimumConstraintSlack: FieldObservation<number>;
  readonly safeHorizonSeconds: FieldObservation<number>;
  readonly capitalDeficitSol: FieldObservation<number>;
  readonly rescueDistance: FieldObservation<number>;
  readonly exitReachabilityProb: FieldObservation<number>;
}

export interface RareEventState {
  readonly q2x: FieldObservation<number>;
  readonly q5x: FieldObservation<number>;
  readonly q10x: FieldObservation<number>;
  readonly q20x: FieldObservation<number>;
  readonly q100x: FieldObservation<number>;
  readonly failureCommittor: FieldObservation<number>;
  readonly pathwayClass: FieldObservation<string>;
  readonly pathwayEntropy: FieldObservation<number>;
  readonly distanceToExtremeManifold: FieldObservation<number>;
  readonly pathVelocity: FieldObservation<number>;
  readonly barrierCompressionScore: FieldObservation<number>;
  readonly criticalityGap: FieldObservation<number>;
}

export interface ExecutionState {
  readonly expectedDexFeeBps: FieldObservation<number>;
  readonly expectedPriceImpactBps: FieldObservation<number>;
  readonly expectedSlippageBps: FieldObservation<number>;
  readonly expectedLandingCostLamports: FieldObservation<bigint>;
  readonly expectedFailureCostLamports: FieldObservation<bigint>;
  readonly routeCapacitySol: FieldObservation<number>;
  readonly executablePositionSizeSol: FieldObservation<number>;
  readonly exitCapacitySol: FieldObservation<number>;
  readonly stressedExitCapacitySol: FieldObservation<number>;
}

export interface ResearchPolicyStateV1 {
  readonly snapshotId: string;
  readonly mint: string;
  readonly capturedAtSlot: bigint;
  readonly capturedAtMs: number;
  readonly venue: 'PUMP_FUN_BONDING_CURVE' | 'PUMPSWAP' | 'RAYDIUM_CPMM' | 'RAYDIUM_CLMM' | 'METEORA_DLMM' | 'UNKNOWN';
  readonly market: MarketState;
  readonly flow: FlowState;
  readonly inventory: InventoryState;
  readonly authenticity: AuthenticityState;
  readonly information: InformationState;
  readonly reachability: ReachabilityState;
  readonly rareEvent: RareEventState;
  readonly execution: ExecutionState;
}
