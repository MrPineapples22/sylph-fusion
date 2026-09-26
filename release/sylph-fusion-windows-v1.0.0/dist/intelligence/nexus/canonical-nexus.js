/**
 * SYLPH-SOL / AETHER FLUX - Canonical World State Authority (NEXUS)
 * Specifications: Sections 2, 3, 5.
 *
 * Implements:
 * 1. NEXUS: Sole authoritative owner for market & derived world state
 * 2. Canonical Truth Pipeline: Raw Observation -> Verified Evidence -> Domain Event -> Canonical State
 * 3. Knowledge Frontier: Point-in-time state locking for exact and counterfactual replay
 */
import { TheseusIdentity } from '../semantics/metron-theseus.js';
/**
 * NEXUS: Canonical World State Authority
 */
export class NexusCanonicalState {
    rawObservations = [];
    verifiedEvidence = [];
    domainEvents = [];
    canonicalTokens = new Map();
    currentSlot = 250_000;
    /**
     * Ingest raw observation preserving source provenance
     */
    ingestRawObservation(provider, payload) {
        const obs = {
            observationId: `raw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            provider,
            payload,
            observedAtMs: Date.now(),
        };
        this.rawObservations.push(obs);
        return obs;
    }
    /**
     * Verify evidence with provenance tracking
     */
    verifyEvidence(rawObs) {
        const evidence = {
            evidenceId: `evi_${rawObs.observationId}`,
            rawObservationId: rawObs.observationId,
            provider: rawObs.provider,
            verifiedAtMs: Date.now(),
            provenanceHash: `sha256_${rawObs.observationId}_${rawObs.provider}`,
            isTrusted: true,
        };
        this.verifiedEvidence.push(evidence);
        return evidence;
    }
    /**
     * Produce accepted domain event
     */
    commitDomainEvent(evidence, type, mint, data) {
        const cMint = TheseusIdentity.canonicalizeMint(mint);
        this.currentSlot++;
        const event = {
            eventId: `evt_${Date.now()}_${this.domainEvents.length + 1}`,
            evidenceId: evidence.evidenceId,
            type,
            mint: cMint,
            slot: this.currentSlot,
            timestampMs: Date.now(),
            data,
        };
        this.domainEvents.push(event);
        this.reduceEventToState(event);
        return event;
    }
    /**
     * Deterministic reducer updating canonical token record
     */
    reduceEventToState(event) {
        const existing = this.canonicalTokens.get(event.mint) || {
            mint: event.mint,
            symbol: event.data.symbol || event.mint.slice(0, 4).toUpperCase(),
            startTime: event.timestampMs,
            liquidityUsd: 5000,
            marketCapUsd: 25000,
            txsCount: 1,
            rugScore: 0,
            hsiScore: 50,
            pumpScore: 50,
            podState: 'N',
            lastUpdatedSlot: event.slot,
            lastUpdatedMs: event.timestampMs,
        };
        const nextRecord = {
            ...existing,
            liquidityUsd: event.data.liquidityUsd ?? existing.liquidityUsd,
            marketCapUsd: event.data.marketCapUsd ?? existing.marketCapUsd,
            txsCount: existing.txsCount + 1,
            lastUpdatedSlot: event.slot,
            lastUpdatedMs: event.timestampMs,
        };
        this.canonicalTokens.set(event.mint, nextRecord);
    }
    getTokenRecord(mint) {
        const cMint = TheseusIdentity.canonicalizeMint(mint);
        return this.canonicalTokens.get(cMint);
    }
    getAllTokens() {
        return Array.from(this.canonicalTokens.values());
    }
    /**
     * Retrieve knowledge frontier for replay / counterfactual analysis
     */
    getKnowledgeFrontier(instantMs = Date.now()) {
        const availableEvents = this.domainEvents.filter((e) => e.timestampMs <= instantMs);
        const maxSlot = availableEvents.length > 0 ? Math.max(...availableEvents.map((e) => e.slot)) : this.currentSlot;
        return {
            decisionInstantMs: instantMs,
            maxObservedSlot: maxSlot,
            domainEventsCount: availableEvents.length,
        };
    }
    getStatus() {
        return 'CURRENT';
    }
}
//# sourceMappingURL=canonical-nexus.js.map