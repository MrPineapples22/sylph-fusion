/**
 * SOL-SYLPH System Integrity Certificate & Health Engine
 * Blueprint Parts LXXII, LXXIII, LXXIV
 *
 * Separates TokenConfidence from SystemConfidence.
 * A strong token must NEVER override a weak system.
 */
export class SystemIntegrityEngine {
    currentEpoch = 1;
    currentMode = 'NORMAL';
    lastCertificate;
    evaluateIntegrity(checks) {
        const fullChecks = {
            rpcQuorum: checks.rpcQuorum ?? true,
            eventContinuity: checks.eventContinuity ?? true,
            decoderHealth: checks.decoderHealth ?? true,
            stateDeterminism: checks.stateDeterminism ?? true,
            executionReconciled: checks.executionReconciled ?? true,
            portfolioLedgerIntegrity: checks.portfolioLedgerIntegrity ?? true,
            clockHealth: checks.clockHealth ?? true,
            persistenceHealth: checks.persistenceHealth ?? true,
            queueHealth: checks.queueHealth ?? true,
        };
        const failedChecks = [];
        if (!fullChecks.rpcQuorum)
            failedChecks.push('RPC_QUORUM_FAIL');
        if (!fullChecks.eventContinuity)
            failedChecks.push('EVENT_CONTINUITY_GAP');
        if (!fullChecks.decoderHealth)
            failedChecks.push('DECODER_PARSE_ERROR');
        if (!fullChecks.stateDeterminism)
            failedChecks.push('STATE_DETERMINISM_MISMATCH');
        if (!fullChecks.executionReconciled)
            failedChecks.push('EXECUTION_UNRECONCILED');
        if (!fullChecks.portfolioLedgerIntegrity)
            failedChecks.push('PORTFOLIO_LEDGER_CORRUPT');
        if (!fullChecks.clockHealth)
            failedChecks.push('CLOCK_SKEW_EXCESSIVE');
        if (!fullChecks.persistenceHealth)
            failedChecks.push('PERSISTENCE_UNAVAILABLE');
        if (!fullChecks.queueHealth)
            failedChecks.push('BACKPRESSURE_QUEUE_SATURATED');
        // Critical vs optional failures
        const criticalFailures = failedChecks.filter(f => f === 'RPC_QUORUM_FAIL' ||
            f === 'STATE_DETERMINISM_MISMATCH' ||
            f === 'PORTFOLIO_LEDGER_CORRUPT' ||
            f === 'CLOCK_SKEW_EXCESSIVE');
        let status = 'VALID';
        let mode = 'NORMAL';
        let executionPermitted = true;
        let systemConfidence = 1.0;
        if (criticalFailures.length > 0) {
            status = 'INVALID';
            mode = 'SAFE_MODE';
            executionPermitted = false;
            systemConfidence = 0.0;
        }
        else if (failedChecks.length > 0) {
            status = 'DEGRADED';
            mode = 'DEGRADED';
            executionPermitted = failedChecks.length <= 1 && fullChecks.executionReconciled;
            systemConfidence = Math.max(0.3, 1.0 - (failedChecks.length * 0.2));
        }
        this.currentMode = mode;
        const cert = {
            certificateId: `sic_${Date.now()}_${this.currentEpoch}`,
            timestampMs: Date.now(),
            status,
            operationalMode: mode,
            systemConfidence,
            checks: fullChecks,
            failedChecks,
            executionPermitted,
            issuedEpoch: this.currentEpoch,
        };
        this.lastCertificate = cert;
        return cert;
    }
    advanceEpoch() {
        this.currentEpoch++;
        return this.currentEpoch;
    }
    getCurrentEpoch() {
        return this.currentEpoch;
    }
    getOperationalMode() {
        return this.currentMode;
    }
    getLastCertificate() {
        return this.lastCertificate ?? this.evaluateIntegrity({});
    }
}
//# sourceMappingURL=system-integrity.js.map