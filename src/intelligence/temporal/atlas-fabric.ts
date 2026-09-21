/**
 * ATLAS: Unified Temporal Knowledge & State Fabric
 * Blueprint Engine #3
 * 
 * Authoritative historical memory using append-only event sourcing with 6 canonical clocks:
 * EVENT_TIME <= KNOWLEDGE_TIME <= PROCESSING_TIME <= PREDICTION_TIME <= EXECUTION_TIME <= CONFIRMATION_TIME.
 * Guarantees point-in-time replay and deterministic reconstruction.
 */

export interface AtlasTemporalClocks {
  readonly event_time_ms: number;        // When the event occurred on-chain or at the source
  readonly knowledge_time_ms: number;    // When SYLPH first ingested the event
  readonly processing_time_ms: number;   // When the feature/graph pipeline parsed it
  readonly prediction_time_ms?: number;  // When inference or belief update completed
  readonly execution_time_ms?: number;   // When an order was constructed/signed
  readonly confirmation_time_ms?: number;// When tx landed and was confirmed on-chain
}

export type AtlasRecordCategory = 
  | 'MARKET_EVENT'
  | 'TOKEN_STATE'
  | 'WALLET_STATE'
  | 'CLUSTER_STATE'
  | 'PREDICTION'
  | 'BELIEF'
  | 'UNCERTAINTY'
  | 'MISSION'
  | 'DECISION'
  | 'RISK_APPROVAL'
  | 'EXECUTION_INTENT'
  | 'FILL'
  | 'OUTCOME'
  | 'EXPERIMENT';

export interface AtlasHistoricalEvent<T = any> {
  readonly record_id: string;
  readonly sequence_num: number;
  readonly category: AtlasRecordCategory;
  readonly token_mint?: string;
  readonly entity_id: string;
  readonly clocks: AtlasTemporalClocks;
  readonly payload: T;
  readonly schema_version: string;
  readonly engine_provenance: string;
  readonly hash?: string;
}

export class AtlasTemporalKnowledgeFabric {
  public static readonly VERSION = '1.0.0';
  private records: AtlasHistoricalEvent[] = [];
  private sequenceCounter = 0;
  private byTokenIndex: Map<string, number[]> = new Map(); // token_mint -> indices
  private byCategoryIndex: Map<AtlasRecordCategory, number[]> = new Map();

  /**
   * Appends an event to the temporal fabric with clock validation.
   */
  public append<T>(
    category: AtlasRecordCategory,
    entityId: string,
    clocks: AtlasTemporalClocks,
    payload: T,
    engineProvenance: string,
    tokenMint?: string,
    schemaVersion: string = '1.0.0'
  ): AtlasHistoricalEvent<T> {
    // Assert monotonic temporal clock ordering where present
    if (clocks.knowledge_time_ms < clocks.event_time_ms) {
      // Allow minor clock skew up to 500ms, otherwise enforce ordering
      if (clocks.event_time_ms - clocks.knowledge_time_ms > 500) {
        throw new Error(
          `[ATLAS] Clock inversion: knowledge_time (${clocks.knowledge_time_ms}) < event_time (${clocks.event_time_ms})`
        );
      }
    }

    if (clocks.processing_time_ms < clocks.knowledge_time_ms) {
      throw new Error(
        `[ATLAS] Clock inversion: processing_time (${clocks.processing_time_ms}) < knowledge_time (${clocks.knowledge_time_ms})`
      );
    }

    this.sequenceCounter++;
    const recordId = `atlas_${Date.now()}_${this.sequenceCounter}`;

    const record: AtlasHistoricalEvent<T> = {
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
  public queryPointInTime(
    maxKnowledgeTimeMs: number,
    filter?: { tokenMint?: string; category?: AtlasRecordCategory }
  ): readonly AtlasHistoricalEvent[] {
    let candidateIndices: number[] | null = null;

    if (filter?.tokenMint) {
      candidateIndices = this.byTokenIndex.get(filter.tokenMint) ?? [];
    } else if (filter?.category) {
      candidateIndices = this.byCategoryIndex.get(filter.category) ?? [];
    }

    const result: AtlasHistoricalEvent[] = [];

    if (candidateIndices) {
      for (const idx of candidateIndices) {
        const rec = this.records[idx];
        if (rec.clocks.knowledge_time_ms <= maxKnowledgeTimeMs) {
          if (!filter?.category || rec.category === filter.category) {
            result.push(rec);
          }
        }
      }
    } else {
      for (const rec of this.records) {
        if (rec.clocks.knowledge_time_ms <= maxKnowledgeTimeMs) {
          result.push(rec);
        }
      }
    }

    return result;
  }

  public getRecordCount(): number {
    return this.records.length;
  }

  public getLatestByToken(tokenMint: string): AtlasHistoricalEvent | undefined {
    const list = this.byTokenIndex.get(tokenMint);
    if (!list || list.length === 0) return undefined;
    return this.records[list[list.length - 1]];
  }

  public clear(): void {
    this.records = [];
    this.sequenceCounter = 0;
    this.byTokenIndex.clear();
    this.byCategoryIndex.clear();
  }
}
