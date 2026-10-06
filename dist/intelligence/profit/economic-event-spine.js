import { createHash } from 'node:crypto';
const GENESIS_HASH = '0'.repeat(64);
const canonicalize = (value) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const hash = (value) => createHash('sha256').update(canonicalize(value)).digest('hex');
function deepFreeze(value, seen = new WeakSet()) {
    if (typeof value !== 'object' || value === null || seen.has(value))
        return value;
    seen.add(value);
    for (const child of Object.values(value))
        deepFreeze(child, seen);
    return Object.freeze(value);
}
const timestamp = (name, value) => {
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error(`${name}_MUST_BE_SAFE_POSITIVE_INTEGER`);
};
function assertProvenance(provenance) {
    if (!provenance.source || !provenance.sourceEventId)
        throw new Error('PROVENANCE_SOURCE_AND_EVENT_ID_REQUIRED');
    timestamp('OBSERVED_AT', provenance.observedAtMs);
    timestamp('RECEIVED_AT', provenance.receivedAtMs);
    if (!Number.isSafeInteger(provenance.revision) || provenance.revision < 0)
        throw new Error('PROVENANCE_REVISION_INVALID');
    if (provenance.receivedAtMs < provenance.observedAtMs)
        throw new Error('PROVENANCE_RECEIVED_BEFORE_OBSERVED');
}
export function createOpportunitySetSnapshot(params) {
    if (!params.certificateId)
        throw new Error('CERTIFICATE_ID_REQUIRED');
    timestamp('DECIDED_AT', params.decidedAtMs);
    if (params.availableCapitalLamports < 0n)
        throw new Error('AVAILABLE_CAPITAL_MUST_BE_NON_NEGATIVE');
    const seen = new Set();
    for (const candidate of params.candidates) {
        if (!candidate.candidateId || seen.has(candidate.candidateId))
            throw new Error('OPPORTUNITY_CANDIDATE_ID_MUST_BE_UNIQUE');
        if (candidate.requiredCapitalLamports < 0n || !Number.isFinite(candidate.expectedLockSeconds) || candidate.expectedLockSeconds <= 0) {
            throw new Error('OPPORTUNITY_CANDIDATE_ECONOMICS_INVALID');
        }
        seen.add(candidate.candidateId);
    }
    const payload = {
        certificateId: params.certificateId,
        decidedAtMs: params.decidedAtMs,
        availableCapitalLamports: params.availableCapitalLamports.toString(),
        candidateIds: [...seen].sort(),
    };
    return { ...payload, availableCapitalLamports: params.availableCapitalLamports, integrityHash: hash(payload) };
}
export function verifyOpportunitySetSnapshot(snapshot) {
    const payload = {
        certificateId: snapshot.certificateId,
        decidedAtMs: snapshot.decidedAtMs,
        availableCapitalLamports: snapshot.availableCapitalLamports.toString(),
        candidateIds: [...snapshot.candidateIds].sort(),
    };
    return hash(payload) === snapshot.integrityHash;
}
export class EconomicEventSpine {
    eventsByCertificate = new Map();
    preparedEvents = new WeakSet();
    assertCanAppend(input) {
        if (!input.certificateId)
            throw new Error('CERTIFICATE_ID_REQUIRED');
        timestamp('OCCURRED_AT', input.occurredAtMs);
        assertProvenance(input.provenance);
        if (input.occurredAtMs < input.provenance.observedAtMs)
            throw new Error('EVENT_OCCURRED_BEFORE_OBSERVED');
        const existing = this.eventsByCertificate.get(input.certificateId) ?? [];
        const prior = existing.at(-1);
        if (prior && input.occurredAtMs < prior.occurredAtMs)
            throw new Error('NON_MONOTONIC_ECONOMIC_EVENT_TIME');
        const sequence = existing.length + 1;
        const previousHash = prior?.integrityHash ?? GENESIS_HASH;
        // Preflight serialization too, so composed journals cannot partially
        // commit when payload/provenance data is cyclic or otherwise unhashable.
        hash({ ...input, sequence, previousHash });
    }
    prepareAppend(input) {
        const snapshot = deepFreeze(structuredClone(input));
        this.assertCanAppend(snapshot);
        const existing = this.eventsByCertificate.get(snapshot.certificateId) ?? [];
        const prior = existing.at(-1);
        const sequence = existing.length + 1;
        const previousHash = prior?.integrityHash ?? GENESIS_HASH;
        const payload = { ...snapshot, sequence, previousHash };
        const event = deepFreeze({ ...payload, integrityHash: hash(payload) });
        this.preparedEvents.add(event);
        return event;
    }
    appendPrepared(event) {
        if (typeof event !== 'object' || event === null || !this.preparedEvents.has(event)) {
            throw new Error('ECONOMIC_EVENT_NOT_PREPARED_BY_THIS_SPINE');
        }
        const existing = this.eventsByCertificate.get(event.certificateId) ?? [];
        const prior = existing.at(-1);
        const expectedSequence = existing.length + 1;
        const expectedPreviousHash = prior?.integrityHash ?? GENESIS_HASH;
        const { integrityHash, ...payload } = event;
        if (event.sequence !== expectedSequence || event.previousHash !== expectedPreviousHash || hash(payload) !== integrityHash) {
            throw new Error('PREPARED_ECONOMIC_EVENT_STALE_OR_INVALID');
        }
        this.assertCanAppend(event);
        const stored = this.eventsByCertificate.get(event.certificateId) ?? [];
        const committed = Object.freeze([...stored, event]);
        this.eventsByCertificate.set(event.certificateId, committed);
        return event;
    }
    append(input) {
        const event = this.prepareAppend(input);
        return this.appendPrepared(event);
    }
    list(certificateId) {
        return this.eventsByCertificate.get(certificateId) ?? [];
    }
    verify(certificateId) {
        let previousHash = GENESIS_HASH;
        let previousTime = 0;
        for (const event of this.list(certificateId)) {
            const { integrityHash, ...payload } = event;
            if (event.previousHash !== previousHash || event.sequence < 1 || event.occurredAtMs < previousTime || hash(payload) !== integrityHash)
                return false;
            previousHash = integrityHash;
            previousTime = event.occurredAtMs;
        }
        return true;
    }
    /** Returns only evidence received no later than a historical decision. */
    visibleAt(certificateId, decisionAtMs) {
        timestamp('DECISION_AT', decisionAtMs);
        return this.list(certificateId).filter((event) => event.provenance.receivedAtMs <= decisionAtMs);
    }
}
//# sourceMappingURL=economic-event-spine.js.map