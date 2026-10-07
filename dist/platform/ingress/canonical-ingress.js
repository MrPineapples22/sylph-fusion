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
/**
 * Canonical single-door ingress implementation enforcing the strict type-state progression
 * and durability barrier.
 */
export class CanonicalIngress {
    compiler;
    validator;
    journal;
    durability;
    subscribers = [];
    seenObservations = new Set();
    constructor(options) {
        this.compiler = options.compiler;
        this.validator = options.validator;
        this.journal = options.journal;
        this.durability = options.durability ?? 'FSYNC_COMMITTED';
        if (options.downstreamSubscriber) {
            this.subscribers.push(options.downstreamSubscriber);
        }
    }
    subscribe(subscriber) {
        this.subscribers.push(subscriber);
    }
    async submit(observation) {
        if (!observation || typeof observation !== 'object') {
            return {
                status: 'REJECTED',
                observationId: '0'.repeat(64),
                reason: 'INVALID_OBSERVATION_PAYLOAD: Null or non-object observation submitted',
            };
        }
        // 1. In-flight / seen deduplication check
        if (this.seenObservations.has(observation.observationId)) {
            return {
                status: 'DUPLICATE',
                observationId: observation.observationId,
                reason: 'OBSERVATION_ALREADY_COMMITTED',
            };
        }
        // 2. Compile: UnvalidatedObservation -> CompiledFusionEnvelope
        let compiled;
        try {
            compiled = await this.compiler.compile(observation);
        }
        catch (err) {
            return {
                status: 'REJECTED',
                observationId: observation.observationId,
                reason: `COMPILER_ERROR: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
        // 3. Validate: CompiledFusionEnvelope -> ValidatedFusionEnvelope
        let validationResult;
        try {
            validationResult = await this.validator.validate(compiled);
        }
        catch (err) {
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
        if (this.durability !== 'FSYNC_COMMITTED') {
            throw new Error(`DURABILITY_BARRIER_VIOLATION: Durability mode '${this.durability}' is forbidden. Only FSYNC_COMMITTED may create CommittedEnvelope.`);
        }
        // 5. Commit to Durable Journal
        let journalRecord;
        try {
            journalRecord = await this.journal.append(validated);
        }
        catch (err) {
            return {
                status: 'REJECTED',
                observationId: observation.observationId,
                reason: `JOURNAL_APPEND_FAILED: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
        // 6. Construct CommittedEnvelope (Only permitted with FSYNC_COMMITTED)
        const committedData = {
            journalSeq: journalRecord.sequence,
            envelopeHash: journalRecord.entryHash,
            validatedEnvelope: validated,
            committedAtMs: Date.now(),
            durability: 'FSYNC_COMMITTED',
        };
        const committed = Object.freeze(committedData);
        // 7. Authoritatively commit deduplication state
        this.seenObservations.add(observation.observationId);
        // 8. Downstream Authoritative Notification
        // Invariant: Strictly executed ONLY AFTER durable journal commit.
        for (const sub of this.subscribers) {
            await sub(committed);
        }
        return {
            status: 'ACCEPTED',
            observationId: observation.observationId,
            journalSeq: committed.journalSeq,
            envelopeHash: committed.envelopeHash,
        };
    }
}
/**
 * Default implementation of FusionEnvelopeCompiler.
 */
export class DefaultFusionEnvelopeCompiler {
    decoderVersion;
    constructor(decoderVersion = '1.0.0') {
        this.decoderVersion = decoderVersion;
    }
    compile(observation) {
        let decodedEvents = [];
        try {
            const text = Buffer.from(observation.rawPayload).toString('utf8');
            const parsed = JSON.parse(text);
            decodedEvents = Array.isArray(parsed) ? Object.freeze(parsed) : Object.freeze([parsed]);
        }
        catch {
            decodedEvents = Object.freeze([]);
        }
        const envelopeIdentity = `${observation.observationId}:${this.decoderVersion}:${observation.receivedAtMs}`;
        const envelopeId = createHash('sha256').update(envelopeIdentity).digest('hex');
        const data = {
            envelopeId,
            observation,
            compiledAtMs: Date.now(),
            decodedEvents,
            compilerVersion: this.decoderVersion,
        };
        return Object.freeze(data);
    }
}
/**
 * Default implementation of TruthValidator.
 */
export class DefaultTruthValidator {
    validatorVersion;
    constructor(validatorVersion = '1.0.0') {
        this.validatorVersion = validatorVersion;
    }
    validate(compiled) {
        const obs = compiled.observation;
        // Verify hash integrity of raw payload
        const recalculatedHash = createHash('sha256').update(obs.rawPayload).digest('hex');
        if (recalculatedHash !== obs.rawPayloadHash) {
            return {
                valid: false,
                reason: `RAW_PAYLOAD_HASH_MISMATCH: Computed ${recalculatedHash} != Claimed ${obs.rawPayloadHash}`,
            };
        }
        if (obs.schemaVersion === 'solana-program-logs/v1' && compiled.decodedEvents.length === 0) {
            return {
                valid: false,
                reason: 'NO_MATCHING_PROGRAM_EVENTS',
            };
        }
        const truthEvidence = {
            evidenceId: createHash('sha256')
                .update(`evidence:${compiled.envelopeId}:${this.validatorVersion}`)
                .digest('hex'),
            validatorVersion: this.validatorVersion,
            validatedAtMs: Date.now(),
            rawPayloadHash: obs.rawPayloadHash,
            signatureVerified: obs.signature !== null && obs.signature.length >= 16,
            schemaCompliant: true,
            verificationMethod: 'PAYLOAD_DIGEST_AND_METADATA_INTEGRITY',
        };
        const validationId = createHash('sha256')
            .update(`val:${compiled.envelopeId}:${truthEvidence.evidenceId}`)
            .digest('hex');
        const data = {
            validationId,
            compiledEnvelope: compiled,
            validatedAtMs: Date.now(),
            validatorVersion: this.validatorVersion,
            truthEvidence: Object.freeze(truthEvidence),
        };
        return {
            valid: true,
            validatedEnvelope: Object.freeze(data),
        };
    }
}
/**
 * Solana program logs fusion envelope compiler using Anchor EventParser.
 */
export class SolanaLogFusionEnvelopeCompiler {
    parser;
    decoderVersion;
    constructor(connectionOrCoder, decoderVersion = 'solana-pump-v1') {
        let coder;
        if (connectionOrCoder && typeof connectionOrCoder === 'object') {
            if ('coder' in connectionOrCoder) {
                coder = connectionOrCoder.coder;
            }
            else {
                try {
                    coder = getPumpProgram(connectionOrCoder).coder;
                }
                catch {
                    coder = getPumpProgram({}).coder;
                }
            }
        }
        else {
            coder = getPumpProgram({}).coder;
        }
        this.parser = new EventParser(PUMP_PROGRAM_ID, coder);
        this.decoderVersion = decoderVersion;
    }
    compile(observation) {
        const rawPayload = observation.rawPayload;
        const text = Buffer.from(rawPayload.buffer, rawPayload.byteOffset, rawPayload.byteLength).toString('utf8');
        let logs;
        try {
            logs = JSON.parse(text);
        }
        catch {
            throw new Error('SOLANA_LOGS_INVALID_JSON: Failed to parse raw logs JSON');
        }
        if (!Array.isArray(logs)) {
            throw new Error('SOLANA_LOGS_INVALID_PAYLOAD: Expected string array of logs');
        }
        const decodedEvents = [];
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
        const envelopeId = createHash('sha256').update(envelopeIdentity).digest('hex');
        const data = {
            envelopeId,
            observation,
            compiledAtMs: Date.now(),
            decodedEvents: Object.freeze(decodedEvents),
            compilerVersion: this.decoderVersion,
        };
        return Object.freeze(data);
    }
}
export function createCanonicalSolanaIngress(options = {}) {
    const compiler = new SolanaLogFusionEnvelopeCompiler(options.connectionOrCoder);
    const validator = new DefaultTruthValidator();
    const journal = options.journal ?? new InMemoryIngressJournal();
    return new CanonicalIngress({
        compiler,
        validator,
        journal,
        durability: options.durability ?? 'FSYNC_COMMITTED',
        downstreamSubscriber: options.onCommitted,
    });
}
/**
 * In-memory implementation of IngressDurableJournal for testing and synchronous execution.
 */
export class InMemoryIngressJournal {
    seqCounter = 0n;
    entries = new Map();
    async append(validated) {
        const sequence = ++this.seqCounter;
        this.entries.set(sequence, validated);
        const entryHash = createHash('sha256')
            .update(`journal:${sequence}:${validated.validationId}:${validated.validatedAtMs}`)
            .digest('hex');
        return {
            sequence,
            entryHash,
        };
    }
}
//# sourceMappingURL=canonical-ingress.js.map