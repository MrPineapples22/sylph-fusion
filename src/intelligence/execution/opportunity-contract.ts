/**
 * SOL-SYLPH Intelligence Fabric - Opportunity Contract & Execution Intelligence
 * Specifications: Parts XXVIII (Edge Estimator), XXIX (Edge Half-Life),
 * XXX (Adverse Selection), XXXI (Edge Verification Engine), XXXII (Edge Certificate),
 * XXXIII (Minimum Evidence Requirements), XLIV (Opportunity Contract),
 * XLV (Execution Intelligence), XLVI (Opportunity Half-Life), XLVII (Execution State Machine).
 */

export type EdgeEvidenceState =
  | 'DISCOVERY'
  | 'PROVISIONAL'
  | 'SUPPORTED'
  | 'VERIFIED'
  | 'DEGRADED'
  | 'RETIRED';

export interface AdverseSelectionRecord {
  readonly signalPrice: number;
  readonly preQuotePrice: number;
  readonly quotePrice: number;
  readonly submitPrice: number;
  readonly landPrice: number;
  readonly adverseSelectionBps: number; // (landPrice - signalPrice) / signalPrice * 10000
  readonly toxicFlowDetected: boolean;
}

export interface EdgeHalfLifeProfile {
  readonly decayMap: {
    readonly '0ms': number; // 1.0 (100% alpha retained)
    readonly '100ms': number;
    readonly '250ms': number;
    readonly '500ms': number;
    readonly '1000ms': number;
    readonly '2000ms': number;
    readonly '5000ms': number;
  };
  readonly halfLifeMs: number;
}

export interface MinimumEvidenceReport {
  readonly rawSampleCount: number;
  readonly effectiveSampleSize: number;
  readonly temporalDiversityScore: number; // 0.0 - 1.0
  readonly regimeDiversityScore: number; // 0.0 - 1.0
  readonly platformDiversityScore: number; // 0.0 - 1.0
  readonly clusterDiversityScore: number; // 0.0 - 1.0
  readonly meetsMinimumRequirements: boolean;
}

/** No trusted opportunity-validation authority is connected to this engine. */
export interface OpportunityEvidenceProvenance {
  readonly evidenceStatus: 'MISSING';
  readonly validationSource: null;
  readonly authority: 'ESTIMATE_ONLY';
  readonly reason: 'NO_TRUSTED_VALIDATION_EVIDENCE';
}

export interface EdgeCertificate extends OpportunityEvidenceProvenance {
  readonly certificateId: string;
  readonly mint: string;
  readonly timestampMs: number;
  readonly predictionQuality: number | null;
  readonly calibrationBrier: number | null;
  readonly sampleSufficiency: number | null;
  readonly modelAgreementScore: number | null;
  readonly historicalSimilarity: number | null;
  readonly oodStatus: string;
  readonly walkForwardStatus: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
  readonly purgedValidationStatus: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
  readonly shadowStatus: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
  readonly executionQualityScore: number | null;
  readonly edgeHalfLifeMs: number | null;
  readonly liquidityCapacitySol: number | null;
  readonly dataHealthConfidence: number | null;
  readonly manipulationRobustness: 'ROBUST' | 'MODERATE' | 'FRAGILE' | 'UNKNOWN';
  /** Caller-supplied estimate, not a measured or validated executable edge. */
  readonly netExecutableEdgeBps: number;
  readonly evidenceState: EdgeEvidenceState;
}

export interface OpportunityContract extends OpportunityEvidenceProvenance {
  /** Economic/latency estimates are heuristic; probabilities and context are caller inputs. */
  readonly estimateMethod: 'OPPORTUNITY_HEURISTIC_V1';
  readonly contractId: string;
  readonly mint: string;
  readonly entryTimeMs: number;
  readonly positionSizeSol: number;
  readonly targetPct: number;
  readonly stopPct: number;
  readonly horizonSec: number;
  readonly executionPolicy: string;

  // Path-dependent probabilities
  readonly pTargetFirst: number;
  readonly pStopFirst: number;
  readonly pExpire: number;

  // Economic expectation (Part XXVIII: Net Executable Edge)
  readonly expectedGrossEdgePct: number;
  readonly priceImpactPct: number;
  readonly slippagePct: number;
  readonly priorityFeeSol: number;
  readonly jitoTipSol: number;
  readonly adverseSelectionPct: number;
  readonly latencyDecayPct: number;
  readonly mevExecutionRiskPct: number;
  readonly failureCostPct: number;
  readonly expectedExecutableEdgePct: number;

  // Risk & excursions
  readonly expectedShortfallPct: number;
  readonly expectedMfePct: number;
  readonly expectedMaePct: number;

  // Unknown until supported by trusted validation evidence.
  readonly executionConfidence: number | null;
  readonly modelConfidence: number | null;
  readonly dataConfidence: number | null;

