/**
 * SYLPH FUSION — LATENCY BUDGET & STAGE PROFILER
 * Section XVII: Execution Latency Budget
 * Study 36: DECISION-TO-LANDING-X
 *
 * Deconstructs end-to-end latency across all 9 canonical stages:
 * Observation -> Features -> Decision -> Authority -> Build -> Sign -> Submit -> Landing -> Terminality
 * Pinpoints the true microsecond bottleneck so optimization targets real friction.
 */
export class LatencyBudgetProfiler {
    static profileTrace(trace) {
        const observationLatencyMs = Math.max(0, trace.featuresReadyAt - trace.observationAt);
        const featureLatencyMs = Math.max(0, trace.decisionAt - trace.featuresReadyAt);
        const decisionLatencyMs = Math.max(0, trace.permitIssuedAt - trace.decisionAt);
        const authorityLatencyMs = Math.max(0, trace.buildCompletedAt - trace.permitIssuedAt);
        const buildLatencyMs = Math.max(0, trace.signedAt - trace.buildCompletedAt);
        const signatureLatencyMs = Math.max(0, trace.submittedAt - trace.signedAt);
        const submissionLatencyMs = trace.firstProviderAckAt
            ? Math.max(0, trace.firstProviderAckAt - trace.submittedAt)
            : 0;
        const landingLatencyMs = trace.landedAt ? Math.max(0, trace.landedAt - trace.submittedAt) : undefined;
        const terminalityLatencyMs = (trace.terminalAt && trace.landedAt)
            ? Math.max(0, trace.terminalAt - trace.landedAt)
            : undefined;
        const totalDecisionToLandingMs = trace.landedAt
            ? Math.max(0, trace.landedAt - trace.decisionAt)
            : undefined;
        const totalEndToEndMs = trace.terminalAt
            ? Math.max(0, trace.terminalAt - trace.observationAt)
            : (trace.landedAt ? Math.max(0, trace.landedAt - trace.observationAt) : undefined);
        // Identify stage with greatest latency
        const stages = {
            OBSERVATION: observationLatencyMs,
            FEATURES: featureLatencyMs,
            DECISION: decisionLatencyMs,
            AUTHORITY: authorityLatencyMs,
            BUILD: buildLatencyMs,
            SIGNATURE: signatureLatencyMs,
            SUBMISSION: submissionLatencyMs,
            LANDING: landingLatencyMs ?? 0,
            TERMINALITY: terminalityLatencyMs ?? 0,
        };
        let bottleneck = 'NONE';
        let maxMs = -1;
        for (const [stage, ms] of Object.entries(stages)) {
            if (ms > maxMs) {
                maxMs = ms;
                bottleneck = stage;
            }
        }
        return {
            observationLatencyMs,
            featureLatencyMs,
            decisionLatencyMs,
            authorityLatencyMs,
            buildLatencyMs,
            signatureLatencyMs,
            submissionLatencyMs,
            landingLatencyMs,
            terminalityLatencyMs,
            totalDecisionToLandingMs,
            totalEndToEndMs,
            criticalBottleneckStage: bottleneck,
        };
    }
}
//# sourceMappingURL=latency-budget.js.map