/**
 * SOL-SYLPH Canonical Event Architecture
 * Specifications: Parts III, IV, V, VI, LXXXIII, LXXXIV, LXXXV, LXXXVI, LXXXVII
 *
 * Enforces:
 * 1. Typed SylphEvent with stable correlation ID chains and 40 semantic event types.
 * 2. Multi-clock separation (LiveClock, ReplayClock, TestClock) and late-arrival classification.
 * 3. Append-only Event Journal with watermark reorder buffers.
 * 4. Session & Release Manifest traceability.
 */

import { createHash } from 'crypto';

// --- Part VI: Global Identity Types ---
export type TokenId = string;
export type VenueId = string;
export type PoolId = string;
export type WalletId = string;
export type ClusterId = string;
export type EventId = string;
export type ObservationId = string;
export type EvidenceId = string;
export type StateVersion = number;
export type DecisionId = string;
export type ForecastId = string;
export type PositionId = string;
export type ExecutionId = string;
export type OutcomeId = string;
export type AuditId = string;
export type AlertId = string;
export type InvestigationId = string;
export type HypothesisId = string;
export type ExperimentId = string;
export type ReplayId = string;
export type SessionId = string;
export type PolicyVersion = string;
export type ModelVersion = string;
export type FeatureVersion = string;
export type ConfigVersion = string;
export type ReleaseId = string;

// --- Part LXXXIV: Environment Identity ---
export type Environment = 'DEV' | 'TEST' | 'REPLAY' | 'SHADOW' | 'SIMULATION' | 'PRODUCTION';

// --- Part III: 40 Semantic Domain Event Types ---
export type SylphEventType =
  | 'TOKEN_DISCOVERED'
  | 'TRADE_RECEIVED'
  | 'TOKEN_MIGRATING'
  | 'DEX_UPDATED'
  | 'RUG_UPDATED'
  | 'LIQUIDITY_UPDATED'
  | 'PRICE_UPDATED'
  | 'SUPPLY_UPDATED'
  | 'WALLET_ENTERED'
  | 'WALLET_EXITED'
  | 'WHALE_ENTERED'
  | 'WHALE_EXITED'
  | 'BUNDLE_DETECTED'
  | 'SYBIL_DETECTED'
  | 'WASH_DETECTED'
  | 'GRAPH_UPDATED'
  | 'HSI_CHANGED'
  | 'PUMP_SCORE_CHANGED'
  | 'POD_CHANGED'
  | 'AI_UPDATED'
  | 'WORLD_FORECAST_UPDATED'
  | 'FILTER_TRIGGERED'
  | 'FILTER_CLEARED'
  | 'PROTECTION_ENABLED'
  | 'PROTECTION_RENEWED'
  | 'PROTECTION_DEGRADED'
  | 'PROTECTION_DISABLED'
  | 'AUDIT_COMPLETED'
  | 'SOLAR_CORE_REACHED'
  | 'DIAMOND_CORE_REACHED'
  | 'DECISION_CREATED'
  | 'EXECUTION_REQUESTED'
  | 'EXECUTION_COMPLETED'
  | 'ALERT_OPENED'
  | 'ALERT_RESOLVED'
  | 'OUTCOME_COMPLETED'
  | 'POLICY_PROMOTED'
  | 'POLICY_ROLLED_BACK'
  | 'MODEL_PROMOTED'
  | 'MODEL_ROLLED_BACK';

export type EventQuality = 'HIGH' | 'MEDIUM' | 'LOW' | 'DEGRADED' | 'SYNTHETIC';

// --- Part III & Blueprint Part II: Typed Canonical Event ---
export interface SylphEvent<T = Record<string, unknown>> {
  readonly eventId: EventId;
  readonly canonicalKey?: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly sequence: number;
  readonly eventType: SylphEventType;
  readonly mint: TokenId;
  readonly slot?: number;
  readonly transactionSignature?: string;
  readonly instructionIndex?: number;
  readonly innerInstructionIndex?: number;
  readonly source: string;
  readonly sourceSequence?: number;
  readonly commitment?: 'processed' | 'confirmed' | 'finalized';
  readonly chainTime?: number;
  readonly observedAt: number; // Event-time at original source
  readonly receivedAt: number; // Time received by Sylph boundary
  readonly decodedAt?: number;
  readonly processedAt: number; // Time state engine processed event
  readonly payload: T;
  readonly quality: EventQuality;
  readonly schemaVersion: string;
  readonly decoderVersion?: string;
  readonly sessionId: SessionId;
  readonly environment: Environment;
  readonly checksum?: string;
  readonly rawHash?: string;
}