  // Latency & Half-life (Part XXIX)
  readonly opportunityHalfLifeMs: number;
  readonly expectedLandingTimeMs: number;
  readonly isExpiredBeforeLanding: boolean;
  readonly halfLifeProfile?: EdgeHalfLifeProfile;

  // Evidence & Verification (Parts XXXI, XXXII, XXXIII)
  readonly evidenceState: EdgeEvidenceState;
  readonly certificate?: EdgeCertificate;

  // Context
  readonly oodScore: number | null;
  readonly regime: string;
}

export interface ExecutionJournalEntry {
  readonly decisionId: string;
  readonly executionId: string;
  readonly mint: string;
  readonly route: string;
  readonly expectedOutputLamports: bigint;
  readonly expectedSlippageBps: number;
  readonly computeUnits: number;
  readonly priorityFeeLamports: bigint;
  readonly jitoTipLamports: bigint;
  readonly blockhash: string;
  readonly sendProvider: string;
  readonly sendTimeMs: number;
  signature?: string;
  bundleId?: string;
  landTimeMs?: number;
  confirmTimeMs?: number;
  actualOutputLamports?: bigint;
  actualSlippageBps?: number;
  adverseSelection?: AdverseSelectionRecord;
  status: 'PENDING' | 'LANDED' | 'CONFIRMED' | 'FAILED' | 'EXPIRED';
  failureReason?: string;
}

export class ExecutionIntelligenceEngine {
  private readonly journal: ExecutionJournalEntry[] = [];

  /**
   * Computes edge half life profile across discrete latency steps
   */
  public computeHalfLifeProfile(halfLifeMs: number): EdgeHalfLifeProfile {
    const decay = (tMs: number) => Number(Math.exp((-Math.LN2 * tMs) / Math.max(50, halfLifeMs)).toFixed(3));

    return {
      halfLifeMs,
      decayMap: {
        '0ms': 1.0,
        '100ms': decay(100),
        '250ms': decay(250),
        '500ms': decay(500),
        '1000ms': decay(1000),
        '2000ms': decay(2000),
        '5000ms': decay(5000),
      },
    };
  }

  /**
   * Legacy certificate-shaped estimate report, not a signed or tamper-evident proof.
   * Scalar claims are retained only for call compatibility and are never evidence.
   * Promotion requires a future integration with a trusted validation authority;
   * this engine currently has no path to SUPPORTED or VERIFIED.
   */
  public generateEdgeCertificate(params: {
    mint: string;
    netExecutableEdgeBps: number;
    /** @deprecated Ignored: an unverified scalar is not validation evidence. */
    sampleCount?: number;
    /** @deprecated Ignored: an unverified scalar is not validation evidence. */
    brierScore?: number;
    /** @deprecated Ignored: an unverified scalar is not validation evidence. */
    modelAgreement?: number;
    /** @deprecated Ignored: an unverified scalar is not validation evidence. */
    dataConfidence?: number;
    /** @deprecated Ignored: callers cannot assign an evidence state. */
    evidenceState?: EdgeEvidenceState;
  }): EdgeCertificate {
    return {
      certificateId: `cert_${params.mint.slice(0, 8)}_${Date.now()}`,
      mint: params.mint,
      timestampMs: Date.now(),
      predictionQuality: null,
      calibrationBrier: null,
      sampleSufficiency: null,
      modelAgreementScore: null,
      historicalSimilarity: null,
      oodStatus: 'UNKNOWN',
      walkForwardStatus: 'UNKNOWN',
      purgedValidationStatus: 'UNKNOWN',
      shadowStatus: 'UNKNOWN',
      executionQualityScore: null,
      edgeHalfLifeMs: null,
      liquidityCapacitySol: null,
      dataHealthConfidence: null,
      manipulationRobustness: 'UNKNOWN',
      netExecutableEdgeBps: params.netExecutableEdgeBps,
      evidenceState: 'PROVISIONAL',
      evidenceStatus: 'MISSING',
      validationSource: null,
      authority: 'ESTIMATE_ONLY',
      reason: 'NO_TRUSTED_VALIDATION_EVIDENCE',
    };
  }

