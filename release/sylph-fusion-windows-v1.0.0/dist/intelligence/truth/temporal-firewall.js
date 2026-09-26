/**
 * SOL-SYLPH Master Production Intelligence - Temporal Firewall
 * Specifications: Section 8 (Temporal Firewall).
 *
 * Rules:
 * 1. Strictly enforces: information_available_time <= decision_time T.
 * 2. Prevents lookahead leakage through future prices, liquidity, wallet reputation, or outcome labels.
 * 3. Any violation throws TemporalLeakageError and halts decision authority immediately.
 */
export class TemporalLeakageError extends Error {
    constructor(message) {
        super(`TEMPORAL_FIREWALL_VIOLATION: ${message}`);
        this.name = 'TemporalLeakageError';
    }
}
export class TemporalFirewall {
    /**
     * Verify that an information artifact was strictly available on or before the decision point.
     */
    static assertAvailableBeforeDecision(artifact, context) {
        if (artifact.availableTimestampMs > context.decisionTimestampMs) {
            throw new TemporalLeakageError(`Information artifact ${artifact.artifactId} available at T=${artifact.availableTimestampMs} ms is AFTER decision time T=${context.decisionTimestampMs} ms (+${artifact.availableTimestampMs - context.decisionTimestampMs} ms lookahead leakage)`);
        }
        if (artifact.availableSlot > context.decisionSlot) {
            throw new TemporalLeakageError(`Information artifact ${artifact.artifactId} available at slot ${artifact.availableSlot} is AFTER decision slot ${context.decisionSlot} (+${artifact.availableSlot - context.decisionSlot} slots lookahead leakage)`);
        }
    }
    /**
     * Filter an array of items to ensure none violate the temporal boundary.
     */
    static filterPointInTime(artifacts, context) {
        return artifacts.filter((a) => a.availableTimestampMs <= context.decisionTimestampMs &&
            a.availableSlot <= context.decisionSlot);
    }
}
//# sourceMappingURL=temporal-firewall.js.map