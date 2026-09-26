/**
 * SOL-SYLPH Master Production Intelligence - Independent Safety Monitor
 * Specifications: Sections 66 (Safety Monitor), 67 (Fail Closed for Capital).
 *
 * Rules:
 * 1. Independent daemon watching capital, positions, risk, data freshness, and chain state.
 * 2. Fail closed: Any critical safety violation instantly locks new capital authority.
 */
export class SafetyMonitor {
    lastVerdict;
    evaluate(inputs) {
        const now = Date.now();
        const violations = [...inputs.activeViolations];
        // 1. Capital Conservation Check
        if (!inputs.isConservationIdentityValid) {
            violations.push('CAPITAL_CONSERVATION_FAILURE: Total assets do not balance liabilities');
        }
        // 2. Reconciliation Check
        if (!inputs.isReconciliationClean) {
            violations.push('RECONCILIATION_FAILURE: Active discrepancy between ledger and blockchain');
        }
        // 3. RPC Quorum Health Check
        if (inputs.rpcHealthyCount < 1) {
            violations.push('RPC_FAILURE: Zero healthy RPC providers available');
        }
        // 4. Stale Quote Check
        if (inputs.maxQuoteAgeObservedMs > 2500) {
            violations.push(`DATA_FRESHNESS_FAILURE: Quote latency (${inputs.maxQuoteAgeObservedMs} ms) exceeds 2500 ms ceiling`);
        }
        // 5. Emergency Stop
        if (inputs.emergencyStopActive) {
            violations.push('OPERATOR_EMERGENCY_STOP: Global manual halt active');
        }
        const hasCritical = violations.length > 0;
        const status = hasCritical ? 'RED_LOCKED' : 'GREEN_OPERATIONAL';
        const verdict = {
            canAuthorizeNewCapital: !hasCritical, // Fail closed
            safetyStatus: status,
            activeViolations: violations,
            evaluatedAtMs: now,
        };
        this.lastVerdict = verdict;
        return verdict;
    }
    getLastVerdict() {
        return this.lastVerdict;
    }
}
//# sourceMappingURL=safety-monitor.js.map