/**
 * SYLPH FUSION — CANONICAL INGRESS PIPELINE
 * Specifications: Frozen Architecture Execution Step 1 (Section 14)
 *
 * Architecture Flow:
 * UnvalidatedObservation
 *         ↓
 * FusionEnvelopeCompiler
 *         ↓
 * CompiledFusionEnvelope
 *         ↓
 * TruthValidator
 *         ↓
 * ValidatedFusionEnvelope
 *         ↓
 * FusionJournalStore.append
 *         ↓
 * Durability Barrier ('FSYNC_COMMITTED')
 *         ↓
 * CommittedEnvelope
 *         ↓
 * Downstream Authoritative Processing
 *
 * Invariants:
 * 1. NO AUTHORITATIVE DOWNSTREAM NOTIFICATION BEFORE DURABLE JOURNAL COMMIT.
 * 2. Only FSYNC_COMMITTED may create a CommittedEnvelope.
 * 3. QUEUED, BUFFERED, WRITE_COMPLETE, FSYNC_DATA must never create a CommittedEnvelope.
 * 4. Deduplication is finalized only upon durable journal acceptance.
 */

import { createHash } from 'node:crypto';
import { EventParser } from '@coral-xyz/anchor';
import { getPumpProgram, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { getStoreIngressCapability, type Store, type StoreIngressCapability } from '../../store.js';
import { createUnvalidatedObservation } from './observation-factory.js';
import type { ObservationIngressPort } from './port.js';
import type {
  CompiledFusionEnvelope,
  CompiledFusionEnvelopeData,
  CommittedEnvelope,
  CommittedEnvelopeData,
  DurabilityBarrier,
  Hash256,
  IngressReceipt,
  TruthEvidence,
  UnvalidatedObservation,
  ValidatedFusionEnvelope,
  ValidatedFusionEnvelopeData,
} from './types.js';
import { isObservationCreatedByFactory } from './observation-factory.js';
import { RuntimeTelemetryCapture, type RuntimeTelemetryOptions, type RuntimeTelemetryTrace } from './runtime-telemetry.js';

export interface FusionEnvelopeCompiler {
  compile(observation: UnvalidatedObservation): Promise<CompiledFusionEnvelope> | CompiledFusionEnvelope;
}

export type ValidationResult =
  | { readonly valid: true; readonly validatedEnvelope: ValidatedFusionEnvelope }
  | { readonly valid: false; readonly reason: string };

export interface TruthValidator {
  validate(compiled: CompiledFusionEnvelope): Promise<ValidationResult> | ValidationResult;
}

export interface IngressJournalRecord {
  readonly sequence: bigint;
  readonly entryHash: Hash256;
  readonly timestamp?: number;
}

export interface IngressDurableJournal {
  append(validated: ValidatedFusionEnvelope): Promise<IngressJournalRecord>;
  findByObservationId?(observationId: string): Promise<IngressJournalRecord | null>;
  getPendingDeliveries?(afterSequence: number, limit: number): Promise<readonly { sequence: number; entryHash: Hash256; body: string; eventHash: string }[]>;
  acknowledgeDelivery?(observationId: string, sequence: number, entryHash: Hash256): Promise<void>;
}

export interface AuditEventJournal {
  appendAuditEvent(event: string, payload: Readonly<Record<string, unknown>>, stableEventId?: string): Promise<{ inserted: boolean; auditId?: number }>;
  getAuditEventByStableId(stableEventId: string): Promise<{ id: number; at: number; event: string | null; body: string | null; pruned?: boolean; eventHash?: string } | null>;
}

export interface CanonicalIngressOptions {
  readonly runtimeTelemetry?: RuntimeTelemetryOptions;
  readonly compiler: FusionEnvelopeCompiler;
  readonly validator: TruthValidator;
  readonly journal: IngressDurableJournal;
  readonly durability?: DurabilityBarrier;
  readonly downstreamSubscriber?: (committed: CommittedEnvelope) => Promise<void> | void;
}

const durableCanonicalIngressInstances = new WeakSet<object>();
const storeIngressJournalInstances = new WeakSet<object>();
const storeIngressJournalCapabilities = new WeakMap<object, StoreIngressCapability>();

/** True only for a CanonicalIngress whose journal is backed by the real Store class. */
export function isDurableCanonicalIngress(value: unknown): value is CanonicalIngress {
  return !!value && typeof value === 'object' && durableCanonicalIngressInstances.has(value as object);
}

/**
 * Canonical single-door ingress implementation enforcing the strict type-state progression
 * and durability barrier.
 */
export class CanonicalIngress implements ObservationIngressPort {
  readonly #compiler: FusionEnvelopeCompiler;
  readonly #validator: TruthValidator;
  readonly #authenticCommittedEnvelopes = new WeakSet<object>();
  readonly #journal: IngressDurableJournal;
  readonly #durability: DurabilityBarrier;
  readonly #subscribers: Array<(committed: CommittedEnvelope) => Promise<void> | void> = [];
  readonly #seenObservations = new Set<string>();
  readonly #pendingDeliveries = new Map<string, CommittedEnvelope>();
  readonly #deliveryCursors = new Map<string, number>();
  #deliveryMutex: Promise<void> = Promise.resolve();
  readonly #telemetry?: RuntimeTelemetryCapture;

  constructor(options: CanonicalIngressOptions) {
    this.#compiler = options.compiler;
    this.#validator = options.validator;
    this.#journal = options.journal;
    this.#durability = options.durability ?? 'FSYNC_COMMITTED';
    if (options.runtimeTelemetry) {
      const store = storeIngressJournalCapabilities.get(options.journal);
      if (!store) throw new Error('C5_DURABLE_STORE_REQUIRED');
      this.#telemetry = new RuntimeTelemetryCapture(store, options.runtimeTelemetry);
    }
    if (storeIngressJournalInstances.has(options.journal)) durableCanonicalIngressInstances.add(this);
    if (options.downstreamSubscriber) {
      this.#subscribers.push(options.downstreamSubscriber);
    }
  }

  public subscribe(subscriber: (committed: CommittedEnvelope) => Promise<void> | void): void {
    this.#subscribers.push(subscriber);
  }

  /** Explicit export only; failures neither authorize nor roll back ingress work. */
  public captureRuntimeTelemetry(): Promise<Readonly<Record<string, unknown>>> {
    if (!this.#telemetry) return Promise.reject(new Error('C5_RUNTIME_TELEMETRY_NOT_CONFIGURED'));
    return this.#telemetry.capture();
  }

  public issued(committed: unknown): committed is CommittedEnvelope {
    return !!committed && typeof committed === 'object' && this.#authenticCommittedEnvelopes.has(committed as object);
  }

  public async submit(observation: UnvalidatedObservation): Promise<IngressReceipt> {
    if (!isObservationCreatedByFactory(observation)) {
      return {
        status: 'REJECTED',
        observationId: '0'.repeat(64) as Hash256,
        reason: 'INVALID_OBSERVATION_PAYLOAD: Null or non-object observation submitted',
      };
    }

    // 1. In-flight / seen deduplication check
    if (this.#seenObservations.has(observation.observationId)) {
      return {
        status: 'DUPLICATE',
        observationId: observation.observationId,
        reason: 'OBSERVATION_ALREADY_COMMITTED',
      };
    }

    if (this.#journal.findByObservationId) {
      try {
        const existing = await this.#journal.findByObservationId(observation.observationId);
        if (existing) {
          if (this.#journal.getPendingDeliveries) await this.recoverPendingDeliveries();
          this.#seenObservations.add(observation.observationId);
          if (this.#pendingDeliveries.has(observation.observationId)) {
            return { status: 'REJECTED', observationId: observation.observationId, reason: 'COMMITTED_DELIVERY_PENDING_RETRY' };
          }
          return { status: 'DUPLICATE', observationId: observation.observationId, reason: 'OBSERVATION_ALREADY_COMMITTED' };
        }
      } catch (err) {
        return { status: 'REJECTED', observationId: observation.observationId, reason: `JOURNAL_LOOKUP_FAILED: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    if (observation.rawPayloadHash !== createHash('sha256').update(observation.rawPayload).digest('hex')) {
      return { status: 'REJECTED', observationId: observation.observationId, reason: 'RAW_PAYLOAD_HASH_MISMATCH' };
    }
    if (this.inFlightObservations.has(observation.observationId)) {
      return { status: 'DUPLICATE', observationId: observation.observationId, reason: 'OBSERVATION_IN_FLIGHT' };
    }
    this.inFlightObservations.add(observation.observationId);
    try {
      // A durable commit with COMMITTED_DELIVERY_PENDING_RETRY is still an
      // unsuccessful end-to-end attempt. Its later delivery has its own trace.
      return this.#telemetry ? await this.#telemetry.observe(trace => this.processObservation(observation, trace),
        receipt => receipt.status === 'ACCEPTED') : await this.processObservation(observation);
    } finally {
      this.inFlightObservations.delete(observation.observationId);
    }
  }

  private readonly inFlightObservations = new Set<string>();

  private async processObservation(observation: UnvalidatedObservation, trace?: RuntimeTelemetryTrace): Promise<IngressReceipt> {

    // 2. Compile: UnvalidatedObservation -> CompiledFusionEnvelope
    let compiled: CompiledFusionEnvelope;
    try {
      compiled = this.#telemetry ? await this.#telemetry.measure('ingress.compile', trace!, () => this.#compiler.compile(observation)) : await this.#compiler.compile(observation);
    } catch (err) {
      return {
        status: 'REJECTED',
        observationId: observation.observationId,
        reason: `COMPILER_ERROR: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 3. Validate: CompiledFusionEnvelope -> ValidatedFusionEnvelope
    let validationResult: ValidationResult;
    try {
      validationResult = this.#telemetry ? await this.#telemetry.measure('ingress.validate', trace!, () => this.#validator.validate(compiled), result => result.valid) : await this.#validator.validate(compiled);
    } catch (err) {
      return {
        status: 'REJECTED',
        observationId: observation.observationId,
        reason: `VALIDATOR_EXCEPTION: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!validationResult.valid) {
      return {
        status: 'REJECTED',
        observationId: observation.observationId,
        reason: validationResult.reason,
      };
    }

    const validated = validationResult.validatedEnvelope;

    // 4. Durability Barrier Check
    // Master Blueprint & Section 14 Invariant: Only FSYNC_COMMITTED may create CommittedEnvelope.
    if (this.#durability !== 'FSYNC_COMMITTED' || (!storeIngressJournalInstances.has(this.#journal) && !(this.#journal instanceof InMemoryIngressJournal))) {
      return {
        status: 'REJECTED',
        observationId: observation.observationId,
        reason: 'DURABLE_STORE_INGRESS_JOURNAL_REQUIRED',
      };
    }

    // 5. Commit to Durable Journal
    let journalRecord: IngressJournalRecord;
    try {
      journalRecord = this.#telemetry ? await this.#telemetry.measure('ingress.commit', trace!, () => this.#journal.append(validated)) : await this.#journal.append(validated);
    } catch (err) {
      return {
        status: 'REJECTED',
        observationId: observation.observationId,
        reason: `JOURNAL_APPEND_FAILED: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 6. Construct CommittedEnvelope (Only permitted with FSYNC_COMMITTED)
    const committedData: CommittedEnvelopeData = {
      journalSeq: journalRecord.sequence,
      envelopeHash: journalRecord.entryHash,
      validatedEnvelope: validated,
      committedAtMs: Date.now(),
      durability: 'FSYNC_COMMITTED',
    };

    const committed = Object.freeze(committedData) as CommittedEnvelope;
    this.#authenticCommittedEnvelopes.add(committed);

    // 7. Authoritatively commit deduplication state
    this.#seenObservations.add(observation.observationId);

    // 8. Downstream Authoritative Notification
    // Invariant: Strictly executed ONLY AFTER durable journal commit.
    this.#pendingDeliveries.set(observation.observationId, committed);
    const delivered = await this.deliverPending(observation.observationId, trace);

    return delivered ? {
      status: 'ACCEPTED',
      observationId: observation.observationId,
      journalSeq: committed.journalSeq,
      envelopeHash: committed.envelopeHash,
    } : {
      status: 'REJECTED',
      observationId: observation.observationId,
      reason: 'COMMITTED_DELIVERY_PENDING_RETRY',
    };
  }

  public async retryPendingDeliveries(): Promise<number> {
    let delivered = 0;
    for (const observationId of this.#pendingDeliveries.keys()) {
      if (await this.deliverPending(observationId)) delivered++;
    }
    return delivered;
  }

  /** Rebuilds and dispatches durable outbox records left unacknowledged by a prior process. */
  public async recoverPendingDeliveries(): Promise<number> {
    if (!this.#journal.getPendingDeliveries) return 0;
    let afterSequence = 0;
    let recovered = 0;
    for (;;) {
      const page = await this.#journal.getPendingDeliveries(afterSequence, 500);
      for (const row of page) {
        if (!Number.isSafeInteger(row.sequence) || row.sequence <= afterSequence) throw new Error('INGRESS_OUTBOX_SEQUENCE_INVALID');
        afterSequence = row.sequence;
        const committed = await this.restoreCommittedEnvelope(row);
        const observationId = committed.validatedEnvelope.compiledEnvelope.observation.observationId;
        this.#authenticCommittedEnvelopes.add(committed as object);
        this.#seenObservations.add(observationId);
        this.#pendingDeliveries.set(observationId, committed);
        if (await this.deliverPending(observationId)) recovered++;
      }
      if (page.length < 500) break;
    }
    return recovered;
  }

  private async deliverPending(observationId: string, trace?: RuntimeTelemetryTrace): Promise<boolean> {
    let resolveMutex!: () => void;
    const previous = this.#deliveryMutex;
    this.#deliveryMutex = new Promise<void>(resolve => { resolveMutex = resolve; });
    await previous;
    try {
      if (!this.#telemetry) return await this.deliverPendingExclusive(observationId);
      const deliver = (context: RuntimeTelemetryTrace) => this.#telemetry!.measure('ingress.delivery', context, () => this.deliverPendingExclusive(observationId), result => result);
      return trace ? await deliver(trace) : await this.#telemetry.observe(deliver, delivered => delivered);
    } finally {
      resolveMutex();
    }
  }

  private async deliverPendingExclusive(observationId: string): Promise<boolean> {
    const committed = this.#pendingDeliveries.get(observationId);
    if (!committed) return true;
    if (this.#subscribers.length === 0) return false;
    try {
      let cursor = this.#deliveryCursors.get(observationId) ?? 0;
      while (cursor < this.#subscribers.length) {
        await this.#subscribers[cursor](committed);
        cursor++;
        this.#deliveryCursors.set(observationId, cursor);
      }
      if (!this.#journal.acknowledgeDelivery) return false;
      await this.#journal.acknowledgeDelivery(observationId, Number(committed.journalSeq), committed.envelopeHash);
      this.#pendingDeliveries.delete(observationId);
      this.#deliveryCursors.delete(observationId);
      return true;
    } catch {
      // Keep the exact durable envelope available for explicit retry.
      return false;
    }
  }

  private async restoreCommittedEnvelope(row: { sequence: number; entryHash: Hash256; body: string; eventHash: string }): Promise<CommittedEnvelope> {
    let payload: any;
    try { payload = JSON.parse(row.body); } catch { throw new Error('INGRESS_OUTBOX_ROW_INVALID'); }
    if (payload?.schemaVersion !== 1 || typeof payload.observationId !== 'string' ||
        typeof payload.rawPayloadBase64 !== 'string' || typeof payload.rawPayloadHash !== 'string' ||
        typeof payload.entryHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.entryHash) ||
        createHash('sha256').update(`${'canonical_ingress_committed_v1'}:${row.body}`).digest('hex') !== row.eventHash) {
      throw new Error('INGRESS_OUTBOX_ROW_INVALID');
    }
    const { entryHash, ...entryPayload } = payload;
    if (createHash('sha256').update(JSON.stringify(entryPayload)).digest('hex') !== entryHash) throw new Error('INGRESS_OUTBOX_HASH_MISMATCH');
    const rawPayload = Buffer.from(payload.rawPayloadBase64, 'base64');
    const observation = createUnvalidatedObservation({
      sourceId: payload.sourceId,
      providerId: payload.providerId,
      transport: payload.transport,
      receivedAtMs: payload.receivedAtMs,
      observedAtMs: payload.observedAtMs,
      slot: payload.slot,
      commitment: payload.commitment,
      signature: payload.signature,
      transactionVersion: payload.transactionVersion,
      rawPayload,
      schemaVersion: payload.schema,
      processingIntent: payload.processingIntent,
    });
    if (observation.observationId !== payload.observationId || observation.rawPayloadHash !== payload.rawPayloadHash) {
      throw new Error('INGRESS_OUTBOX_OBSERVATION_IDENTITY_MISMATCH');
    }
    const compiled = await this.#compiler.compile(observation);
    if (compiled.envelopeId !== payload.envelopeId || compiled.compilerVersion !== payload.compilerVersion ||
        JSON.stringify(compiled.decodedEvents.map(serializeDecodedEvent)) !== JSON.stringify(payload.decodedEvents)) {
      throw new Error('INGRESS_OUTBOX_COMPILER_DRIFT');
    }
    const result = await this.#validator.validate(compiled);
    if (!result.valid) throw new Error('INGRESS_OUTBOX_VALIDATION_FAILED');
    const current = result.validatedEnvelope;
    const savedEvidence = payload.truthEvidence;
    if (current.validationId !== payload.validationId || current.validatorVersion !== payload.validatorVersion ||
        !savedEvidence || savedEvidence.evidenceId !== current.truthEvidence.evidenceId ||
        savedEvidence.validatorVersion !== current.truthEvidence.validatorVersion ||
        savedEvidence.rawPayloadHash !== current.truthEvidence.rawPayloadHash ||
        savedEvidence.signatureVerified !== current.truthEvidence.signatureVerified ||
        savedEvidence.schemaCompliant !== current.truthEvidence.schemaCompliant ||
        savedEvidence.verificationMethod !== current.truthEvidence.verificationMethod ||
        !Number.isSafeInteger(savedEvidence.validatedAtMs) || savedEvidence.validatedAtMs < 0 ||
        !Number.isSafeInteger(payload.validatedAtMs) || payload.validatedAtMs < 0) {
      throw new Error('INGRESS_OUTBOX_VALIDATION_IDENTITY_MISMATCH');
    }
    const validated = Object.freeze({
      validationId: payload.validationId,
      compiledEnvelope: compiled,
      validatedAtMs: payload.validatedAtMs,
      validatorVersion: payload.validatorVersion,
      truthEvidence: Object.freeze(savedEvidence),
    }) as ValidatedFusionEnvelope;
    const committed = Object.freeze({
      journalSeq: BigInt(row.sequence),
      envelopeHash: row.eventHash,
      validatedEnvelope: validated,
      committedAtMs: Date.now(),
      durability: 'FSYNC_COMMITTED',
    }) as CommittedEnvelope;
    return committed;
  }
}

function serializeDecodedEvent(event: any): Record<string, unknown> {
  return {
    name: String(event?.name ?? ''),
    signature: String(event?.signature ?? ''),
    slot: Number.isSafeInteger(event?.slot) ? event.slot : null,
    received: Number.isFinite(event?.received) ? event.received : null,
    data: JSON.parse(JSON.stringify(event?.data ?? null, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value?.toBase58?.() ?? value
    )),
  };
}

/**
 * Default implementation of FusionEnvelopeCompiler.
 */
export class DefaultFusionEnvelopeCompiler implements FusionEnvelopeCompiler {
  private readonly decoderVersion: string;

  constructor(decoderVersion = '1.0.0') {
    this.decoderVersion = decoderVersion;
  }

  public compile(observation: UnvalidatedObservation): CompiledFusionEnvelope {
    let decodedEvents: readonly any[] = [];
    try {
      const text = Buffer.from(observation.rawPayload).toString('utf8');
      const parsed = JSON.parse(text);
      decodedEvents = Array.isArray(parsed) ? Object.freeze(parsed) : Object.freeze([parsed]);
    } catch {
      decodedEvents = Object.freeze([]);
    }

    const envelopeIdentity = `${observation.observationId}:${this.decoderVersion}:${observation.receivedAtMs}`;
    const envelopeId = createHash('sha256').update(envelopeIdentity).digest('hex') as Hash256;

    const data: CompiledFusionEnvelopeData = {
      envelopeId,
      observation,
      compiledAtMs: Date.now(),
      decodedEvents,
      compilerVersion: this.decoderVersion,
    };

    return Object.freeze(data) as CompiledFusionEnvelope;
  }
}

/**
 * Default implementation of TruthValidator.
 */
export class DefaultTruthValidator implements TruthValidator {
  private readonly validatorVersion: string;

  constructor(validatorVersion = '1.0.0') {
    this.validatorVersion = validatorVersion;
  }

  public validate(compiled: CompiledFusionEnvelope): ValidationResult {
    const obs = compiled.observation;

    // Verify hash integrity of raw payload
    const recalculatedHash = createHash('sha256').update(obs.rawPayload).digest('hex');
    if (recalculatedHash !== obs.rawPayloadHash) {
      return {
        valid: false,
        reason: `RAW_PAYLOAD_HASH_MISMATCH: Computed ${recalculatedHash} != Claimed ${obs.rawPayloadHash}`,
      };
    }

    if (compiled.compilerVersion.startsWith('solana-pump-') && compiled.decodedEvents.length === 0) {
      return {
        valid: false,
        reason: 'NO_MATCHING_PROGRAM_EVENTS',
      };
    }

    const truthEvidence: TruthEvidence = {
      evidenceId: createHash('sha256')
        .update(`evidence:${compiled.envelopeId}:${this.validatorVersion}`)
        .digest('hex') as Hash256,
      validatorVersion: this.validatorVersion,
      validatedAtMs: Date.now(),
      rawPayloadHash: obs.rawPayloadHash,
      signatureVerified: false,
      // Only the versioned Solana log compiler currently enforces a recognized
      // event schema. Generic/test decoders must not claim schema validation.
      schemaCompliant: compiled.compilerVersion.startsWith('solana-pump-') && compiled.decodedEvents.length > 0,
      verificationMethod: 'OBSERVATION_HASH_AND_LOG_DECODING_ONLY',
    };

    const validationId = createHash('sha256')
      .update(`val:${compiled.envelopeId}:${truthEvidence.evidenceId}`)
      .digest('hex') as Hash256;

    const data: ValidatedFusionEnvelopeData = {
      validationId,
      compiledEnvelope: compiled,
      validatedAtMs: Date.now(),
      validatorVersion: this.validatorVersion,
      truthEvidence: Object.freeze(truthEvidence),
    };

    return {
      valid: true,
      validatedEnvelope: Object.freeze(data) as ValidatedFusionEnvelope,
    };
  }
}

/**
 * Solana program logs fusion envelope compiler using Anchor EventParser.
 */
export class SolanaLogFusionEnvelopeCompiler implements FusionEnvelopeCompiler {
  public parser: any;
  private readonly decoderVersion: string;

  constructor(connectionOrCoder?: any, decoderVersion = 'solana-pump-v1') {
    let coder: any;
    if (connectionOrCoder && typeof connectionOrCoder === 'object') {
      if ('coder' in connectionOrCoder) {
        coder = connectionOrCoder.coder;
      } else {
        try {
          coder = getPumpProgram(connectionOrCoder).coder;
        } catch {
          coder = getPumpProgram({} as any).coder;
        }
      }
    } else {
      coder = getPumpProgram({} as any).coder;
    }
    this.parser = new EventParser(PUMP_PROGRAM_ID, coder);
    this.decoderVersion = decoderVersion;
  }

  public compile(observation: UnvalidatedObservation): CompiledFusionEnvelope {
    const rawPayload = observation.rawPayload;
    const text = Buffer.from(rawPayload.buffer, rawPayload.byteOffset, rawPayload.byteLength).toString('utf8');
    let logs: any;
    try {
      logs = JSON.parse(text);
    } catch {
      throw new Error('SOLANA_LOGS_INVALID_JSON: Failed to parse raw logs JSON');
    }
    if (observation.schemaVersion === 'yellowstone-update-json/v1') {
      logs = logs?.transaction?.transaction?.meta?.logMessages;
    } else if (observation.schemaVersion === 'solana-json-rpc-frame/v1') {
      logs = logs?.params?.result?.value?.logs;
    } else if (observation.schemaVersion !== 'solana-program-logs/v1' || !Array.isArray(logs)) {
      logs = null;
    } else {
      // Canonical logs representation used by explicit replay fixtures.
    }
    if (!Array.isArray(logs) || logs.length > 100_000 || logs.some(line => typeof line !== 'string')) {
      throw new Error('SOLANA_LOGS_INVALID_PAYLOAD: Expected bounded string array of logs');
    }

    const decodedEvents: any[] = [];
    for (const event of this.parser.parseLogs(logs, false)) {
      if (decodedEvents.length >= 256) {
        throw new Error('Too many events in one transaction');
      }
      decodedEvents.push({
        name: event.name,
        data: event.data,
        signature: observation.signature ?? '',
        slot: observation.slot ?? 0,
        received: observation.receivedAtMs,
        observation,
      });
    }

    const envelopeIdentity = `${observation.observationId}:${this.decoderVersion}:${observation.receivedAtMs}`;
    const envelopeId = createHash('sha256').update(envelopeIdentity).digest('hex') as Hash256;

    const data: CompiledFusionEnvelopeData = {
      envelopeId,
      observation,
      compiledAtMs: Date.now(),
      decodedEvents: Object.freeze(decodedEvents),
      compilerVersion: this.decoderVersion,
    };

    return Object.freeze(data) as CompiledFusionEnvelope;
  }
}

export interface CreateCanonicalSolanaIngressOptions {
  runtimeTelemetry?: RuntimeTelemetryOptions;
  connectionOrCoder?: any;
  journal: IngressDurableJournal;
  durability?: DurabilityBarrier;
  onCommitted?: (committed: CommittedEnvelope) => Promise<void> | void;
}

/** Adapts the Store audit transaction to the ingress journal contract. Before writing,
 * the worker must prove its live connection is file-backed, in WAL mode, and synchronous=FULL. */
export class StoreIngressJournal implements IngressDurableJournal {
  readonly #store: StoreIngressCapability;

  constructor(store: Store & AuditEventJournal) {
    const capability = getStoreIngressCapability(store);
    if (!capability) throw new Error('INGRESS_DURABLE_JOURNAL_REQUIRED');
    this.#store = capability;
    storeIngressJournalCapabilities.set(this, capability);
    storeIngressJournalInstances.add(this);
  }

  async append(validated: ValidatedFusionEnvelope): Promise<IngressJournalRecord> {
    await this.#store.assertDurable();
    const { observation, envelopeId, compilerVersion, decodedEvents } = validated.compiledEnvelope;
    const { truthEvidence, validationId, validatorVersion } = validated;
    const payload = {
      schemaVersion: 1,
      observationId: observation.observationId,
      sourceId: observation.sourceId,
      providerId: observation.providerId,
      transport: observation.transport,
      receivedAtMs: observation.receivedAtMs,
      observedAtMs: observation.observedAtMs,
      slot: observation.slot,
      commitment: observation.commitment,
      signature: observation.signature,
      transactionVersion: observation.transactionVersion,
      rawPayloadBase64: Buffer.from(observation.rawPayload).toString('base64'),
      rawPayloadHash: observation.rawPayloadHash,
      schema: observation.schemaVersion,
      processingIntent: observation.processingIntent,
      envelopeId,
      compilerVersion,
      validatedAtMs: validated.validatedAtMs,
      validatorVersion,
      validationId,
      truthEvidence,
      decodedEvents: decodedEvents.map(event => ({
        name: String(event?.name ?? ''),
        signature: String(event?.signature ?? ''),
        slot: Number.isSafeInteger(event?.slot) ? event.slot : null,
        received: Number.isFinite(event?.received) ? event.received : null,
        data: JSON.parse(JSON.stringify(event?.data ?? null, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value?.toBase58?.() ?? value
        )),
      })),
    };
    const stableEventId = `ingress:${observation.observationId}`;
    const canonicalPayload = JSON.stringify(payload);
    const entryHash = createHash('sha256').update(canonicalPayload).digest('hex') as Hash256;
    let result: { inserted: boolean; auditId?: number };
    try {
      result = await this.#store.appendAuditEvent('canonical_ingress_committed_v1', { ...payload, entryHash }, stableEventId);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'DUPLICATE_EVENT_ID_CONTENT_CONFLICT') throw error;
      const existing = await this.findByObservationId(observation.observationId);
      if (!existing) throw error;
      return existing;
    }
    if (!result.inserted && result.auditId === undefined) throw new Error('INGRESS_JOURNAL_ID_MISSING');
    const sequence = result.auditId;
    if (!Number.isSafeInteger(sequence) || sequence! <= 0) throw new Error('INGRESS_JOURNAL_SEQUENCE_INVALID');
    const durableRecord = await this.findByObservationId(observation.observationId);
    if (!durableRecord || durableRecord.sequence !== BigInt(sequence!)) throw new Error('INGRESS_JOURNAL_COMMIT_NOT_READABLE');
    return durableRecord;
  }

  async findByObservationId(observationId: string): Promise<IngressJournalRecord | null> {
    const row = await this.#store.getAuditEventByStableId(`ingress:${observationId}`);
    if (row?.pruned) {
      if (typeof row.eventHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.eventHash)) throw new Error('INGRESS_JOURNAL_DEDUPE_ROW_INVALID');
      return { sequence: BigInt(row.id), entryHash: row.eventHash as Hash256 };
    }
    for (const candidate of row ? [row] : []) {
      if (candidate.body === null) continue;
      let payload: any;
      try { payload = JSON.parse(candidate.body); } catch { throw new Error('INGRESS_JOURNAL_ROW_INVALID'); }
      if (candidate.event !== 'canonical_ingress_committed_v1' || payload?.observationId !== observationId ||
          typeof candidate.eventHash !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.eventHash)) {
        throw new Error('INGRESS_JOURNAL_ROW_INVALID');
      }
      if (typeof payload.entryHash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.entryHash)) throw new Error('INGRESS_JOURNAL_ROW_INVALID');
      const { entryHash, ...entryPayload } = payload;
      if (createHash('sha256').update(JSON.stringify(entryPayload)).digest('hex') !== entryHash) {
        throw new Error('INGRESS_JOURNAL_HASH_MISMATCH');
      }
      const expectedHash = createHash('sha256').update(`${candidate.event}:${candidate.body}`).digest('hex');
      if (expectedHash !== candidate.eventHash) throw new Error('INGRESS_JOURNAL_HASH_MISMATCH');
      return { sequence: BigInt(candidate.id), entryHash: candidate.eventHash as Hash256 };
    }
    return null;
  }

  async getPendingDeliveries(afterSequence: number, limit: number): Promise<readonly { sequence: number; entryHash: Hash256; body: string; eventHash: string }[]> {
    await this.#store.assertDurable();
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('INGRESS_OUTBOX_QUERY_INVALID');
    }
    return Object.freeze((await this.#store.getPendingIngress(afterSequence, limit)).map(row => {
      if (!Number.isSafeInteger(row.id) || row.id < 1 || typeof row.body !== 'string' ||
          !/^[a-f0-9]{64}$/.test(row.eventHash)) throw new Error('INGRESS_OUTBOX_ROW_INVALID');
      return Object.freeze({ sequence: row.id, entryHash: row.eventHash as Hash256, body: row.body, eventHash: row.eventHash });
    }));
  }

  async acknowledgeDelivery(observationId: string, sequence: number, entryHash: Hash256): Promise<void> {
    await this.#store.assertDurable();
    await this.#store.acknowledgeIngress(observationId, sequence, entryHash);
  }
}

export function createCanonicalSolanaIngress(
  options: CreateCanonicalSolanaIngressOptions
): CanonicalIngress {
  const compiler = new SolanaLogFusionEnvelopeCompiler(options.connectionOrCoder);
  const validator = new DefaultTruthValidator();
  const journal = options.journal;
  return new CanonicalIngress({
    compiler,
    validator,
    journal,
    durability: options.durability ?? 'FSYNC_COMMITTED',
    downstreamSubscriber: options.onCommitted,
    runtimeTelemetry: options.runtimeTelemetry,
  });
}

/**
 * In-memory implementation of IngressDurableJournal for tests only. Production composition
 * must pass the SQLite-backed audit journal explicitly.
 */
export class InMemoryIngressJournal implements IngressDurableJournal {
  private seqCounter = 0n;
  private readonly entries = new Map<bigint, ValidatedFusionEnvelope>();

  public async append(validated: ValidatedFusionEnvelope): Promise<IngressJournalRecord> {
    const sequence = ++this.seqCounter;
    this.entries.set(sequence, validated);

    const entryHash = createHash('sha256')
      .update(`journal:${sequence}:${validated.validationId}:${validated.validatedAtMs}`)
      .digest('hex') as Hash256;

    return {
      sequence,
      entryHash,
    };
  }

  /** In-memory test journal has no restartable outbox; acknowledge in-process delivery. */
  public async acknowledgeDelivery(_observationId: string, _sequence: number, _entryHash: Hash256): Promise<void> {}
}

export const TEST_INGRESS_JOURNAL = new InMemoryIngressJournal();
