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
        const dataFresh = feedFreshnessMs <= 1000 ? 100 : Math.max(0, 100 - (feedFreshnessMs - 1000) / 40);
        const dataIntegrity = rpcHealthy ? 98 : 30;
        const eventCompleteness = unreconciledEventsCount === 0 ? 100 : Math.max(20, 100 - unreconciledEventsCount * 15);
        const stateConsistency = unreconciledEventsCount === 0 ? 100 : 60;
        const graphReliability = 92;
        const featureReliability = 95;
        const modelCompetence = calibrationBrierScore < 0.20 ? 90 : 60;
        const calibrationHealth = calibrationBrierScore < 0.15 ? 95 : 65;
        const regimeCertainty = 85;
        const decisionIntegrity = activeViolationsCount === 0 ? 100 : 0;
        const portfolioIntegrity = activeViolationsCount === 0 ? 100 : 40;
        const executionHealth = failedExecutionsCount === 0 ? 100 : Math.max(20, 100 - failedExecutionsCount * 25);
        const infraHealth = queueDepth < 100 ? 98 : Math.max(20, 100 - queueDepth * 0.5);
        const noveltyPressure = Math.round(oodScore * 100);
        const vector = {
            dataIntegrity,
            dataFreshness: Math.round(dataFresh),
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
            infrastructureHealth: Math.round(infraHealth),
            noveltyPressure,
        };
        // Non-compensatory operational state derivation:
        // Corrupted data or critical invariant violations cannot be compensated by good model scores
        const reasons = [];
        let state = 'HEALTHY';
        if (activeViolationsCount > 0) {
            state = 'HALTED';
            reasons.push('CRITICAL: Risk invariant violated');
        }
        else if (!rpcHealthy || dataFresh < 30) {
            state = 'HALTED';
            reasons.push('CRITICAL: Market data stream lost or RPC quorum failure');
        }
        else if (failedExecutionsCount >= 3) {
            state = 'OBSERVE_ONLY';
            reasons.push('WARNING: Repeated execution failures detected');
        }
        else if (dataFresh < 70 || infraHealth < 60) {
            state = 'DEGRADED';
            reasons.push('NOTICE: Feed latency or queue pressure degraded');
        }
        else if (noveltyPressure >= 75 || calibrationHealth < 70) {
            state = 'CAUTIOUS';
            reasons.push('NOTICE: Novel market conditions or calibration drift');
        }
        return { state, vector, reasons };
    }
    /**
     * Runtime Assurance: Independent pre-flight check before capital commitment.
     */
    generateAssuranceCase(params) {
        const { decisionId, mint, operationalState, trustVector, provenanceChain } = params;
        const blocking = [];
        const warnings = [];
        if (operationalState === 'HALTED') {
            blocking.push('System operational state is HALTED');
        }
        if (operationalState === 'OBSERVE_ONLY') {
            blocking.push('System operational state is OBSERVE_ONLY');
        }
        if (trustVector.dataFreshness < 50) {
            blocking.push('Underlying market data is stale');
        }
        if (trustVector.portfolioIntegrity < 50) {
            blocking.push('Portfolio risk constraints breached');
        }
        if (trustVector.noveltyPressure > 80) {
            warnings.push('High novelty / OOD situation');
        }
        const isAuthorized = blocking.length === 0;
        const assuranceScore = Number(((trustVector.dataIntegrity +
            trustVector.dataFreshness +
            trustVector.decisionIntegrity +
            trustVector.executionHealth) /
            400).toFixed(3));
        return {
            decisionId,
            mint,
            operationalState,
            isAuthorizedForExecution: isAuthorized,
            assuranceScore,
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