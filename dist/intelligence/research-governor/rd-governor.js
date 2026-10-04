/**
 * SYLPH FUSION — AUTONOMOUS R&D GOVERNOR-X
 * Specifications: Master Blueprint Section LII, LIII, LIV, LV
 */
import { validatePromotionEvidence } from './promotion-evidence-bundle.js';
export class AutonomousRDGovernorX {
    hypotheses = new Map();
    registerHypothesis(hypothesis) {
        // Invariant: hypotheses must register as UNTESTED
        if (hypothesis.state !== 'UNTESTED') {
            throw new Error(`INVARIANT_VIOLATION: Hypothesis ${hypothesis.hypothesisId} must register as UNTESTED, attempted ${hypothesis.state}`);
        }
        this.hypotheses.set(hypothesis.hypothesisId, hypothesis);
    }
    getHypothesis(hypothesisId) {
        return this.hypotheses.get(hypothesisId);
    }
    promoteHypothesis(hypothesisId, targetState, evidence) {
        const hyp = this.hypotheses.get(hypothesisId);
        if (!hyp)
            return { promoted: false, reason: `UNKNOWN_HYPOTHESIS: ${hypothesisId}` };
        // Verify independent evidence bundle
        const validation = validatePromotionEvidence(evidence, hyp.proposerAgentId);
        if (!validation.isEligibleForPromotion) {
            return { promoted: false, reason: validation.reason };
        }
        // Update state
        this.hypotheses.set(hypothesisId, {
            ...hyp,
            state: targetState,
            outOfSampleSampleSize: evidence.outOfSampleSampleSize,
            observedSharpe: evidence.counterfactualSharpe,
        });
        return { promoted: true };
    }
}
//# sourceMappingURL=rd-governor.js.map