// --- Part IV: Timing & Clock Abstractions ---
export type EventArrivalStatus = 'ON_TIME' | 'LATE_ACCEPTED' | 'LATE_CORRECTION' | 'TOO_LATE' | 'DUPLICATE';

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
  name(): string;
}

export class LiveClock implements Clock {
  public now(): number {
    return Date.now();
  }
  public async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  public name(): string {
    return 'LiveClock';
  }
}

export class ReplayClock implements Clock {
  private currentMs: number;
  constructor(initialMs: number = Date.now()) {
    this.currentMs = initialMs;
  }
  public now(): number {
    return this.currentMs;
  }
  public advance(ms: number): void {
    if (ms < 0) throw new Error('Cannot advance clock backward in time');
    this.currentMs += ms;
  }
  public setTime(ms: number): void {
    this.currentMs = ms;
  }
  public async sleep(ms: number): Promise<void> {
    this.advance(ms);
  }
  public name(): string {
    return 'ReplayClock';
  }
}

export class TestClock extends ReplayClock {
  public override name(): string {
    return 'TestClock';
  }
}

// --- Part IV: Reorder Buffer & Watermark Engine ---
export class WatermarkEngine {
  private highestObservedTimeMs: number = 0;
  private readonly maxAllowedLatenessMs: number;
  private readonly hardExpiryMs: number;

  constructor(options?: { maxAllowedLatenessMs?: number; hardExpiryMs?: number }) {
    this.maxAllowedLatenessMs = options?.maxAllowedLatenessMs ?? 5000;
    this.hardExpiryMs = options?.hardExpiryMs ?? 30000;
  }

  public evaluateArrival(eventTimeMs: number, currentTimeMs: number): EventArrivalStatus {
    if (eventTimeMs > this.highestObservedTimeMs) {
      this.highestObservedTimeMs = eventTimeMs;
    }

    const latenessMs = currentTimeMs - eventTimeMs;
    if (latenessMs <= this.maxAllowedLatenessMs) {
      return 'ON_TIME';
    }
    if (latenessMs <= this.hardExpiryMs) {
      return 'LATE_ACCEPTED';
    }
    return 'TOO_LATE';
  }

  public getWatermark(): number {
    return Math.max(0, this.highestObservedTimeMs - this.maxAllowedLatenessMs);
  }
}

// --- Part V & Blueprint Part II: Append-Oriented Event Journal with Deduplication ---
export class EventJournal {
  private readonly events: SylphEvent[] = [];
  private readonly eventsByCanonicalKey = new Map<string, SylphEvent>();
  private sequenceCounter: number = 0;
  private readonly watermarkEngine: WatermarkEngine;

  constructor(watermarkEngine?: WatermarkEngine) {
    this.watermarkEngine = watermarkEngine ?? new WatermarkEngine();
  }

