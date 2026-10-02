/**
 * SOL-SYLPH Intelligence Fabric - Unified Opportunity Decision Object
 * Specifications: Master Quantitative Upgrade & Prompt Section 9.
 *
 * Provides a single, authoritative, immutable decision contract for token evaluation.
 * Synthesizes SPIE Net EV, Solaris execution feasibility, Veto safety kernels,
 * and market microstructure features into an auditable decision object.
 */
import { createHash } from 'node:crypto';
import { AlphaHalfLifeEngine } from '../timing/alpha-half-life.js';
import { ValueOfInformationEngine } from './value-of-information.js';
export class UnifiedDecisionEngine {
    decisions = new Map();
    /**
     * Authoritative reconciliation boundary for intelligence recommendations.
     * Resolves competing upstream signals deterministically:
     * Safety vetoes and risk blocks strictly override speculative opportunity scores.
     */
    reconcile(input) {
        const timestamp = input.timestamp ?? Date.now();
        const opportunityId = `opp_${input.tokenId.slice(0, 8)}_${input.slot}`;
        const marketSnapshotId = input.marketSnapshotId ?? `snap_${input.tokenId.slice(0, 8)}_${input.slot}`;
        const strategyVersion = input.strategyVersion ?? 'sylph_momentum_v1.0';
        const featureVersion = input.featureVersion ?? 'features_v1';
        const freshnessMs = input.freshnessMs ?? 250;
        const inputDigest = createHash('sha256')
            .update(`${input.tokenId}:${input.slot}:${marketSnapshotId}:${strategyVersion}:${featureVersion}`)
            .digest('hex')
            .slice(0, 12);
        const decisionId = `dec_${input.tokenId.slice(0, 8)}_${input.slot}_${inputDigest}`;
        const walletEvidenceIds = input.walletIntelMetrics?.evidenceIds ?? [`wallet_${input.tokenId.slice(0, 8)}`];
        const graphEvidenceIds = input.graphMetrics?.evidenceIds ?? [`graph_${input.tokenId.slice(0, 8)}`];
        const reasonsForAcceptance = [];
        const reasonsForRejection = [];
        const vetoEvidence = [];
        const riskEvidence = [];
        const conflicts = [];
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
        let actionRecommendation = spie?.actionRecommendation ?? 'ABSTAIN';
        // 5. Detect and resolve competing signals
        if ((actionRecommendation === 'FAST_BUY' || actionRecommendation === 'BREAKOUT_ENTER') && (hasHardVeto || !riskApproved || !modelApproved)) {
            conflicts.push(`SPIE recommended ${actionRecommendation} but safety gates vetoed: ${[...vetoEvidence, ...riskEvidence].join('; ')}`);
            // Deterministic resolution: Safety veto overrides speculative momentum
            actionRecommendation = 'ABSTAIN';
        }
        // 5b. Dynamic Alpha Half-Life & Value-of-Information (VOI) Policy
        const alphaStage = input.opportunityStage ?? (input.spieEvaluation?.opportunityStage === 'DEVELOPING' ? 'BONDING_CURVE_MID' :
            input.spieEvaluation?.opportunityStage === 'WATCH' ? 'BONDING_CURVE_EARLY' :
                input.spieEvaluation?.opportunityStage === 'READY' ? 'POST_MIGRATION_AMM' :
                    'BONDING_CURVE_MID');
        const halfLifeEstimate = AlphaHalfLifeEngine.estimateHalfLife({
            stage: alphaStage,
            initialEdgeBps: spie?.grossAlphaBps ?? Math.max(0, netEvBps + 120),
            hurdleBps: 100,
            competitorDensity: input.competitorDensity ?? 0.3,
            opportunityJerk: input.opportunityJerk ?? 0.0,
            frictionBps: spie?.executionFrictionBps ?? 120,
        });
        const uncertainty = Number((1.0 - (Math.abs(confidence - 0.5) * 2)).toFixed(2));
        let finalAction = actionRecommendation;
        let voiEvaluation = undefined;
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
            }
            else if (voiEvaluation.action === 'ABSTAIN') {
                finalAction = 'ABSTAIN';
                reasonsForRejection.push(`VOI_ABSTAIN: ${voiEvaluation.rationale}`);
            }
        }
        if (finalAction === 'FAST_BUY' || finalAction === 'BREAKOUT_ENTER') {
            reasonsForAcceptance.push(`Positive Net EV (+${netEvBps} bps) exceeds hurdle`);
            reasonsForAcceptance.push(`Strong dominant factor: ${spie?.dominantPositiveFactor ?? 'momentum'}`);
        }
        else if (reasonsForRejection.length === 0) {
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
        const decision = {
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
            expectedValue: (netEvBps / 10_000) * (input.riskEvaluation?.maxRiskUsd ?? 100),
            expectedNetEvBps: netEvBps,
            confidence,
            uncertainty,
            expectedUpside: (spie?.grossExpectedUpsideBps ?? 2000) / 10_000,
            expectedDownside: (spie?.modeledDownsideBps ?? 1200) / 10_000,
            liquidityQuality: spie?.factors?.liquidityDepth ?? 0.8,
            momentumQuality: spie?.factors?.momentum ?? 0.7,
            participationQuality: spie?.factors?.participation ?? 0.8,
            walletQuality: spie?.factors?.walletQuality ?? 0.8,
            safetyScore: hasHardVeto ? 0 : Math.round((spie?.factors?.safety ?? 0.85) * 100),
            rugProbability: hasHardVeto ? 1.0 : Math.max(0, 1 - (spie?.factors?.safety ?? 0.85)),
            manipulationProbability: (1 - (spie?.factors?.walletQuality ?? 0.8)) * 0.5,
            executionQuality: spie?.factors?.executionFeasibility ?? 0.85,
            expectedSlippageBps: 120,
            expectedTransactionCostLamports: 150000n,
            marketRegime: 'TRENDING',
            opportunityWindowMs: halfLifeEstimate.halfLifeMs,
            invalidationCondition: 'Price drops below micro-support or creator dumps supply',
            recommendedMaxRiskUsd: input.riskEvaluation?.maxRiskUsd ?? 100,
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
        };
        this.decisions.set(decisionId, decision);
        return Object.freeze(decision);
    }
    getDecision(decisionId) {
        return this.decisions.get(decisionId);
    }
}
export class UnifiedDecisionBuilder {
    static fromSpieEvaluation(opportunityId, slot, evalResult, options) {
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
//# sourceMappingURL=unified-decision.js.map