/**
 * WATSON: System Self-Diagnosis & Root-Cause Explainability Engine
 * Blueprint Engine #40
 *
 * Unifies logs, telemetry, and distributed trace IDs to reconstruct causal event chains.
 * Answers authoritatively:
 * - "WHY DID THIS TRADE?"
 * - "WHY WAS THIS FILTERED?"
 * - "WHY IS LIQUIDITY STALE?"
 * - "WHAT IS THE ROOT CAUSE?"
 */
export class WatsonSystemDiagnosisEngine {
    static VERSION = '1.0.0';
    traceHistory = new Map(); // token_id -> records
    recordTrace(record) {
        const list = this.traceHistory.get(record.token_id) ?? [];
        list.push(record);
        // Keep max 200 traces per token to prevent unbounded memory growth
        if (list.length > 200) {
            list.shift();
        }
        this.traceHistory.set(record.token_id, list);
    }
    /**
     * Explains why a token was filtered, halted, or traded.
     */
    diagnose(tokenId, questionType) {
        const records = this.traceHistory.get(tokenId) ?? [];
        if (records.length === 0) {
            return {
                trace_id: `trace_diag_${Date.now()}`,
                token_id: tokenId,
                question: questionType,
                root_cause: `No historical traces recorded for token ${tokenId}.`,
                causal_chain: [],
                confidence: 0.2
            };
        }
        // Find decisive trace record
        if (questionType === 'WHY_FILTERED') {
            const filterTrace = records.slice().reverse().find(r => r.outcome === 'FILTERED' || r.outcome === 'HALTED');
            if (filterTrace) {
                return {
                    trace_id: filterTrace.trace_id,
                    token_id: tokenId,
                    question: questionType,
                    root_cause: `Filtered at phase [${filterTrace.phase}]: ${filterTrace.explanation}`,
                    causal_chain: records,
                    confidence: 0.95,
                    recommended_remedy: filterTrace.metadata?.remedy ?? 'Review gating parameter or wait for fresh on-chain data.'
                };
            }
        }
        if (questionType === 'WHY_TRADED') {
            const execTrace = records.slice().reverse().find(r => r.outcome === 'EXECUTED');
            if (execTrace) {
                return {
                    trace_id: execTrace.trace_id,
                    token_id: tokenId,
                    question: questionType,
                    root_cause: `Trade executed: ${execTrace.explanation}`,
                    causal_chain: records,
                    confidence: 0.98
                };
            }
        }
        // Default root cause diagnosis: look for latest terminal or anomalous event
        const lastRecord = records[records.length - 1];
        return {
            trace_id: lastRecord.trace_id,
            token_id: tokenId,
            question: questionType,
            root_cause: `Latest state [${lastRecord.phase}]: ${lastRecord.explanation}`,
            causal_chain: records,
            confidence: 0.80
        };
    }
}
//# sourceMappingURL=watson-diagnosis.js.map