  public append<T = Record<string, unknown>>(params: {
    eventType: SylphEventType;
    mint: TokenId;
    source: string;
    payload: T;
    observedAt: number;
    receivedAt?: number;
    correlationId?: string;
    causationId?: string;
    sourceSequence?: number;
    quality?: EventQuality;
    schemaVersion?: string;
    decoderVersion?: string;
    sessionId?: SessionId;
    environment?: Environment;
    clock?: Clock;
    canonicalKey?: string;
    slot?: number;
    transactionSignature?: string;
    instructionIndex?: number;
    innerInstructionIndex?: number;
    commitment?: 'processed' | 'confirmed' | 'finalized';
    chainTime?: number;
    decodedAt?: number;
    rawHash?: string;
  }): { event: SylphEvent<T>; arrivalStatus: EventArrivalStatus } {
    const clock = params.clock ?? new LiveClock();
    const now = clock.now();
    const receivedAt = params.receivedAt ?? now;
    const processedAt = now;

    const canonicalKey = params.canonicalKey ?? 
      (params.slot && params.transactionSignature 
        ? `${params.slot}:${params.transactionSignature}:${params.instructionIndex ?? 0}:${params.innerInstructionIndex ?? 0}:${params.eventType}`
        : `${params.mint}:${params.source}:${params.sourceSequence ?? params.observedAt}:${params.eventType}`);

    if (this.eventsByCanonicalKey.has(canonicalKey)) {
      const existing = this.eventsByCanonicalKey.get(canonicalKey)! as SylphEvent<T>;
      return { event: existing, arrivalStatus: 'DUPLICATE' };
    }

    const arrivalStatus = this.watermarkEngine.evaluateArrival(params.observedAt, now);

    this.sequenceCounter += 1;
    const sequence = this.sequenceCounter;

    const rawPayload = JSON.stringify(params.payload);
    const checksum = params.rawHash ?? createHash('sha256')
      .update(`${params.mint}:${sequence}:${params.eventType}:${params.observedAt}:${rawPayload}`)
      .digest('hex');

    const eventId: EventId = `evt_${params.eventType.toLowerCase()}_${params.mint.slice(0, 8)}_${sequence}`;

    const event: SylphEvent<T> = {
      eventId,
      canonicalKey,
      correlationId: params.correlationId ?? `corr_${sequence}_${now}`,
      causationId: params.causationId,
      sequence,
      eventType: params.eventType,
      mint: params.mint,
      slot: params.slot,
      transactionSignature: params.transactionSignature,
      instructionIndex: params.instructionIndex,
      innerInstructionIndex: params.innerInstructionIndex,
      source: params.source,
      sourceSequence: params.sourceSequence,
      commitment: params.commitment ?? 'confirmed',
      chainTime: params.chainTime ?? params.observedAt,
      observedAt: params.observedAt,
      receivedAt,
      decodedAt: params.decodedAt ?? receivedAt,
      processedAt,
      payload: params.payload,
      quality: params.quality ?? 'HIGH',
      schemaVersion: params.schemaVersion ?? '1.0.0',
      decoderVersion: params.decoderVersion ?? '1.0.0',
      sessionId: params.sessionId ?? 'session_default',
      environment: params.environment ?? 'SIMULATION',
      checksum,
      rawHash: checksum,
    };

    this.events.push(event as SylphEvent);
    this.eventsByCanonicalKey.set(canonicalKey, event as SylphEvent);
    return { event, arrivalStatus };
  }

  public getEventCount(): number {
    return this.events.length;
  }

  public getEvent(sequence: number): SylphEvent | undefined {
    return this.events.find(e => e.sequence === sequence);
  }

  public getEventsForToken(mint: TokenId): readonly SylphEvent[] {
    return this.events.filter(e => e.mint === mint);
  }

  public getEventsSlice(fromSequence: number, toSequence?: number): readonly SylphEvent[] {
    return this.events.filter(e => e.sequence >= fromSequence && (toSequence === undefined || e.sequence <= toSequence));
  }

  public exportJournal(): readonly SylphEvent[] {
    return [...this.events];
  }
}

// --- Part LXXXIII: SylphSession Structure ---
export interface SylphSession {
  readonly sessionId: SessionId;
  readonly environment: Environment;
  readonly releaseId: ReleaseId;
  readonly configVersion: ConfigVersion;
  readonly startTimeMs: number;
  readonly endTimeMs?: number;
  readonly sources: readonly string[];
  readonly journalRange: {
    readonly startSequence: number;
    readonly endSequence?: number;
  };
  readonly shutdownReason?: string;
}

// --- Part LXXXV: Release Manifest ---
export interface ReleaseManifest {
  readonly releaseId: ReleaseId;
  readonly semanticVersion: string;
  readonly gitCommit?: string;
  readonly builtAtMs: number;
  readonly subsystemVersions: {
    readonly eventSchema: string;
    readonly canonicalSchema: string;
    readonly evidenceSchema: string;
    readonly featureSchema: string;
    readonly hsiVersion: string;
    readonly pumpVersion: string;
    readonly podVersion: string;
    readonly graphVersion: string;
    readonly worldModelVersion: string;
    readonly policyVersion: string;
    readonly riskVersion: string;
    readonly executionVersion: string;
    readonly projectionVersion: string;
  };
}
