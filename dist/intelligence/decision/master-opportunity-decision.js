/**
 * SOL-SYLPH Intelligence Fabric - Master Opportunity Decision
 * Specifications: Master Blueprint Section 97 & 25 (Capturability-X).
 *
 * Implements:
 * 1. Research-only diagnostic: summarizes intelligence vectors without calibrated
 *    probabilities, expected values, or execution approval:
 *    - Token truth & Token-2022 semantics
 *    - Entity control & Sybil clustering
 *    - Market authenticity & manipulation resistance
 *    - Lifecycle phase & competing transition hazards
 *    - Capital flow velocity & acceleration derivatives
 *    - Market grammar motifs & latent state probabilities
 *    - Uncalibrated multiplier heuristic scores
 *    - Stressed exitability capacity & liquidity fracture
 *    - Model failure predictor & uncertainty conformal confidence
 *    - Capturable EV unavailable until calibrated outcomes and execution evidence exist
 * 2. Enforces Invariant:
 *    OpportunityDecision != ExecutionPermit.
 *    Models advise; only deterministic authority issues execution permits.
 */
import { createHash } from 'node:crypto';
export class MasterOpportunityDecisionEngine {
    /**
     * Summarizes decoupled intelligence vectors into a non-authorizing research diagnostic.
     */
    static evaluateOpportunity(params) {
        if (typeof params.candidateId !== 'string' || !params.candidateId.trim() ||
            typeof params.mint !== 'string' || !params.mint.trim() ||
            !Number.isSafeInteger(params.slot) || params.slot < 0 ||
            !Number.isFinite(params.proposedSizeSol ?? 1.0) || (params.proposedSizeSol ?? 1.0) <= 0) {
            throw new Error('INVALID_OPPORTUNITY_DECISION_CONTEXT');
        }
        const { candidateId, mint, slot, tokenSemanticRoot, authenticityCertificate, lifecycleState, capitalFlowState, marketGrammarState, multiplierResearch, exitabilityCertificate, proposedSizeSol = 1.0, } = params;
        const evaluatedAtMs = Date.now();
        const disqualificationReasons = [];
        // 1. Semantic Check
        if (!tokenSemanticRoot.isSellPathFeasible) {
            disqualificationReasons.push(`SELL_PATH_BLOCKED: ${tokenSemanticRoot.sellPathRiskFactors.join('; ')}`);
        }
        // 2. Authenticity Check
        if (!authenticityCertificate.isApprovedForCapital) {
            disqualificationReasons.push(`UNAUTHENTIC_MARKET: ${authenticityCertificate.disqualificationReasons.join('; ')}`);
        }
        // 3. Exitability Check
        if (!exitabilityCertificate.isApprovedForExecution) {
            disqualificationReasons.push(`UNEXITABLE_LIQUIDITY: ${exitabilityCertificate.rationale}`);
        }
        // Heuristic scores are not calibrated hazards; keep them out of probability thresholds.
        if (multiplierResearch.status !== 'UNCALIBRATED_RESEARCH_HEURISTIC') {
            disqualificationReasons.push('INVALID_MULTIPLIER_RESEARCH_ASSESSMENT');
        }
        disqualificationReasons.push('CALIBRATED_OUTCOME_AND_EXECUTION_EVIDENCE_UNAVAILABLE');
        // 5. Flow Toxicity Check
        if (capitalFlowState.toxicity > 0.60) {
            disqualificationReasons.push(`HOSTILE_FLOW_TOXICITY: Flow toxicity=${capitalFlowState.toxicity} > 0.60`);
        }
        const maximumSafeExposureSol = Math.min(proposedSizeSol, exitabilityCertificate.maxSafePositionSol);
        const decisionId = `dec_${mint.slice(0, 8)}_${slot}_${evaluatedAtMs}`;
        const decisionDigest = createHash('sha256')
            .update('OPPORTUNITY_DECISION:')
            .update(decisionId)
            .update(tokenSemanticRoot.semanticHash)
            .update(authenticityCertificate.evidenceHash)
            .update(lifecycleState.stateDigest)
            .update(capitalFlowState.stateDigest)
            .update(marketGrammarState.grammarDigest)
            .update(multiplierResearch.diagnosticDigest)
            .update(exitabilityCertificate.certificateHash)
            .update('CALIBRATED_OUTCOME_AND_EXECUTION_EVIDENCE_UNAVAILABLE')
            .digest('hex');
        return {
            decisionId,
            candidateId,
            mint,
            evaluatedAtMs,
            observationSlot: slot,
            tokenSemanticRoot,
            authenticityCertificate,
            lifecycleState,
            capitalFlowState,
            marketGrammarState,
            multiplierResearch,
            exitabilityCertificate,
            pEntryLand: null,
            pExitLand: null,
            expectedEntrySlippageBps: null,
            expectedExitSlippageBps: null,
            expectedCapturedMultiple: null,
            expectedAfterCostEvSol: null,
            maximumSafeExposureSol,
            decisionStatus: 'RESEARCH_ONLY_UNCALIBRATED',
            disqualificationReasons: Object.freeze(disqualificationReasons),
            decisionDigest,
        };
    }
}
//# sourceMappingURL=master-opportunity-decision.js.map