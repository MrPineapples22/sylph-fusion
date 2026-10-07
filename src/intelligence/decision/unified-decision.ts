/**
 * SOL-SYLPH Intelligence Fabric - Unified Opportunity Decision Object
 * Specifications: Master Quantitative Upgrade & Prompt Section 9.
 *
 * Provides a single, authoritative, immutable decision contract for token evaluation.
 * Synthesizes SPIE Net EV, Solaris execution feasibility, Veto safety kernels,
 * and market microstructure features into an auditable decision object.
 */

import { SpieAction, SpieEvaluation, SpieFactors, OpportunityStage } from '../spie/spie-engine.js';
import { MarketRegimeType } from '../spie/kelly-allocator.js';
import { createHash } from 'node:crypto';
import { AlphaHalfLifeEngine, AlphaHalfLifeEstimate, OpportunityStage as AlphaOpportunityStage } from '../timing/alpha-half-life.js';
import { ValueOfInformationEngine, VoiEvaluation } from './value-of-information.js';
import { ModelFailurePredictor, ModelFailureEvaluation } from '../science/model-failure-predictor.js';

export interface UnifiedOpportunityDecision {
  readonly decisionId: string;                     // Canonical decision_id
  readonly opportunityId: string;                  // Opportunity trace identity
  readonly tokenId: string;                        // Canonical token identity (mint)
  readonly token: string;                          // Compatibility alias for mint
  readonly symbol: string;
  readonly timestamp: number;
  readonly slot: number;
  readonly marketSnapshotId: string;               // Bound market evidence snapshot ID
  readonly walletEvidenceIds: readonly string[];   // Wallet / cluster evidence IDs
  readonly graphEvidenceIds: readonly string[];    // Capital flow graph evidence IDs
  readonly strategyVersion: string;                // Strategy identifier and version
  readonly featureVersion: string;                 // Point-in-time feature version
  readonly freshnessMs: number;                    // Market data observation age
  readonly expectedValue: number;                  // Net expected value in USD
  readonly expectedNetEvBps: number;               // Net EV in basis points
  readonly confidence: number;                     // Calibrated probability (Platt scaled, 0.0 to 1.0)
  readonly uncertainty: number;                    // Conformal interval width (0.0 to 1.0)
  readonly expectedUpside: number;                 // Target gain % (e.g. 0.40 = +40%)
  readonly expectedDownside: number;               // Structural stop % (e.g. 0.12 = -12%)
  readonly liquidityQuality: number;               // Liquidity & reserve score (0.0 to 1.0)
  readonly momentumQuality: number;                // Volume velocity & tick acceleration (0.0 to 1.0)
  readonly participationQuality: number;           // Unique buyer count & organic dispersion (0.0 to 1.0)
  readonly walletQuality: number;                  // Smart wallet presence & low Sybil cluster (0.0 to 1.0)
  readonly safetyScore: number;                    // Aggregate safety score (0 to 100)
  readonly rugProbability: number;                 // Estimated rug / pull probability (0.0 to 1.0)
  readonly manipulationProbability: number;        // Wash trading / bundling signal (0.0 to 1.0)
  readonly executionQuality: number;               // Spread, depth, and confirmation feasibility (0.0 to 1.0)
  readonly expectedSlippageBps: number;            // Model-estimated slippage for order size
  readonly expectedTransactionCostLamports: bigint;// Combined base fee + priority fee + Jito tip
  readonly marketRegime: MarketRegimeType;
  readonly opportunityWindowMs: number;            // Valid execution half-life (dynamically predicted)
  readonly invalidationCondition: string;          // Explicit criteria that revokes this decision
  readonly recommendedMaxRiskUsd: number;          // Capital allocation budget for this trade
  readonly riskEvidence: readonly string[];        // Specific risk evidence observations
  readonly vetoEvidence: readonly string[];        // Active veto reasons
  readonly conflicts: readonly string[];           // Contradictions between upstream models
  readonly provenance: string;                     // SHA-256 evidence chain digest
  readonly reasonsForAcceptance: readonly string[];// Evidence justifying acceptance
  readonly reasonsForRejection: readonly string[]; // Blocking criteria or risk vetoes
  readonly stage: OpportunityStage;
  readonly actionRecommendation: SpieAction | 'WAIT';
  readonly dominantFactor: string;
  readonly limitingConstraint: string;
  readonly alphaHalfLifeMs?: number;               // Predicted edge half-life (Roadmap #1, #201)
  readonly alphaBurnRateBpsPerMs?: number;         // Instantaneous burn rate (Roadmap #2)
  readonly economicEventHorizonMs?: number;        // Time after which net edge drops to zero (Roadmap #10)
  readonly voiEvaluation?: VoiEvaluation;          // Value of Information evaluation (Roadmap #203, #204)
  readonly modelFailureEvaluation?: ModelFailureEvaluation; // P(Model Failure) (Roadmap #93, #220)
}

