/**
 * SOL-SYLPH Intelligence Fabric - Meta-Intelligence & Runtime Assurance Controller
 * Specifications: Parts LXXXI (Meta-Intelligence), LXXXII (System Trust Vector),
 * LXXXIII (System Operational States), LXXXIV (Runtime Assurance),
 * LXXXV (Decision Provenance DAG), LXXXVI (Taint Propagation),
 * XCI (Causal RCA), XCIII (Economic Observability), XCVIII (Flight Recorder).
 */
export class MetaIntelligenceController {
    flightRecorder = [];
    taintedArtifactIds = new Set();
    executionEconomicsHistory = [];
    /**
     * Evaluate the 14-dimension System Trust Vector and non-compensatory operational state.
     */
    evaluateSystemTrust(params) {
        const { rpcHealthy, feedFreshnessMs, queueDepth, activeViolationsCount, calibrationBrierScore, oodScore, failedExecutionsCount, unreconciledEventsCount, } = params;
        const known = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
        const dataFresh = !known(feedFreshnessMs) ? null : feedFreshnessMs <= 1000 ? 100 : Math.max(0, 100 - (feedFreshnessMs - 1000) / 40);
        const dataIntegrity = typeof rpcHealthy !== 'boolean' ? null : rpcHealthy ? 98 : 30;
        const eventCompleteness = !known(unreconciledEventsCount) ? null : unreconciledEventsCount === 0 ? 100 : Math.max(20, 100 - unreconciledEventsCount * 15);
        const stateConsistency = !known(unreconciledEventsCount) ? null : unreconciledEventsCount === 0 ? 100 : 60;
        const graphReliability = 92;
        const featureReliability = 95;
        const modelCompetence = (calibrationBrierScore !== null && calibrationBrierScore < 0.20) ? 90 : 60;
        const calibrationHealth = (calibrationBrierScore !== null && calibrationBrierScore < 0.15) ? 95 : 65;
        const regimeCertainty = 85;
        const decisionIntegrity = !known(activeViolationsCount) ? null : activeViolationsCount === 0 ? 100 : 0;
        const portfolioIntegrity = known(activeViolationsCount) && activeViolationsCount > 0 ? 40 : 100;
        const executionHealth = !known(failedExecutionsCount) ? null : failedExecutionsCount === 0 ? 100 : Math.max(20, 100 - failedExecutionsCount * 25);
        const infraHealth = !known(queueDepth) ? null : queueDepth < 100 ? 98 : Math.max(20, 100 - queueDepth * 0.5);
        const noveltyPressure = known(oodScore) && oodScore <= 1 ? Math.round(oodScore * 100) : null;
        const vector = {
            dataIntegrity,
            dataFreshness: dataFresh === null ? null : Math.round(dataFresh),
            eventCompleteness,
            stateConsistency,
            graphReliability,
            featureReliability,
            modelCompetence,
            calibrationHealth,
            regimeCertainty,
            decisionIntegrity,
            portfolioIntegrity,
            executionHealth,
            infrastructureHealth: infraHealth === null ? null : Math.round(infraHealth),
            noveltyPressure,
        };
        // Non-compensatory operational state derivation:
        // Corrupted data or critical invariant violations cannot be compensated by good model scores
        const reasons = [];
        let state = 'HEALTHY';
        if (known(activeViolationsCount) && activeViolationsCount > 0) {
            state = 'HALTED';
            reasons.push('CRITICAL: Risk invariant violated');
        }
        else if (rpcHealthy === false || (dataFresh !== null && dataFresh < 30)) {
            state = 'HALTED';
            reasons.push('CRITICAL: Market data stream lost or RPC quorum failure');
        }
        else if (known(failedExecutionsCount) && failedExecutionsCount >= 3) {
            state = 'OBSERVE_ONLY';
            reasons.push('WARNING: Repeated execution failures detected');
        }
        else if ((dataFresh !== null && dataFresh < 70) || (infraHealth !== null && infraHealth < 60)) {
            state = 'DEGRADED';
            reasons.push('NOTICE: Feed latency or queue pressure degraded');
        }
        else if (noveltyPressure !== null && noveltyPressure >= 75) {
            state = 'CAUTIOUS';
            reasons.push('NOTICE: Novel market conditions or calibration drift');
        }
        const unavailableMetrics = Object.entries(vector).filter(([, value]) => value === null).map(([key]) => key);
        const inputs = { rpcHealthy, feedFreshnessMs, queueDepth, activeViolationsCount, calibrationBrierScore, oodScore, failedExecutionsCount, unreconciledEventsCount };
        const inputProvenance = Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key,
            (typeof value === 'boolean' || known(value)) ? 'CALLER_REPORTED' : 'UNAVAILABLE',
        ]));
        return { state, vector, reasons, inputs, inputProvenance, evidenceStatus: unavailableMetrics.length === 0 ? 'KNOWN' : 'MISSING', validationSource: null,
            authority: 'ASSESSMENT_ONLY', unavailableMetrics, reason: unavailableMetrics.length === 0 ? 'VALIDATION_EVIDENCE_HEALTHY' : 'NO_TRUSTED_RUNTIME_VALIDATION_EVIDENCE' };
    }
    /**
     * Runtime Assurance: Independent pre-flight check before capital commitment.
     */
    generateAssuranceCase(params) {
        const { decisionId, mint, operationalState, trustVector, provenanceChain } = params;
        const unavailableMetrics = Object.entries(trustVector).filter(([, value]) => value === null || !Number.isFinite(value)).map(([key]) => key);
        const blocking = [];
        const warnings = [];
        if (operationalState === 'HALTED') {
            blocking.push('System operational state is HALTED');
        }
        if (operationalState === 'OBSERVE_ONLY') {
            blocking.push('System operational state is OBSERVE_ONLY');
        }
        if (trustVector.dataFreshness !== null && trustVector.dataFreshness < 50) {
            blocking.push('Underlying market data is stale');
        }
        if (trustVector.portfolioIntegrity !== null && trustVector.portfolioIntegrity < 50) {
            blocking.push('Portfolio risk constraints breached');
        }
        if (trustVector.noveltyPressure !== null && trustVector.noveltyPressure > 80) {
            warnings.push('High novelty / OOD situation');
        }
        const isAuthorized = blocking.length === 0 && (operationalState === 'HEALTHY' || operationalState === 'CAUTIOUS');
        const validScores = [
            trustVector.dataIntegrity,
            trustVector.dataFreshness,
            trustVector.decisionIntegrity,
            trustVector.executionHealth,
        ].filter((v) => v !== null);
        const assuranceScore = validScores.length > 0
            ? Number((validScores.reduce((a, b) => a + b, 0) / (validScores.length * 100)).toFixed(3))
            : 0;
        return {
            decisionId,
            mint,
            operationalState,
            isAuthorizedForExecution: isAuthorized,
            assuranceScore,
            evidenceStatus: isAuthorized ? 'KNOWN' : 'MISSING',
            validationSource: null,
            authority: 'ASSESSMENT_ONLY',
            unavailableMetrics,
            reason: isAuthorized ? 'ASSURANCE_CASE_VALIDATED' : 'BLOCKING_INVARIANTS_PRESENT',
            blockingInvariants: blocking,
            warnings,
            trustVector,
            provenanceChain,
            timestampMs: Date.now(),
        };
    }
    /**
     * Taint Propagation: Marks downstream artifacts if an upstream source is invalidated.
     */
    markTainted(artifactId) {
        this.taintedArtifactIds.add(artifactId);
    }
    isTainted(artifactId) {
        return this.taintedArtifactIds.has(artifactId);
    }
    /**
     * Incident Flight Recorder
     */
    recordFlightEvent(record) {
        this.flightRecorder.push(record);
        if (this.flightRecorder.length > 1000) {
            this.flightRecorder.shift();
        }
    }
    getFlightRecorderLog() {
        return this.flightRecorder;
    }
    /**
     * Economic Observability & Edge Leakage Decomposition
     */
    recordExecutionEconomics(data) {
        this.executionEconomicsHistory.push(data);
        if (this.executionEconomicsHistory.length > 200) {
            this.executionEconomicsHistory.shift();
        }
    }
    getEdgeLeakageSummary() {
        if (this.executionEconomicsHistory.length === 0) {
            return {
                meanExpectedEdgePct: 0,
                meanRealizedEdgePct: 0,
                meanEdgeLeakagePct: 0,
                meanSlippageBps: 0,
                meanLatencyMs: 0,
            };
        }
        const n = this.executionEconomicsHistory.length;
        const exp = this.executionEconomicsHistory.reduce((s, e) => s + e.expectedEdgePct, 0) / n;
        const real = this.executionEconomicsHistory.reduce((s, e) => s + e.realizedEdgePct, 0) / n;
        const slip = this.executionEconomicsHistory.reduce((s, e) => s + e.slippageBps, 0) / n;
        const lat = this.executionEconomicsHistory.reduce((s, e) => s + e.latencyMs, 0) / n;
        return {
            meanExpectedEdgePct: Number(exp.toFixed(2)),
            meanRealizedEdgePct: Number(real.toFixed(2)),
            meanEdgeLeakagePct: Number((exp - real).toFixed(2)),
            meanSlippageBps: Math.round(slip),
            meanLatencyMs: Math.round(lat),
        };
    }
}
//# sourceMappingURL=meta-intelligence.js.map