/**
 * ATLAS: Unified Temporal Knowledge & State Fabric
 * Blueprint Engine #3
 *
 * Authoritative historical memory using append-only event sourcing with 6 canonical clocks:
 * EVENT_TIME <= KNOWLEDGE_TIME <= PROCESSING_TIME <= PREDICTION_TIME <= EXECUTION_TIME <= CONFIRMATION_TIME.
 * Guarantees point-in-time replay and deterministic reconstruction.
 */
export class AtlasTemporalKnowledgeFabric {
    static VERSION = '1.0.0';
    records = [];
    sequenceCounter = 0;
    byTokenIndex = new Map(); // token_mint -> indices
    byCategoryIndex = new Map();
    /**
     * Appends an event to the temporal fabric with clock validation.
     */
    append(category, entityId, clocks, payload, engineProvenance, tokenMint, schemaVersion = '1.0.0') {
        // Assert monotonic temporal clock ordering where present
        if (clocks.knowledge_time_ms < clocks.event_time_ms) {
            // Allow minor clock skew up to 500ms, otherwise enforce ordering
            if (clocks.event_time_ms - clocks.knowledge_time_ms > 500) {
                throw new Error(`[ATLAS] Clock inversion: knowledge_time (${clocks.knowledge_time_ms}) < event_time (${clocks.event_time_ms})`);
            }
        }
        if (clocks.processing_time_ms < clocks.knowledge_time_ms) {
            throw new Error(`[ATLAS] Clock inversion: processing_time (${clocks.processing_time_ms}) < knowledge_time (${clocks.knowledge_time_ms})`);
        }
        this.sequenceCounter++;
        const recordId = `atlas_${Date.now()}_${this.sequenceCounter}`;
        const record = {
            record_id: recordId,
            sequence_num: this.sequenceCounter,
            category,
            token_mint: tokenMint,
            entity_id: entityId,
            clocks: { ...clocks },
            payload,
            schema_version: schemaVersion,
            engine_provenance: engineProvenance
        };
        const idx = this.records.length;
        this.records.push(record);
        if (tokenMint) {
            const tokenList = this.byTokenIndex.get(tokenMint) ?? [];
            tokenList.push(idx);
            this.byTokenIndex.set(tokenMint, tokenList);
        }
        const catList = this.byCategoryIndex.get(category) ?? [];
        catList.push(idx);
        this.byCategoryIndex.set(category, catList);
        return record;
    }
    /**
     * Deterministically queries historical events up to a point-in-time knowledge timestamp.
     * Prevents future-information leakage during replay.
     */
    queryPointInTime(maxKnowledgeTimeMs, filter) {
        let candidateIndices = null;
        if (filter?.tokenMint) {
            candidateIndices = this.byTokenIndex.get(filter.tokenMint) ?? [];
        }
        else if (filter?.category) {
            candidateIndices = this.byCategoryIndex.get(filter.category) ?? [];
        }
        const result = [];
        if (candidateIndices) {
            for (const idx of candidateIndices) {
                const rec = this.records[idx];
                if (rec.clocks.knowledge_time_ms <= maxKnowledgeTimeMs) {
                    if (!filter?.category || rec.category === filter.category) {
                        result.push(rec);
                    }
                }
            }
        }
        else {
            for (const rec of this.records) {
                if (rec.clocks.knowledge_time_ms <= maxKnowledgeTimeMs) {
                    result.push(rec);
                }
            }
        }
        return result;
    }
    getRecordCount() {
        return this.records.length;
    }
    getLatestByToken(tokenMint) {
        const list = this.byTokenIndex.get(tokenMint);
        if (!list || list.length === 0)
            return undefined;
        return this.records[list[list.length - 1]];
    }
    clear() {
        this.records = [];
        this.sequenceCounter = 0;
        this.byTokenIndex.clear();
        this.byCategoryIndex.clear();
    }
}
//# sourceMappingURL=atlas-fabric.js.map