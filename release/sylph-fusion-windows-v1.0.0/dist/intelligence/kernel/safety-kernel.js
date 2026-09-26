/**
 * SOL-SYLPH Deterministic Safety Kernel
 * Blueprint Part LXV
 *
 * Architecture:
 * INTELLIGENCE → DECISION POLICY → SAFETY KERNEL → EXECUTION ENGINE
 *
 * Sits strictly between Decision Policies and Execution. AI models cannot bypass it.
 * Owns non-negotiable execution invariants.
 */
export class SafetyKernel {
    invariants;
    constructor(customInvariants) {
        this.invariants = {
            maxOrderSizeSol: 2.5,
            maxPortfolioTotalExposureSol: 10.0,
            maxSlippageBps: 500,
            maxQuoteAgeMs: 5000,
            requireProof3of3: true,
            forbidActiveFreeze: true,
            forbidPermanentDelegate: true,
            requireNonNegativeDtf: true,
            ...customInvariants,
        };
    }
    verifyExecutionIntent(params) {
        const violations = [];
        // Invariant 1: Order size limit
        if (params.orderSizeSol > this.invariants.maxOrderSizeSol) {
            violations.push(`ORDER_SIZE_EXCEEDS_LIMIT: ${params.orderSizeSol} > ${this.invariants.maxOrderSizeSol} SOL`);
        }
        // Invariant 2: Total portfolio exposure limit
        if (params.currentPortfolioExposureSol + params.orderSizeSol > this.invariants.maxPortfolioTotalExposureSol) {
            violations.push(`PORTFOLIO_EXPOSURE_EXCEEDED: ${params.currentPortfolioExposureSol + params.orderSizeSol} > ${this.invariants.maxPortfolioTotalExposureSol} SOL`);
        }
        // Invariant 3: Quote staleness
        if (params.quoteAgeMs > this.invariants.maxQuoteAgeMs) {
            violations.push(`QUOTE_TOO_STALE: ${params.quoteAgeMs}ms > ${this.invariants.maxQuoteAgeMs}ms`);
        }
        // Invariant 4: Slippage limit
        if (params.slippageBps > this.invariants.maxSlippageBps) {
            violations.push(`SLIPPAGE_EXCESSIVE: ${params.slippageBps}bps > ${this.invariants.maxSlippageBps}bps`);
        }
        // Invariant 5: Proof State
        if (this.invariants.requireProof3of3 && params.proofState !== '3/3') {
            violations.push(`PROOF_STATE_INVALID: Required 3/3, got ${params.proofState}`);
        }
        // Invariant 6: Structural freeze authority
        if (this.invariants.forbidActiveFreeze && params.hasFreezeAuthority) {
            violations.push('ACTIVE_FREEZE_AUTHORITY_PRESENT');
        }
        // Invariant 7: Permanent delegate backdoor
        if (this.invariants.forbidPermanentDelegate && params.hasPermanentDelegate) {
            violations.push('PERMANENT_DELEGATE_BACKDOOR_PRESENT');
        }
        // Invariant 8: Distance to Failure
        if (this.invariants.requireNonNegativeDtf && params.distanceToFailure <= 0.05) {
            violations.push(`DTF_BREACH: Distance to failure ${params.distanceToFailure} <= 0.05`);
        }
        // Invariant 9: System Integrity
        if (!params.systemIntegrityValid) {
            violations.push('SYSTEM_INTEGRITY_CERTIFICATE_INVALID');
        }
        return {
            passed: violations.length === 0,
            violatedInvariants: violations,
            evaluatedAtMs: Date.now(),
            permitIssuanceAllowed: violations.length === 0,
        };
    }
    getInvariants() {
        return { ...this.invariants };
    }
}
//# sourceMappingURL=safety-kernel.js.map