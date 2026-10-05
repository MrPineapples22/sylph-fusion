/**
 * SYLPH FUSION — CANONICAL TERMINALITY AUTHORITY
 * Specifications: Blueprint Section 24 (Terminality Authority)
 *
 * Invariant: Exactly one authority may issue terminal verdicts:
 *   LANDED_SUCCESS, LANDED_FAILED, CERTIFIED_NOLAND, EXPIRED_UNRESOLVED, DISPUTED.
 *
 * Witnesses (RPC, Janus, Jito, TRUTH-X, Archive) provide evidence; they cannot
 * self-certify terminality.
 */
import { createHash } from 'node:crypto';
export class TerminalityAuthority {
    issuedVerdicts = new Map();
    evaluateTerminality(params) {
        const { economicFactId, executionGenerationId, witnesses, noLandCertificate } = params;
        let terminalityState = 'UNKNOWN';
        let finalizedSlot;
        // 1. Check for confirmed/finalized landing
        const landedWitnesses = witnesses.filter((w) => w.observedStatus === 'FINALIZED' || w.observedStatus === 'CONFIRMED');
        if (landedWitnesses.length >= 2) {
            terminalityState = 'LANDED_SUCCESS';
            finalizedSlot = landedWitnesses[0].slot;
        }
        else if (noLandCertificate && noLandCertificate.conclusion === 'CERTIFIED_NOLAND') {
            terminalityState = 'CERTIFIED_NOLAND';
        }
        else if (params.lastValidBlockHeight !== undefined &&
            params.currentBlockHeight !== undefined &&
            params.currentBlockHeight > params.lastValidBlockHeight + 150n &&
            witnesses.every((w) => w.observedStatus === 'NOT_FOUND')) {
            // Historical absence without certified NoLand proof remains UNRESOLVED, NEVER assumed NoLand
            terminalityState = 'EXPIRED_UNRESOLVED';
        }
        const digest = createHash('sha256')
            .update(`${economicFactId}:${executionGenerationId}:${terminalityState}:${finalizedSlot?.toString() ?? 'none'}`)
            .digest('hex');
        const verdict = {
            verdictId: `term_verdict_${digest.slice(0, 16)}`,
            economicFactId,
            executionGenerationId,
            terminalityState,
            finalizedSlot,
            finalizedBlockHeight: params.currentBlockHeight,
            witnesses,
            noLandCertificate,
            verdictDigest: digest,
            issuedAtMs: Date.now(),
        };
        this.issuedVerdicts.set(executionGenerationId, verdict);
        return verdict;
    }
    getVerdict(executionGenerationId) {
        return this.issuedVerdicts.get(executionGenerationId);
    }
}
//# sourceMappingURL=terminality-authority.js.map