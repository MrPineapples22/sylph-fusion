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
  IngressVersionRegistry,
  RawPayloadEncoding,
  TruthEvidence,
  UnvalidatedObservation,
  ValidatedFusionEnvelope,
  ValidatedFusionEnvelopeData,
} from './types.js';
import { isObservationCreatedByFactory } from './observation-factory.js';
import { RuntimeTelemetryCapture, type RuntimeTelemetryOptions, type RuntimeTelemetryTrace } from './runtime-telemetry.js';

export interface FusionEnvelopeCompiler {
  compile(observation: UnvalidatedObservation): Promise<CompiledFusionEnvelope> | CompiledFusionEnvelope;
  compileForVersion?(observation: UnvalidatedObservation, version: string): Promise<CompiledFusionEnvelope> | CompiledFusionEnvelope;
  isVersionSupported?(version: string): boolean;
}

export type ValidationResult =
  | { readonly valid: true; readonly validatedEnvelope: ValidatedFusionEnvelope }
  | { readonly valid: false; readonly reason: string };

export interface TruthValidator {
  validate(compiled: CompiledFusionEnvelope): Promise<ValidationResult> | ValidationResult;
  validateForVersion?(compiled: CompiledFusionEnvelope, version: string): Promise<ValidationResult> | ValidationResult;
  isVersionSupported?(version: string): boolean;
}

export class DefaultIngressVersionRegistry implements IngressVersionRegistry {
  readonly currentCompilerVersion: string;
  readonly supportedCompilerVersions: ReadonlySet<string>;
  readonly currentValidatorVersion: string;
  readonly supportedValidatorVersions: ReadonlySet<string>;

  constructor(options: {
    currentCompilerVersion?: string;
    supportedCompilerVersions?: readonly string[];
    currentValidatorVersion?: string;
    supportedValidatorVersions?: readonly string[];
  } = {}) {
    this.currentCompilerVersion = options.currentCompilerVersion ?? '1.0.0';
    this.supportedCompilerVersions = new Set(options.supportedCompilerVersions ?? [this.currentCompilerVersion]);
    this.currentValidatorVersion = options.currentValidatorVersion ?? '1.0.0';
    this.supportedValidatorVersions = new Set(options.supportedValidatorVersions ?? [this.currentValidatorVersion]);
  }

  public isCompilerVersionSupported(version: string): boolean {
    return this.supportedCompilerVersions.has(version);
  }

  public isValidatorVersionSupported(version: string): boolean {
    return this.supportedValidatorVersions.has(version);
  }
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
  readonly versionRegistry?: IngressVersionRegistry;
}

// This capability is granted only by the reviewed production factory below.
// A durable Store alone says nothing about the compiler/validator that created
// the envelope, so direct CanonicalIngress construction is never production
// provenance even when its journal happens to be SQLite-backed.
const reviewedCanonicalIngressInstances = new WeakSet<object>();
const reviewedCanonicalIngressStores = new WeakMap<object, StoreIngressCapability>();
const reviewedStoreIngressJournalInstances = new WeakSet<object>();
const storeIngressJournalInstances = new WeakSet<object>();
const storeIngressJournalCapabilities = new WeakMap<object, StoreIngressCapability>();

