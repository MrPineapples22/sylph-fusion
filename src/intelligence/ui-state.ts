/**
 * SOL-SYLPH Intelligence Fabric - Canonical UI State Contract
 * Specifications: Sections LXIV - LXXVII of Master Specification.
 *
 * Provides a decoupled, immutable, already-prepared TokenUIState object
 * that feeds the Aether Flux UI cockpit without requiring the UI
 * to run expensive models, graph lookups, or statistical aggregations.
 */

export interface TokenUIState {
  readonly token: {
    readonly mint: string;
    readonly symbol: string;
    readonly name: string;
    readonly priceUsd: number;
    readonly liquidityUsd: number;
    readonly mcapUsd: number;
    readonly volume24hUsd: number;
    readonly ageSeconds: number;
    readonly txCount: number;
    readonly slot: number;
    readonly timestamp: number;
  };
  readonly overview: {
    readonly currentStatus: 'PAPER_CANDIDATE' | 'AUTHORIZED_SELL' | 'CHALLENGED_ABSTAIN' | 'SAFETY_LOCKED' | 'RISK_REJECTED';
    readonly hsi: number; // 0 - 100
    readonly pumpScore: number; // 0 - 100
    readonly pod: number; // 0 - 100
    readonly rug: string; // 'CLEAN' | 'SUSPICIOUS' | 'HIGH_RISK'
    readonly safetyConfidence: number; // 0 - 100
    readonly pumpProbability: number; // 0 - 100
    readonly manipulationRisk: number; // 0 - 100
    readonly liquidityQuality: number; // 0 - 100
    readonly dataConfidence: number; // 0 - 100
    readonly executionQuality: number; // 0 - 100
    readonly lifecycle: string; // 'DISCOVERED' | 'BONDING_CURVE_EARLY' | 'BONDING_CURVE_MATURE' | 'GRADUATION_APPROACHING' | 'POST_MIGRATION' | 'ESTABLISHED'
    readonly behaviorState: string; // 'EARLY_ACCUMULATION' | 'MOMENTUM_BUILDING' | 'BREAKOUT' | 'DISTRIBUTION' | 'COLLAPSE' | 'DORMANT'
    readonly marketRegime: string; // 'TRENDING' | 'CHOPPY' | 'OVERHEATED' | 'RISK_OFF' | 'NORMAL'
  };
  readonly forecast: {
    readonly p10Return30s: number; // e.g. 0.65
    readonly p20Return1m: number;  // e.g. 0.48
    readonly p50Return5m: number;  // e.g. 0.28
    readonly p100Return15m: number; // e.g. 0.14
    readonly pMinus20Return1m: number; // e.g. 0.12
    readonly pMinus50Return5m: number; // e.g. 0.08
    readonly pSurvive15m: number; // e.g. 0.88
    readonly pSurvive1h: number;  // e.g. 0.72
    readonly pSurvive24h: number; // e.g. 0.45
    readonly collapseHazard: number; // 0 - 100
    readonly expectedDrawdownPct: number; // e.g. -14.5
    readonly timeToPeakSecRange: [number, number]; // [minSec, maxSec]
    readonly forecastConfidence: number; // 0 - 100
  };
  readonly walletEntity: {
    readonly rawBuyers: number;
    readonly effectiveParticipants: number;
    readonly suspectedCoordination: boolean;
    readonly coordinationScore: number; // 0.0 - 1.0
    readonly entityClustersCount: number;
    readonly whaleParticipationPct: number;
    readonly sharedFundingAncestry: boolean;
    readonly walletIndependenceScore: number; // 0 - 100
    readonly entityConfidence: number; // 0 - 100
    readonly topClusters: Array<{
      readonly entityId: string;
      readonly walletCount: number;
      readonly volumeSol: number;
      readonly riskLabel: string;
    }>;
  };
  readonly behavior: {
    readonly sequence: string[]; // ['DORMANT', 'EARLY_ACCUMULATION', 'MOMENTUM_BUILDING']
    readonly currentPhase: string;
    readonly buyerAcceleration: number; // delta / s
    readonly sellAcceleration: number;
    readonly liquidityAcceleration: number;
    readonly entityConcentration: number;
    readonly distributionRisk: number;
  };
  readonly evidence: {
    readonly supporting: string[];
    readonly opposing: string[];
    readonly unknown: string[];
  };
  readonly council: {
    readonly primaryThesis: string;
    readonly strongestOpposition: string;
    readonly materialDisagreement: boolean;
    readonly minorityReport?: string;
    readonly unresolvedQuestions: string[];
    readonly councilConfidence: number; // 0 - 100
  };
  readonly knowledgeGraph: {
    readonly developerAddress: string;
    readonly funderAddress: string;
    readonly relatedTokens: string[];
    readonly historicalLaunchesCount: number;
    readonly pastRugsCount: number;
    readonly isSerialRugger: boolean;
    readonly similarHistoricalEpisodes: Array<{
      readonly mint: string;
      readonly similarityScore: number;
      readonly outcome: string;
    }>;
  };
  readonly marketContext: {
    readonly solanaRegime: string;
    readonly memeRegime: string;
    readonly launchpadRegime: string;
    readonly marketBreadth: string;
    readonly marketStressLevel: string;
    readonly capitalConcentrationScore: number;
    readonly capitalRotationPhase: string;
    readonly cohortStrength: number;
  };
  readonly dataHealth: {
    readonly sourceStatus: string;
    readonly latencyMs: number;
    readonly coveragePct: number;
    readonly missingnessPct: number;
    readonly rpcDisagreement: boolean;
    readonly decoderErrorsCount: number;
    readonly worldStateAgeMs: number;
    readonly quoteAgeMs: number;
  };
  readonly decisionExplanation: {
    readonly whatSylphBelieves: string;
    readonly why: string[];
    readonly whatContradictsIt: string[];
    readonly whatIsUnknown: string[];
    readonly whatInformationWouldHelp: string[];
    readonly whatCouldChangeTheDecision: string[];
  };
  readonly specialStates: {
    readonly solarCoreEligible: boolean;
    readonly diamondCoreEligible: boolean;
    readonly podProtectionActive: boolean;
    readonly safeStateVerified: boolean;
    readonly ghostTownException: boolean;
    readonly kolTrackingActive: boolean;
    readonly manualVipActive: boolean;
  };
  readonly blueprintTelemetry?: {
    readonly phase: {
      readonly currentPhase: string;
      readonly compactPhaseCode: string;
      readonly confidence: number;
      readonly rationale: string;
    };
    readonly proof: {
      readonly proofState: string;
      readonly validCount: number;
      readonly structuralValid: boolean;
      readonly marketValid: boolean;
      readonly executionValid: boolean;
      readonly summary: string;
    };
    readonly flow: {
      readonly capitalNoveltyRatio: number;
      readonly netIndependentCapitalFlowSol: number;
      readonly primaryCapitalClass: string;
      readonly recycledCapitalRatio: number;
      readonly flowCode: string;
    };
    readonly thesis: {
      readonly state: string;
      readonly thesisVelocity: number;
      readonly summary: string;
    };
    readonly forensics: {
      readonly why: readonly string[];
      readonly whyNot: readonly string[];
      readonly whatChanged: readonly string[];
      readonly whyStillValid: readonly string[];
    };
    readonly twin: {
      readonly robustExitCapacitySol: number;
      readonly distanceToFailure: number;
      readonly dtfVelocity: number;
      readonly cascadeSusceptibility: number;
      readonly minShockRequiredSol: number;
    };
    readonly system: {
      readonly status: string;
      readonly mode: string;
      readonly quorum: boolean;
      readonly continuity: boolean;
      readonly determinism: boolean;
    };
    readonly scout?: {
      readonly canonicalOpportunityId: string;
      readonly effectiveIndependentFamilies: number;
      readonly supportingStrategiesCount: number;
      readonly opposingStrategiesCount: number;
      readonly consensusScore: number;
      readonly netAction: string;
      readonly netSizeSol: number;
      readonly preventedRoundTripSol: number;
      readonly remainingCapacitySol: number;
    };
    readonly pathfinder?: {
      readonly authorizedSizeSol: number;
      readonly optionalityScore: number;
      readonly trappingScore: number;
      readonly exitLiquidityDepthSol: number;
      readonly availableCapitalSol: number;
      readonly deployedCapitalSol: number;
    };
    readonly compass?: {
      readonly missionMode: string;
      readonly compositeUtilityScore: number;
      readonly hardConstraintsPassed: boolean;
      readonly recommendedActionScaling: number;
      readonly rationale: string;
    };
    readonly constitution?: {
      readonly constitutionVersion: string;
      readonly activePoliciesCount: number;
      readonly authorizedModifier: string;
      readonly lineageVerified: boolean;
    };
    readonly mirror?: {
      readonly bestCounterfactualBranch: string;
      readonly decisionRegretSol: number;
      readonly livePnlSol: number;
      readonly attributionVerdict: string;
    };
    readonly guardian?: {
      readonly overallMarginPct: number;
      readonly closestBoundary: string;
      readonly marginTrend: string;
      readonly safetyDebtScore: number;
      readonly barrierErosionDetected: boolean;
    };
    readonly phoenix?: {
      readonly currentStage: string;
      readonly authorityEpoch: number;
      readonly emergencyExitsAvailable: boolean;
      readonly newEntriesPermitted: boolean;
      readonly chainHeadSlot: number;
    };
    readonly archimedes?: {
      readonly establishedKnowledgeCount: number;
      readonly openQuestionsCount: number;
      readonly applicabilityVerified: boolean;
      readonly applicabilityReason: string;
    };
    readonly sentinelX?: {
      readonly effectiveParticipants: number;
      readonly participantDiversityRatio: number;
      readonly signalSaturation: string;
      readonly primaryHypothesis: string;
      readonly redTeamRiskScore: number;
    };
    readonly horizon?: {
      readonly primaryRegime: string;
      readonly regimeConfidence: number;
      readonly networkStressLevel: string;
      readonly causalTransmissionChain: string;
      readonly activeSpilloversCount: number;
    };
    readonly sage?: {
      readonly overallCapabilityScore: number;
      readonly newEntryState: string;
      readonly emergencyExitState: string;
      readonly hotPathObservedMs: number;
      readonly coldPathThrottled: boolean;
    };
    readonly scientific?: {
      readonly bohr: {
        readonly dominantHypothesis: string;
        readonly materialAlternative: string;
        readonly unknownMass: number;
        readonly discriminatingQuestion?: string;
      };
      readonly bayes: {
        readonly priorProb: number;
        readonly posteriorProb: number;
        readonly effectiveEvidenceCount: number;
        readonly discountedOverlap: number;
      };
      readonly pearl: {
        readonly identifiability: string;
        readonly isSelfCaused: boolean;
        readonly causalUncertainty: number;
      };
      readonly einstein: {
        readonly velocityByAgeNormalized: number;
        readonly liquidityToMcapRatio: number;
        readonly volumeTurnoverNormalized: number;
        readonly excessReturnOverSol: number;
      };
      readonly darwin: {
        readonly activeStrategyId: string;
        readonly lifecycleStage: string;
        readonly sharpeRatio: number;
        readonly maxDrawdownPct: number;
      };
      readonly mendel: {
        readonly activeGeneCount: number;
        readonly interactionState: string;
      };
      readonly pasteur: {
        readonly temporalIntegrityValid: boolean;
        readonly testExposureCount: number;
      };
      readonly curie: {
        readonly applicableClaimsCount: number;
        readonly isEnvelopeValid: boolean;
      };
      readonly ledger: {
        readonly availableCashSol: number;
        readonly reservedSol: number;
        readonly hiddenGeneRisk: boolean;
      };
      readonly healthStrip: {
        readonly obs: 'OK' | 'WARN' | 'FAIL';
        readonly bel: 'OK' | 'WARN' | 'FAIL';
        readonly cau: 'OK' | 'WARN' | 'FAIL';
        readonly knw: 'OK' | 'WARN' | 'FAIL';
        readonly str: 'OK' | 'WARN' | 'FAIL';
        readonly rsk: 'OK' | 'WARN' | 'FAIL';
        readonly sys: 'OK' | 'WARN' | 'FAIL';
        readonly aut: 'OK' | 'WARN' | 'FAIL';
      };
      readonly unified?: {
        readonly primaryThesis: string;
        readonly beliefState: string;
        readonly uncertainty: string;
        readonly attentionTier: string;
        readonly phase: string;
        readonly trajectory: string;
        readonly structuralIntegrity: string;
        readonly stabilityState: string;
        readonly informationState: string;
        readonly forecastRobustness: string;
        readonly counterpartyIntent: string;
        readonly exitability: string;
        readonly nextQuestion: string;
        readonly nextAction: string;
        readonly whyReport: {
          readonly whyInteresting: string;
          readonly whyFiltered?: string;
          readonly whyProtected?: string;
          readonly whyWait?: string;
          readonly whyNoTrade?: string;
          readonly whyTrade?: string;
          readonly whyExit?: string;
        };
        readonly cantorStage: string;
        readonly cantorUniverses: readonly string[];
        readonly watsonRootCause: string;
      };
    };
  };
}