export interface ReconcileDecisionInputs {
  readonly tokenId: string;
  readonly symbol: string;
  readonly slot: number;
  readonly timestamp?: number;
  readonly marketSnapshotId?: string;
  readonly spieEvaluation?: SpieEvaluation;
  readonly walletIntelMetrics?: {
    readonly effectiveIndependentCount: number;
    readonly clusterDispersalRatio: number;
    readonly evidenceIds?: readonly string[];
  };
  readonly graphMetrics?: {
    readonly phase: string;
    readonly netInflowSol: number;
    readonly evidenceIds?: readonly string[];
  };
  readonly vetoRules?: readonly {
    readonly ruleId: string;
    readonly passed: boolean;
    readonly reason?: string;
  }[];
  readonly riskEvaluation?: {
    readonly approved: boolean;
    readonly maxRiskUsd?: number;
    readonly reasons?: readonly string[];
  };
  readonly modelGateDecision?: {
    readonly accepted: boolean;
    readonly score?: number;
    readonly modelVersion?: string;
    readonly rejectionReason?: string;
  };
  readonly freshnessMs?: number;
  readonly strategyVersion?: string;
  readonly featureVersion?: string;
  readonly opportunityStage?: AlphaOpportunityStage;
  readonly competitorDensity?: number;
  readonly opportunityJerk?: number;
  readonly elapsedMs?: number;
}

export class UnifiedDecisionEngine {
  private readonly decisions = new Map<string, UnifiedOpportunityDecision>();

