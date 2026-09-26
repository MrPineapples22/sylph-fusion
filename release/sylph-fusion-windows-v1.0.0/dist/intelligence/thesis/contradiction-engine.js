/**
 * SOL-SYLPH Contradiction Engine & Events
 * Blueprint Part XLVIII
 *
 * Every contradictory observation generates an immutable ContradictionEvent:
 * affected thesis, affected assumption, new evidence, previous evidence,
 * severity (MINOR, MATERIAL, CRITICAL), confidence, slot, downstream actions.
 */
export class ContradictionEngine {
    events = [];
    recordContradiction(params) {
        const now = Date.now();
        let action = 'LOG_ONLY';
        if (params.severity === 'CRITICAL') {
            action = 'IMMEDIATE_RISK_REVOCATION';
        }
        else if (params.severity === 'MATERIAL') {
            action = 'REVALIDATE_THESIS';
        }
        const event = {
            eventId: `contra_${params.mint.slice(0, 6)}_${now}`,
            mint: params.mint,
            thesisId: params.thesisId,
            assumptionId: params.assumptionId,
            previousEvidence: params.previousEvidence,
            newEvidence: params.newEvidence,
            severity: params.severity,
            confidence: params.confidence ?? 0.9,
            slot: params.slot ?? 0,
            timestampMs: now,
            downstreamActionRequired: action,
        };
        this.events.push(event);
        if (this.events.length > 1000)
            this.events.shift();
        return event;
    }
    getEventsForToken(mint) {
        return this.events.filter(e => e.mint === mint);
    }
    hasCriticalContradictions(mint) {
        return this.events.some(e => e.mint === mint && e.severity === 'CRITICAL');
    }
}
//# sourceMappingURL=contradiction-engine.js.map