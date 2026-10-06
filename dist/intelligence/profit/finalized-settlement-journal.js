import { snapshotFinalizedCostInput, } from './finalized-cost-ledger.js';
/**
 * Joins finalized paper settlement facts to the certificate's append-only
 * economic history. Both sinks are preflighted before either is mutated.
 */
export class FinalizedSettlementJournal {
    costs;
    events;
    constructor(costs, events) {
        this.costs = costs;
        this.events = events;
    }
    append(input) {
        const cost = snapshotFinalizedCostInput(input.cost);
        const provenanceInput = input.provenance;
        const provenanceFields = new Set(['source', 'sourceEventId', 'observedAtMs', 'receivedAtMs', 'revision']);
        if (typeof provenanceInput !== 'object' || provenanceInput === null ||
            (Object.getPrototypeOf(provenanceInput) !== Object.prototype && Object.getPrototypeOf(provenanceInput) !== null) ||
            Reflect.ownKeys(provenanceInput).some((key) => typeof key !== 'string' || !provenanceFields.has(key))) {
            throw new Error('SETTLEMENT_PROVENANCE_FIELDS_INVALID');
        }
        const provenance = Object.freeze({
            source: provenanceInput.source,
            sourceEventId: provenanceInput.sourceEventId,
            observedAtMs: provenanceInput.observedAtMs,
            receivedAtMs: provenanceInput.receivedAtMs,
            revision: provenanceInput.revision,
        });
        if (provenance.source !== cost.source || provenance.sourceEventId !== cost.sourceEventId) {
            throw new Error('SETTLEMENT_PROVENANCE_MISMATCH');
        }
        const preparedRecord = this.costs.prepare(cost);
        const eventInput = {
            certificateId: cost.certificateId,
            kind: 'SETTLEMENT',
            occurredAtMs: cost.finalizedAtMs,
            provenance,
            payload: Object.freeze({
                settlementId: cost.settlementId,
                finalizedCost: preparedRecord,
            }),
        };
        const preparedEvent = this.events.prepareAppend(eventInput);
        const record = this.costs.appendPrepared(preparedRecord);
        const event = this.events.appendPrepared(preparedEvent);
        return Object.freeze({ record, event });
    }
}
//# sourceMappingURL=finalized-settlement-journal.js.map