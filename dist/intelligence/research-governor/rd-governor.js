/**
 * SYLPH FUSION — AUTONOMOUS R&D GOVERNOR-X
 * Specifications: Master Blueprint Section 40, LII, LIII, LIV, LV
 *
 * Invariants:
 * 1. Hypotheses register strictly as UNTESTED with zero assumed Sharpe.
 * 2. States must advance strictly one legal step at a time:
 *    UNTESTED -> REPLAY_TESTED -> SHADOW_TESTED -> CANARY_TESTED -> GRADUATED.
 *    Direct jumps (e.g. UNTESTED -> GRADUATED) are strictly rejected.
 * 3. Proposer cannot verify or promote itself (SELF_PROMOTION_FORBIDDEN).
 * 4. Requires valid cryptographic promotion evidence bundle.
 */
import { validatePromotionEvidence } from './promotion-evidence-bundle.js';
const LEGAL_PROMOTION_STEP = {
    UNTESTED: 'REPLAY_TESTED',
    REPLAY_TESTED: 'SHADOW_TESTED',
    SHADOW_TESTED: 'CANARY_TESTED',
    CANARY_TESTED: 'GRADUATED',
    GRADUATED: 'GRADUATED',
    FALSIFIED: 'FALSIFIED',
};
export class AutonomousRDGovernorX {
    hypotheses = new Map();
    registerHypothesis(hypothesis) {
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
        if (!hyp) {
            return { promoted: false, reason: `UNKNOWN_HYPOTHESIS: ${hypothesisId}` };
        }
        // 1. Invariant LIII: Proposer cannot verify or promote itself
        const effectiveProposer = evidence.proposerAgentId ?? hyp.proposerAgentId;
        if (evidence.independentVerifierAgentId === effectiveProposer) {
            return {
                promoted: false,
                reason: `SELF_PROMOTION_FORBIDDEN: Proposer ${effectiveProposer} cannot act as verifier for its own hypothesis`,
            };
        }
        // 2. Handle terminal / falsified states
        if (targetState === 'FALSIFIED') {
            this.hypotheses.set(hypothesisId, {
                ...hyp,
                state: 'FALSIFIED',
            });
            return { promoted: true };
        }
        // 3. Invariant: Enforce single-step progression
        const expectedTarget = LEGAL_PROMOTION_STEP[hyp.state];
        if (targetState !== expectedTarget) {
            return {
                promoted: false,
                reason: `ILLEGAL_STATE_ADVANCEMENT: Cannot transition from ${hyp.state} to ${targetState}; must advance to ${expectedTarget}`,
            };
        }
        if (evidence.hypothesisId !== hypothesisId) {
            return {
                promoted: false,
                reason: `HYPOTHESIS_ID_MISMATCH: Evidence for ${evidence.hypothesisId} submitted for ${hypothesisId}`,
            };
        }
        if (evidence.targetState !== targetState) {
            return {
                promoted: false,
                reason: `TARGET_STATE_MISMATCH: Evidence targets ${evidence.targetState} but request specifies ${targetState}`,
            };
        }
        // 4. Verify cryptographic evidence bundle
        const validation = validatePromotionEvidence(evidence, hyp.proposerAgentId);
        if (!validation.isEligibleForPromotion) {
            return { promoted: false, reason: validation.reason };
        }
        // 5. Update state
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