  /**
   * Computes heuristic opportunity economics, without asserting validation or authority.
   */
  public evaluateOpportunity(params: {
    mint: string;
    positionSizeSol: number;
    targetPct: number;
    stopPct: number;
    horizonSec: number;
    pTargetFirst: number;
    pStopFirst: number;
    pNeither: number;
    expectedGrossEdgePct: number;
    poolLiquiditySol: number;
    priorityFeeLamports: bigint;
    jitoTipLamports: bigint;
    quoteAgeMs: number;
    adverseSelectionPct?: number;
    networkCongestionFactor?: number;
    oodScore?: number;
    regime?: string;
  }): OpportunityContract {
    const {
      mint,
      positionSizeSol,
      targetPct,
      stopPct,
      horizonSec,
      pTargetFirst,
      pStopFirst,
      pNeither,
      expectedGrossEdgePct,
      poolLiquiditySol,
      priorityFeeLamports,
      jitoTipLamports,
      quoteAgeMs,
      adverseSelectionPct = 0.35,
      networkCongestionFactor = 1.0,
      oodScore = null,
      regime = 'UNKNOWN',
    } = params;

    // Non-linear price impact: impact ~= (size / (liquidity + size)) * 100
    const priceImpactPct = poolLiquiditySol > 0
      ? (positionSizeSol / (poolLiquiditySol + positionSizeSol)) * 100
      : 5.0;

    const slippagePct = Math.min(10.0, priceImpactPct * 1.5 + 0.3);

    const prioritySol = Number(priorityFeeLamports) / 1e9;
    const tipSol = Number(jitoTipLamports) / 1e9;
    const feeImpactPct = positionSizeSol > 0 ? ((prioritySol + tipSol) / positionSizeSol) * 100 : 0.5;

    // Latency decay: rapid alpha half-life in meme markets
    const opportunityHalfLifeMs = Math.max(1000, Math.min(30000, horizonSec * 100));
    const expectedLandingTimeMs = Math.round(400 * networkCongestionFactor + quoteAgeMs);
    const latencyDecayRatio = Math.min(1.0, expectedLandingTimeMs / opportunityHalfLifeMs);
    const latencyDecayPct = expectedGrossEdgePct * latencyDecayRatio * 0.4;

    const mevRiskPct = 0.5 * networkCongestionFactor;
    const failureCostPct = 0.2;

    // Expected Executable Edge calculation (Part XXVIII):
    // Net Edge = Gross Edge - Price Impact - Slippage - Fees - Adverse Selection - Latency Decay - MEV - Failure Cost
    const expectedExecutableEdgePct =
      expectedGrossEdgePct -
      priceImpactPct -
      slippagePct -
      feeImpactPct -
      adverseSelectionPct -
      latencyDecayPct -
      mevRiskPct -
      failureCostPct;

    const expectedShortfallPct = Math.abs(stopPct) * 1.2 + slippagePct;
    const isExpiredBeforeLanding = expectedLandingTimeMs > opportunityHalfLifeMs;

    const contractId = `opp_${mint.slice(0, 8)}_${Date.now()}`;
    const halfLifeProfile = this.computeHalfLifeProfile(opportunityHalfLifeMs);
    const netEdgeBps = Math.round(expectedExecutableEdgePct * 100);

    const certificate = this.generateEdgeCertificate({
      mint,
      netExecutableEdgeBps: netEdgeBps,
    });

    return {
      contractId,
      mint,
      entryTimeMs: Date.now(),
      positionSizeSol,
      targetPct,
      stopPct,
      horizonSec,
      executionPolicy: 'ADAPTIVE_MOMENTUM',
      pTargetFirst,
      pStopFirst,
      pExpire: pNeither,
      expectedGrossEdgePct: Number(expectedGrossEdgePct.toFixed(2)),
      priceImpactPct: Number(priceImpactPct.toFixed(2)),
      slippagePct: Number(slippagePct.toFixed(2)),
      priorityFeeSol: prioritySol,
      jitoTipSol: tipSol,
      adverseSelectionPct: Number(adverseSelectionPct.toFixed(2)),
      latencyDecayPct: Number(latencyDecayPct.toFixed(2)),
      mevExecutionRiskPct: Number(mevRiskPct.toFixed(2)),
      failureCostPct: Number(failureCostPct.toFixed(2)),
      expectedExecutableEdgePct: Number(expectedExecutableEdgePct.toFixed(2)),
      expectedShortfallPct: Number(expectedShortfallPct.toFixed(2)),
      expectedMfePct: targetPct * 1.2,
      expectedMaePct: -expectedShortfallPct,
      executionConfidence: null,
      modelConfidence: null,
      dataConfidence: null,
      opportunityHalfLifeMs,
      expectedLandingTimeMs,
      isExpiredBeforeLanding,
      halfLifeProfile,
      evidenceState: certificate.evidenceState,
      evidenceStatus: certificate.evidenceStatus,
      validationSource: certificate.validationSource,
      authority: certificate.authority,
      reason: certificate.reason,
      estimateMethod: 'OPPORTUNITY_HEURISTIC_V1',
      certificate,
      oodScore,
      regime,
    };
  }

  public recordJournalEntry(entry: ExecutionJournalEntry): void {
    this.journal.push(entry);
    if (this.journal.length > 500) {
      this.journal.shift();
    }
  }

  public updateJournalEntry(
    executionId: string,
    update: Partial<ExecutionJournalEntry>
  ): ExecutionJournalEntry | undefined {
    const entry = this.journal.find((e) => e.executionId === executionId);
    if (entry) {
      Object.assign(entry, update);
    }
    return entry;
  }

  public getJournal(): readonly ExecutionJournalEntry[] {
    return this.journal;
  }
}