  /**
   * Authoritative reconciliation boundary for intelligence recommendations.
   * Resolves competing upstream signals deterministically:
   * Safety vetoes and risk blocks strictly override speculative opportunity scores.
   */
  public reconcile(input: ReconcileDecisionInputs): UnifiedOpportunityDecision {
    const timestamp = input.timestamp ?? Date.now();
    const opportunityId = `opp_${input.tokenId.slice(0, 8)}_${input.slot}`;
    const marketSnapshotId = input.marketSnapshotId ?? 'unbound_no_market_snapshot';
    const strategyVersion = input.strategyVersion ?? 'sylph_momentum_v1.0';
    const featureVersion = input.featureVersion ?? 'features_v1';
    const freshnessMs = input.freshnessMs ?? 250;
    const inputDigest = createHash('sha256')
      .update(`${input.tokenId}:${input.slot}:${marketSnapshotId}:${strategyVersion}:${featureVersion}`)
      .digest('hex')
      .slice(0, 12);
    const decisionId = `dec_${input.tokenId.slice(0, 8)}_${input.slot}_${inputDigest}`;

    const walletEvidenceIds = input.walletIntelMetrics?.evidenceIds ?? [];
    const graphEvidenceIds = input.graphMetrics?.evidenceIds ?? [];

    const reasonsForAcceptance: string[] = [];
    const reasonsForRejection: string[] = [];
    const vetoEvidence: string[] = [];
    const riskEvidence: string[] = [];
    const conflicts: string[] = [];

    // 1. Evaluate Veto Rules (Hard Gate)
    let hasHardVeto = false;
    if (input.vetoRules) {
      for (const rule of input.vetoRules) {
        if (!rule.passed) {
          hasHardVeto = true;
          const msg = rule.reason ?? `Veto rule ${rule.ruleId} tripped`;
          vetoEvidence.push(msg);
          reasonsForRejection.push(`HARD_VETO: ${msg}`);
        }
      }
    }

    // 2. Evaluate Risk Boundaries
    let riskApproved = true;
    if (input.riskEvaluation && !input.riskEvaluation.approved) {
      riskApproved = false;
      const msgs = input.riskEvaluation.reasons ?? ['Risk limit exceeded'];
      riskEvidence.push(...msgs);
      reasonsForRejection.push(...msgs.map(m => `RISK_REJECTED: ${m}`));
    }

    // 3. Evaluate ML Model Gate
    let modelApproved = true;
    if (input.modelGateDecision && !input.modelGateDecision.accepted) {
      modelApproved = false;
      const reason = input.modelGateDecision.rejectionReason ?? 'Model gate rejected';
      reasonsForRejection.push(`MODEL_GATE_REJECTED: ${reason}`);
    }

    // 4. Evaluate Microstructure / SPIE
    const spie = input.spieEvaluation;
    let netEvBps = spie?.netExpectedEvBps ?? 0;
    let confidence = spie?.pTarget ?? 0.5;
    let actionRecommendation: SpieAction = spie?.actionRecommendation ?? 'ABSTAIN';

    // 5. Detect and resolve competing signals
    if ((actionRecommendation === 'FAST_BUY' || actionRecommendation === 'BREAKOUT_ENTER') && (hasHardVeto || !riskApproved || !modelApproved)) {
      conflicts.push(`SPIE recommended ${actionRecommendation} but safety gates vetoed: ${[...vetoEvidence, ...riskEvidence].join('; ')}`);
      // Deterministic resolution: Safety veto overrides speculative momentum
      actionRecommendation = 'ABSTAIN';
    }

    // 5b. Dynamic Alpha Half-Life & Value-of-Information (VOI) Policy
    const alphaStage = input.opportunityStage ?? (
      input.spieEvaluation?.opportunityStage === 'DEVELOPING' ? 'BONDING_CURVE_MID' :
      input.spieEvaluation?.opportunityStage === 'WATCH' ? 'BONDING_CURVE_EARLY' :
      input.spieEvaluation?.opportunityStage === 'READY' ? 'POST_MIGRATION_AMM' :
      'BONDING_CURVE_MID'
    );
    const halfLifeEstimate = AlphaHalfLifeEngine.estimateHalfLife({
      stage: alphaStage,
      initialEdgeBps: spie?.grossAlphaBps ?? Math.max(0, netEvBps + 120),
      hurdleBps: 100,
      competitorDensity: input.competitorDensity ?? 0.3,
      opportunityJerk: input.opportunityJerk ?? 0.0,
      frictionBps: spie?.executionFrictionBps ?? 120,
    });

    const uncertainty = Number((1.0 - (Math.abs(confidence - 0.5) * 2)).toFixed(2));
    let finalAction: SpieAction | 'WAIT' = actionRecommendation;
    let voiEvaluation: VoiEvaluation | undefined = undefined;

    if (actionRecommendation !== 'ABSTAIN') {
      voiEvaluation = ValueOfInformationEngine.evaluatePolicy({
        confidence,
        uncertainty,
        netEvBps,
        elapsedMs: input.elapsedMs ?? 50,
        halfLifeEstimate,
      });

      if (voiEvaluation.action === 'WAIT') {
        finalAction = 'WAIT';
        reasonsForRejection.push(`VOI_WAIT: ${voiEvaluation.rationale}`);
      } else if (voiEvaluation.action === 'ABSTAIN') {
        finalAction = 'ABSTAIN';
        reasonsForRejection.push(`VOI_ABSTAIN: ${voiEvaluation.rationale}`);
      }
    }

    // 5c. Model-Failure Predictor & Specialist Disagreement Geometry (Roadmap #93, #220)
    let modelFailureEvaluation: ModelFailureEvaluation | undefined = undefined;
    if (spie?.factors) {
      modelFailureEvaluation = ModelFailurePredictor.evaluateFailureProbability({
        factors: spie.factors,
        confidence,
        conformalUncertainty: uncertainty,
        netEvBps,
      });

      if (modelFailureEvaluation.isModelFailureVeto) {
        if (finalAction !== 'ABSTAIN') {
          conflicts.push(`Model-Failure Predictor vetoed ${finalAction}: ${modelFailureEvaluation.rationale}`);
          finalAction = 'ABSTAIN';
        }
        reasonsForRejection.push(modelFailureEvaluation.rationale);
      }
    }

    if (finalAction === 'FAST_BUY' || finalAction === 'BREAKOUT_ENTER') {
      reasonsForAcceptance.push(`Positive Net EV (+${netEvBps} bps) exceeds hurdle`);
      reasonsForAcceptance.push(`Strong dominant factor: ${spie?.dominantPositiveFactor ?? 'momentum'}`);
    } else if (reasonsForRejection.length === 0) {
      reasonsForRejection.push(spie?.abstainReason ?? 'Insufficient statistical edge');
    }

    // 6. Compute Cryptographic Provenance Digest
    const provenance = createHash('sha256')
      .update(JSON.stringify({
        decisionId,
        tokenId: input.tokenId,
        slot: input.slot,
        marketSnapshotId,
        strategyVersion,
        featureVersion,
        walletEvidenceIds,
        graphEvidenceIds,
        vetoEvidence,
        riskEvidence,
        actionRecommendation: finalAction,
      }))
      .digest('hex');

    const decision: UnifiedOpportunityDecision = {
      decisionId,
      opportunityId,
      tokenId: input.tokenId,
      token: input.tokenId,
      symbol: input.symbol,
      timestamp,
      slot: input.slot,
      marketSnapshotId,
      walletEvidenceIds: Object.freeze(walletEvidenceIds),
      graphEvidenceIds: Object.freeze(graphEvidenceIds),
      strategyVersion,
      featureVersion,
      freshnessMs,
      expectedValue: input.riskEvaluation?.maxRiskUsd === undefined
        ? 0
        : (netEvBps / 10_000) * input.riskEvaluation.maxRiskUsd,
      expectedNetEvBps: netEvBps,
      confidence,
      uncertainty,
      expectedUpside: (spie?.grossExpectedUpsideBps ?? 0) / 10_000,
      expectedDownside: (spie?.modeledDownsideBps ?? 0) / 10_000,
      liquidityQuality: spie?.factors?.liquidityDepth ?? 0,
      momentumQuality: spie?.factors?.momentum ?? 0,
      participationQuality: spie?.factors?.participation ?? 0,
      walletQuality: spie?.factors?.walletQuality ?? 0,
      safetyScore: hasHardVeto ? 0 : Math.round((spie?.factors?.safety ?? 0) * 100),
      rugProbability: hasHardVeto ? 1.0 : Math.max(0, 1 - (spie?.factors?.safety ?? 0)),
      manipulationProbability: (1 - (spie?.factors?.walletQuality ?? 0)) * 0.5,
      executionQuality: spie?.factors?.executionFeasibility ?? 0,
      expectedSlippageBps: spie ? 120 : 0,
      expectedTransactionCostLamports: spie ? 150_000n : 0n,
      marketRegime: input.spieEvaluation ? 'TRENDING' : 'DEGRADED',
      opportunityWindowMs: halfLifeEstimate.halfLifeMs,
      invalidationCondition: 'Price drops below micro-support or creator dumps supply',
      recommendedMaxRiskUsd: input.riskEvaluation?.maxRiskUsd ?? 0,
      riskEvidence: Object.freeze(riskEvidence),
      vetoEvidence: Object.freeze(vetoEvidence),
      conflicts: Object.freeze(conflicts),
      provenance,
      reasonsForAcceptance: Object.freeze(reasonsForAcceptance),
      reasonsForRejection: Object.freeze(reasonsForRejection),
      stage: finalAction === 'ABSTAIN' ? 'INVALIDATED' : (finalAction === 'WAIT' ? 'WATCH' : 'READY'),
      actionRecommendation: finalAction,
      dominantFactor: spie?.dominantPositiveFactor ?? (finalAction === 'ABSTAIN' ? 'none' : 'momentum'),
      limitingConstraint: spie?.dominantNegativeConstraint ?? (reasonsForRejection[0] || 'none'),
      alphaHalfLifeMs: halfLifeEstimate.halfLifeMs,
      alphaBurnRateBpsPerMs: halfLifeEstimate.burnRateBpsPerMs,
      economicEventHorizonMs: halfLifeEstimate.economicEventHorizonMs,
      voiEvaluation,
      modelFailureEvaluation,
    };

    this.decisions.set(decisionId, decision);
    return Object.freeze(decision);
  }

  public getDecision(decisionId: string): UnifiedOpportunityDecision | undefined {
    return this.decisions.get(decisionId);
  }
}

export class UnifiedDecisionBuilder {
  public static fromSpieEvaluation(
    opportunityId: string,
    slot: number,
    evalResult: SpieEvaluation,
    options?: {
      uncertainty?: number;
      expectedUpside?: number;
      expectedDownside?: number;
      manipulationProbability?: number;
      expectedSlippageBps?: number;
      expectedTransactionCostLamports?: bigint;
      marketRegime?: MarketRegimeType;
      opportunityWindowMs?: number;
      recommendedMaxRiskUsd?: number;
      customInvalidation?: string;
    }
  ): UnifiedOpportunityDecision {
    const engine = new UnifiedDecisionEngine();
    return engine.reconcile({
      tokenId: evalResult.mint,
      symbol: evalResult.symbol,
      slot,
      spieEvaluation: evalResult,
      riskEvaluation: {
        approved: evalResult.actionRecommendation !== 'ABSTAIN',
        maxRiskUsd: options?.recommendedMaxRiskUsd ?? 100,
      },
    });
  }
}
