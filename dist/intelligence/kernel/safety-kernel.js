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
        const portfolioViolations = [];
        const executionViolations = [];
        const tokenSafetyViolations = [];
        const systemViolations = [];
        // Invariant 1: Order size limit (Execution)
        if (params.orderSizeSol > this.invariants.maxOrderSizeSol) {
            executionViolations.push(`ORDER_SIZE_EXCEEDS_LIMIT: ${params.orderSizeSol} > ${this.invariants.maxOrderSizeSol} SOL`);
        }
        // Invariant 2: Total portfolio exposure limit (Portfolio)
        if (params.currentPortfolioExposureSol + params.orderSizeSol > this.invariants.maxPortfolioTotalExposureSol) {
            portfolioViolations.push(`PORTFOLIO_EXPOSURE_EXCEEDED: ${params.currentPortfolioExposureSol + params.orderSizeSol} > ${this.invariants.maxPortfolioTotalExposureSol} SOL`);
        }
        // Invariant 3: Quote staleness (Execution)
        if (params.quoteAgeMs > this.invariants.maxQuoteAgeMs) {
            executionViolations.push(`QUOTE_TOO_STALE: ${params.quoteAgeMs}ms > ${this.invariants.maxQuoteAgeMs}ms`);
        }
        // Invariant 4: Slippage limit (Execution)
        if (params.slippageBps > this.invariants.maxSlippageBps) {
            executionViolations.push(`SLIPPAGE_EXCESSIVE: ${params.slippageBps}bps > ${this.invariants.maxSlippageBps}bps`);
        }
        // Invariant 5: Proof State (Execution Precondition)
        if (this.invariants.requireProof3of3 && params.proofState !== '3/3') {
            executionViolations.push(`PROOF_STATE_INVALID: Required 3/3, got ${params.proofState}`);
        }
        // Invariant 6: Structural freeze authority (Token Safety)
        if (this.invariants.forbidActiveFreeze && params.hasFreezeAuthority) {
            tokenSafetyViolations.push('ACTIVE_FREEZE_AUTHORITY_PRESENT');
        }
        // Invariant 7: Permanent delegate backdoor (Token Safety)
        if (this.invariants.forbidPermanentDelegate && params.hasPermanentDelegate) {
            tokenSafetyViolations.push('PERMANENT_DELEGATE_BACKDOOR_PRESENT');
        }
        // Invariant 8: Distance to Failure (Portfolio / Risk)
        if (this.invariants.requireNonNegativeDtf && params.distanceToFailure <= 0.05) {
            portfolioViolations.push(`DTF_BREACH: Distance to failure ${params.distanceToFailure} <= 0.05`);
        }
        // Invariant 9: System Integrity (System)
        if (!params.systemIntegrityValid) {
            systemViolations.push('SYSTEM_INTEGRITY_CERTIFICATE_INVALID');
        }
        const allViolations = [
            ...portfolioViolations,
            ...executionViolations,
            ...tokenSafetyViolations,
            ...systemViolations,
        ];
        const domains = {
            tokenSafety: tokenSafetyViolations.length === 0 ? 'PASS' : 'FAIL',
            portfolio: portfolioViolations.length === 0 ? 'PASS' : 'FAIL',
            execution: executionViolations.length === 0 ? 'PASS' : 'FAIL',
            system: systemViolations.length === 0 ? 'PASS' : 'FAIL',
        };
        return {
            passed: allViolations.length === 0,
            violatedInvariants: allViolations,
            portfolioViolations,
            executionViolations,
            tokenSafetyViolations,
            systemViolations,
            domains,
            evaluatedAtMs: Date.now(),
            permitIssuanceAllowed: allViolations.length === 0,
        };
    }
    getInvariants() {
        return { ...this.invariants };
    }
}
//# sourceMappingURL=safety-kernel.js.map