function deepFreezeEnvelope<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object') return value;
  const object = value as object;
  if (seen.has(object)) return value;
  if (ArrayBuffer.isView(object) || object instanceof ArrayBuffer) return value;
  const prototype = Object.getPrototypeOf(object);
  // Library value objects such as BN expose methods that update internal
  // fields even for reads. Keep those values intact; subscriber copies detach
  // their own fields below while the committed plain-data graph stays frozen.
  if (!Array.isArray(object) && prototype !== Object.prototype && prototype !== null) return value;
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor && 'value' in descriptor) deepFreezeEnvelope(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function cloneSubscriberValue<T>(value: T, seen = new WeakMap<object, object>(), freezePlain = true): T {
  if (!value || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  if (value instanceof Uint8Array) return Uint8Array.from(value) as T;
  if (value instanceof ArrayBuffer) return value.slice(0) as T;
  const object = value as object;
  const existing = seen.get(object);
  if (existing) return existing as T;
  const prototype = Object.getPrototypeOf(object);
  // Decoder value classes (for example PublicKey and BN) carry methods and
  // mutable internal bookkeeping. Clone their own data while keeping the
  // prototype, rather than freezing or flattening them.
  const classInstance = !Array.isArray(object) && prototype !== Object.prototype && prototype !== null;
  if (classInstance && (object instanceof Date || object instanceof Map || object instanceof Set)) return value;
  const copy: any = Array.isArray(object) ? [] : Object.create(prototype);
  seen.set(object, copy);
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) continue;
    if ('value' in descriptor) descriptor.value = cloneSubscriberValue(descriptor.value, seen, classInstance ? false : freezePlain);
    Object.defineProperty(copy, key, descriptor);
  }
  return classInstance || !freezePlain ? copy : Object.freeze(copy);
}

function cloneCommittedEnvelope(value: CommittedEnvelope): CommittedEnvelope {
  // Detach non-freezable bytes per observer while preserving decoder classes.
  return cloneSubscriberValue(value);
}

function rawEvidenceMatches(observation: UnvalidatedObservation): boolean {
  return observation.rawPayloadHash === createHash('sha256').update(observation.rawPayload).digest('hex');
}

/** True only for an ingress produced by the reviewed Solana factory and real Store journal. */
export function isDurableCanonicalIngress(value: unknown): value is CanonicalIngress {
  return !!value && typeof value === 'object' && reviewedCanonicalIngressInstances.has(value as object);
}

export function isDurableCanonicalIngressForStore(value: unknown, store: unknown): value is CanonicalIngress {
  if (!isDurableCanonicalIngress(value) || !store || typeof store !== 'object') return false;
  const ingressStore = reviewedCanonicalIngressStores.get(value as object);
  return ingressStore !== undefined && ingressStore === getStoreIngressCapability(store);
}

/**
 * Canonical single-door ingress implementation enforcing the strict type-state progression
 * and durability barrier.
 */
export class CanonicalIngress implements ObservationIngressPort {
  readonly #compiler: FusionEnvelopeCompiler;
  readonly #validator: TruthValidator;
  readonly #versionRegistry?: IngressVersionRegistry;
  readonly #authenticCommittedEnvelopes = new WeakSet<object>();
  readonly #journal: IngressDurableJournal;
  readonly #durability: DurabilityBarrier;
  readonly #subscribers: Array<(committed: CommittedEnvelope) => Promise<void> | void> = [];
  #terminalSubscriber?: (committed: CommittedEnvelope) => Promise<void> | void;
  #dispatchStarted = false;
  readonly #seenObservations = new Set<string>();
  readonly #pendingDeliveries = new Map<string, CommittedEnvelope>();
  readonly #deliveryCursors = new Map<string, number>();
  #deliveryMutex: Promise<void> = Promise.resolve();
  readonly #telemetry?: RuntimeTelemetryCapture;

  constructor(options: CanonicalIngressOptions) {
    this.#compiler = options.compiler;
    this.#validator = options.validator;
    this.#versionRegistry = options.versionRegistry;
    this.#journal = options.journal;
    this.#durability = options.durability ?? 'FSYNC_COMMITTED';
    if (options.runtimeTelemetry) {
      const store = storeIngressJournalCapabilities.get(options.journal);
      if (!store) throw new Error('C5_DURABLE_STORE_REQUIRED');
      this.#telemetry = new RuntimeTelemetryCapture(store, options.runtimeTelemetry);
    }
    if (options.downstreamSubscriber) {
      this.#subscribers.push(options.downstreamSubscriber);
    }
    // Capture registration logic as a non-writable own method. The reviewed
    // factory later freezes the instance, preventing prototype/own-method
    // replacement before Engine installs the atomic projection handler.
    Object.defineProperty(this, 'subscribeTerminal', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: (subscriber: (committed: CommittedEnvelope) => Promise<void> | void) => {
        if (this.#dispatchStarted) throw new Error('INGRESS_SUBSCRIBERS_SEALED');
        if (this.#terminalSubscriber) throw new Error('INGRESS_TERMINAL_SUBSCRIBER_ALREADY_REGISTERED');
        this.#terminalSubscriber = subscriber;
      },
    });
  }

  public subscribe(subscriber: (committed: CommittedEnvelope) => Promise<void> | void): void {
    if (this.#dispatchStarted) throw new Error('INGRESS_SUBSCRIBERS_SEALED');
    this.#subscribers.push(subscriber);
  }

  /**
   * Reserve the final delivery position for Engine's projection+outbox commit.
   * Ordinary subscribers always run before this handler, including subscribers
   * added later, so no callback can fail after Engine has atomically ACKed.
   */
  public subscribeTerminal(subscriber: (committed: CommittedEnvelope) => Promise<void> | void): void {
    // The method body is supplied as an own, non-writable property in the
    // constructor so a caller cannot replace it on an instance.
    void subscriber;
    throw new Error('INGRESS_TERMINAL_SUBSCRIBER_REGISTRATION_UNAVAILABLE');
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

    // Snapshot caller-owned bytes before the first asynchronous boundary. The
    // factory freezes the observation shell, but typed-array contents remain
    // mutable and the caller still owns the original byte view.
    const originalHash = createHash('sha256').update(observation.rawPayload).digest('hex');
    if (observation.rawPayloadHash !== originalHash) {
      return { status: 'REJECTED', observationId: observation.observationId, reason: 'RAW_PAYLOAD_HASH_MISMATCH' };
    }
    observation = Object.freeze({ ...observation, rawPayload: Uint8Array.from(observation.rawPayload) }) as UnvalidatedObservation;

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
    if (!rawEvidenceMatches(observation)) {
      return { status: 'REJECTED', observationId: observation.observationId, reason: 'RAW_PAYLOAD_MUTATED_DURING_COMPILE' };
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
    if (!rawEvidenceMatches(observation)) {
      return { status: 'REJECTED', observationId: observation.observationId, reason: 'RAW_PAYLOAD_MUTATED_DURING_VALIDATION' };
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
    if (!rawEvidenceMatches(observation)) {
      return { status: 'REJECTED', observationId: observation.observationId, reason: 'RAW_PAYLOAD_MUTATED_BEFORE_JOURNAL' };
    }
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

    const committed = deepFreezeEnvelope(committedData) as CommittedEnvelope;
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
    this.#dispatchStarted = true;
    if (this.#subscribers.length === 0 && !this.#terminalSubscriber) return false;
    try {
      let cursor = this.#deliveryCursors.get(observationId) ?? 0;
      while (cursor < this.#subscribers.length) {
        await this.#subscribers[cursor](cloneCommittedEnvelope(committed));
        cursor++;
        this.#deliveryCursors.set(observationId, cursor);
      }
      if (this.#terminalSubscriber) {
        // The terminal Engine handler owns the projection+ACK transaction.
        // Never fall back to a generic ACK if a caller registered a no-op or
        // incomplete terminal handler: that would erase undelivered work.
        await this.#terminalSubscriber(committed);
        if (!this.#journal.getPendingDeliveries) return false;
        const sequence = Number(committed.journalSeq);
        const pending = await this.#journal.getPendingDeliveries(sequence - 1, 1);
        if (pending.some(row => row.sequence === sequence)) return false;
      } else if (reviewedCanonicalIngressInstances.has(this)) {
        // A reviewed production ingress has no generic ACK path. It can only
        // clear its outbox through Engine's atomic projection+ACK transaction.
        return false;
      } else {
        if (!this.#journal.acknowledgeDelivery) return false;
        await this.#journal.acknowledgeDelivery(observationId, Number(committed.journalSeq), committed.envelopeHash);
      }
      this.#pendingDeliveries.delete(observationId);
      this.#deliveryCursors.delete(observationId);
      return true;
    } catch (error) {
      // Keep the exact durable envelope available for explicit retry.
      console.error('canonical_ingress_delivery_pending', {
        observationId,
        reason: error instanceof Error ? error.message.slice(0, 256) : 'unknown_error',
      });
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
      rawPayloadEncoding: payload.rawPayloadEncoding,
      schemaVersion: payload.schema,
      processingIntent: payload.processingIntent,
    });
    if (observation.observationId !== payload.observationId || observation.rawPayloadHash !== payload.rawPayloadHash) {
      throw new Error('INGRESS_OUTBOX_OBSERVATION_IDENTITY_MISMATCH');
    }
    if (this.#versionRegistry) {
      if (!this.#versionRegistry.isCompilerVersionSupported(payload.compilerVersion)) {
        throw new Error('INGRESS_OUTBOX_UNSUPPORTED_COMPILER_VERSION');
      }
      if (!this.#versionRegistry.isValidatorVersionSupported(payload.validatorVersion)) {
        throw new Error('INGRESS_OUTBOX_UNSUPPORTED_VALIDATOR_VERSION');
      }
    }
    let compiled: CompiledFusionEnvelope;
    try {
      compiled = typeof this.#compiler.compileForVersion === 'function'
        ? await this.#compiler.compileForVersion(observation, payload.compilerVersion)
        : await this.#compiler.compile(observation);
    } catch (err) {
      throw new Error(`INGRESS_OUTBOX_COMPILER_DRIFT: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (compiled.envelopeId !== payload.envelopeId || compiled.compilerVersion !== payload.compilerVersion ||
        JSON.stringify(compiled.decodedEvents.map(serializeDecodedEvent)) !== JSON.stringify(payload.decodedEvents)) {
      throw new Error('INGRESS_OUTBOX_COMPILER_DRIFT');
    }
    let result: ValidationResult;
    try {
      result = typeof this.#validator.validateForVersion === 'function'
        ? await this.#validator.validateForVersion(compiled, payload.validatorVersion)
        : await this.#validator.validate(compiled);
    } catch (err) {
      throw new Error(`INGRESS_OUTBOX_VALIDATION_IDENTITY_MISMATCH: ${err instanceof Error ? err.message : String(err)}`);
    }
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
        (savedEvidence.authenticityProof !== undefined && savedEvidence.authenticityProof !== current.truthEvidence.authenticityProof) ||
        (savedEvidence.inclusionProof !== undefined && savedEvidence.inclusionProof !== current.truthEvidence.inclusionProof) ||
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
  private readonly supportedVersions: ReadonlySet<string>;

  constructor(decoderVersion = '1.0.0', supportedVersions?: readonly string[]) {
    this.decoderVersion = decoderVersion;
    this.supportedVersions = new Set(supportedVersions ?? [decoderVersion]);
  }

  public isVersionSupported(version: string): boolean {
    return this.supportedVersions.has(version);
  }

  public compileForVersion(observation: UnvalidatedObservation, version: string): CompiledFusionEnvelope {
    if (!this.supportedVersions.has(version)) {
      throw new Error(`UNSUPPORTED_COMPILER_VERSION: ${version}`);
    }
    let decodedEvents: readonly any[] = [];
    try {
      const text = Buffer.from(observation.rawPayload).toString('utf8');
      const parsed = JSON.parse(text);
      decodedEvents = Array.isArray(parsed) ? Object.freeze(parsed) : Object.freeze([parsed]);
    } catch {
      decodedEvents = Object.freeze([]);
    }

    const envelopeIdentity = `${observation.observationId}:${version}:${observation.receivedAtMs}`;
    const envelopeId = createHash('sha256').update(envelopeIdentity).digest('hex') as Hash256;

    const data: CompiledFusionEnvelopeData = {
      envelopeId,
      observation,
      compiledAtMs: Date.now(),
      decodedEvents,
      compilerVersion: version,
    };

    return Object.freeze(data) as CompiledFusionEnvelope;
  }

  public compile(observation: UnvalidatedObservation): CompiledFusionEnvelope {
    return this.compileForVersion(observation, this.decoderVersion);
  }
}

/**
 * Default implementation of TruthValidator.
 */
export class DefaultTruthValidator implements TruthValidator {
  private readonly validatorVersion: string;
  private readonly supportedVersions: ReadonlySet<string>;

  constructor(validatorVersion = '1.0.0', supportedVersions?: readonly string[]) {
    this.validatorVersion = validatorVersion;
    this.supportedVersions = new Set(supportedVersions ?? [validatorVersion]);
  }

  public isVersionSupported(version: string): boolean {
    return this.supportedVersions.has(version);
  }

  public validateForVersion(compiled: CompiledFusionEnvelope, version: string): ValidationResult {
    if (!this.supportedVersions.has(version)) {
      throw new Error(`UNSUPPORTED_VALIDATOR_VERSION: ${version}`);
    }
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
        .update(`evidence:${compiled.envelopeId}:${version}`)
        .digest('hex') as Hash256,
      validatorVersion: version,
      validatedAtMs: Date.now(),
      rawPayloadHash: obs.rawPayloadHash,
      signatureVerified: false,
      // Only the versioned Solana log compiler currently enforces a recognized
      // event schema. Generic/test decoders must not claim schema validation.
      schemaCompliant: compiled.compilerVersion.startsWith('solana-pump-') && compiled.decodedEvents.length > 0,
      verificationMethod: 'OBSERVATION_HASH_AND_LOG_DECODING_ONLY',
      authenticityProof: 'UNAVAILABLE_OBSERVATION_ONLY',
      inclusionProof: 'UNVERIFIED_LOG_DIGEST',
    };

    const validationId = createHash('sha256')
      .update(`val:${compiled.envelopeId}:${truthEvidence.evidenceId}`)
      .digest('hex') as Hash256;

    const data: ValidatedFusionEnvelopeData = {
      validationId,
      compiledEnvelope: compiled,
      validatedAtMs: Date.now(),
      validatorVersion: version,
      truthEvidence: Object.freeze(truthEvidence),
    };

    return {
      valid: true,
      validatedEnvelope: Object.freeze(data) as ValidatedFusionEnvelope,
    };
  }

  public validate(compiled: CompiledFusionEnvelope): ValidationResult {
    return this.validateForVersion(compiled, this.validatorVersion);
  }
}

/**
 * Solana program logs fusion envelope compiler using Anchor EventParser.
 */
export class SolanaLogFusionEnvelopeCompiler implements FusionEnvelopeCompiler {
  public parser: any;
  private readonly decoderVersion: string;
  private readonly supportedVersions: ReadonlySet<string>;

  constructor(connectionOrCoder?: any, decoderVersion = 'solana-pump-v1', supportedVersions?: readonly string[]) {
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
    this.supportedVersions = new Set(supportedVersions ?? [decoderVersion]);
  }

  public isVersionSupported(version: string): boolean {
    return this.supportedVersions.has(version);
  }

  public compileForVersion(observation: UnvalidatedObservation, version: string): CompiledFusionEnvelope {
    if (!this.supportedVersions.has(version)) {
      throw new Error(`UNSUPPORTED_COMPILER_VERSION: ${version}`);
    }
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

    const envelopeIdentity = `${observation.observationId}:${version}:${observation.receivedAtMs}`;
    const envelopeId = createHash('sha256').update(envelopeIdentity).digest('hex') as Hash256;

    const data: CompiledFusionEnvelopeData = {
      envelopeId,
      observation,
      compiledAtMs: Date.now(),
      decodedEvents: Object.freeze(decodedEvents),
      compilerVersion: version,
    };

    return Object.freeze(data) as CompiledFusionEnvelope;
  }

  public compile(observation: UnvalidatedObservation): CompiledFusionEnvelope {
    return this.compileForVersion(observation, this.decoderVersion);
  }
}

export interface CreateCanonicalSolanaIngressOptions {
  runtimeTelemetry?: RuntimeTelemetryOptions;
  journal: IngressDurableJournal;
  durability?: DurabilityBarrier;
  onCommitted?: (committed: CommittedEnvelope) => Promise<void> | void;
}

/** Adapts the Store audit transaction to the ingress journal contract. Before writing,
 * the worker must prove its live connection is file-backed, in WAL mode, and synchronous=FULL. */
export class StoreIngressJournal implements IngressDurableJournal {
  readonly #store: StoreIngressCapability;
  readonly #storeCall: (operation: string, body?: string) => Promise<string | null>;

  constructor(store: Store & AuditEventJournal) {
    if (new.target !== StoreIngressJournal) throw new Error('INGRESS_UNTRUSTED_JOURNAL_SUBCLASS');
    const capability = getStoreIngressCapability(store);
    if (!capability) throw new Error('INGRESS_DURABLE_JOURNAL_REQUIRED');
    this.#store = capability;
    this.#storeCall = (operation, body) => store.call(operation, body);
    storeIngressJournalCapabilities.set(this, capability);
    storeIngressJournalInstances.add(this);
    Object.freeze(this);
  }

  async append(validated: ValidatedFusionEnvelope): Promise<IngressJournalRecord> {
    await this.#store.assertDurable();
    const { observation, envelopeId, compilerVersion, decodedEvents } = validated.compiledEnvelope;
    const rawPayload = Uint8Array.from(observation.rawPayload);
    if (createHash('sha256').update(rawPayload).digest('hex') !== observation.rawPayloadHash) {
      throw new Error('RAW_PAYLOAD_HASH_MISMATCH_BEFORE_JOURNAL_SERIALIZATION');
    }
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
      rawPayloadBase64: Buffer.from(rawPayload).toString('base64'),
      rawPayloadHash: observation.rawPayloadHash,
      ...(observation.rawPayloadEncoding && observation.rawPayloadEncoding !== 'UNSPECIFIED'
        ? { rawPayloadEncoding: observation.rawPayloadEncoding }
        : {}),
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
    if (reviewedStoreIngressJournalInstances.has(this)) throw new Error('INGRESS_ENGINE_ATOMIC_ACK_REQUIRED');
    await this.#store.assertDurable();
    await this.#storeCall('acknowledge-ingress', JSON.stringify({ observationId, sequence, entryHash }));
  }
}

Object.freeze(CanonicalIngress.prototype);
Object.freeze(StoreIngressJournal.prototype);

export function createCanonicalSolanaIngress(
  options: CreateCanonicalSolanaIngressOptions
): CanonicalIngress {
  // This is the only factory whose instances receive reviewed Engine authority.
  // Caller-provided decoders, validators, and Anchor coders stay on the
  // explicitly unreviewed CanonicalIngress construction path.
  const compiler = new SolanaLogFusionEnvelopeCompiler();
  const validator = new DefaultTruthValidator();
  const journal = options.journal;
  const ingress = new CanonicalIngress({
    compiler,
    validator,
    journal,
    durability: options.durability ?? 'FSYNC_COMMITTED',
    downstreamSubscriber: options.onCommitted,
    runtimeTelemetry: options.runtimeTelemetry,
  });
  if (storeIngressJournalInstances.has(journal)) {
    const storeCapability = storeIngressJournalCapabilities.get(journal);
    storeCapability?.markReviewedEngineIngress();
    reviewedCanonicalIngressInstances.add(ingress);
    if (storeCapability) reviewedCanonicalIngressStores.set(ingress, storeCapability);
    reviewedStoreIngressJournalInstances.add(journal as object);
    Object.freeze(ingress);
  }
  return ingress;
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
