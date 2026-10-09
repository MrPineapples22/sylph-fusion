/**
 * SYLPH FUSION — INGRESS TYPES AND PRIVATE NOMINAL BRANDING
 * Specifications: Frozen Architecture Execution Step 1 (Sections 9, 10, 12, 14)
 *
 * Guarantees:
 * 1. Private nominal branding prevents ordinary data from being cast into authoritative types.
 * 2. Raw payload bytes are preserved and bound to a 64-hex SHA-256 digest.
 * 3. Type-state progression:
 *    UnvalidatedObservation != CompiledFusionEnvelope != ValidatedFusionEnvelope != CommittedEnvelope
 * 4. Only FSYNC_COMMITTED durability creates a CommittedEnvelope.
 * 5. General callers cannot construct authoritative types through exported constructors.
 */

import type { ProcessingIntent } from '../ingestion/types.js';

// Private nominal branding symbols (strictly module-scoped, NOT Symbol.for)
declare const _hash256Brand: unique symbol;
declare const _unvalidatedBrand: unique symbol;
declare const _compiledBrand: unique symbol;
declare const _validatedBrand: unique symbol;
declare const _committedBrand: unique symbol;

/** 64-character lowercase hexadecimal SHA-256 hash */
export type Hash256 = string & { readonly [_hash256Brand]: 'Hash256' };

export type Commitment = 'processed' | 'confirmed' | 'finalized' | 'unknown';

export type ObservationTransport =
  | 'websocket.logsSubscribe'
  | 'yellowstone.transaction.logs'
  | 'rpc.poll'
  | 'mock'
  | string;

export type RawPayloadEncoding =
  | 'UNSPECIFIED'
  | 'JSON_FRAME_BYTES'
  | 'JSON_SERIALIZED_BYTES'
  | 'JSON_CANONICAL'
  | 'DECODED_PROTOBUF_JSON_SERIALIZED_BYTES'
  | 'DECODED_PROTOBUF_JSON_CANONICAL'
  | 'GRPC_PROTOBUF_MESSAGE_PAYLOAD_BYTES'
  | 'PROTOBUF_WIRE_BYTES';

export interface IngressVersionRegistry {
  readonly currentCompilerVersion: string;
  readonly supportedCompilerVersions: ReadonlySet<string>;
  readonly currentValidatorVersion: string;
  readonly supportedValidatorVersions: ReadonlySet<string>;
  isCompilerVersionSupported(version: string): boolean;
  isValidatorVersionSupported(version: string): boolean;
}

export type TransactionAuthenticityProof =
  | 'UNAVAILABLE_OBSERVATION_ONLY'
  | 'CRYPTOGRAPHIC_SIGNATURE_VERIFIED';

export type BlockInclusionProof =
  | 'UNVERIFIED_LOG_DIGEST'
  | 'FINALIZED_BLOCK_ROOT_PROVEN';

export interface TruthEvidence {
  readonly evidenceId: Hash256;
  readonly validatorVersion: string;
  readonly validatedAtMs: number;
  readonly rawPayloadHash: Hash256;
  readonly signatureVerified: boolean;
  readonly schemaCompliant: boolean;
  readonly verificationMethod: string;
  readonly authenticityProof?: TransactionAuthenticityProof;
  readonly inclusionProof?: BlockInclusionProof;
}

export interface UnvalidatedObservationData {
  readonly observationId: Hash256;
  readonly sourceId: string;
  readonly providerId: string;
  readonly transport: string;
  readonly receivedAtMs: number;
  readonly observedAtMs: number | null;
  readonly slot: number | null;
  readonly commitment: Commitment;
  readonly signature: string | null;
  readonly transactionVersion: number | 'legacy' | 'unknown';
  readonly rawPayload: Uint8Array;
  readonly rawPayloadHash: Hash256;
  readonly rawPayloadEncoding?: RawPayloadEncoding;
  readonly schemaVersion: string;
  readonly processingIntent: ProcessingIntent;
}

/** Branded nominal type for an unvalidated observation */
export type UnvalidatedObservation = UnvalidatedObservationData & {
  readonly [_unvalidatedBrand]: 'UnvalidatedObservation';
};

export interface CompiledFusionEnvelopeData {
  readonly envelopeId: Hash256;
  readonly observation: UnvalidatedObservation;
  readonly compiledAtMs: number;
  readonly decodedEvents: readonly any[];
  readonly compilerVersion: string;
}

/** Branded nominal type for a compiled fusion envelope */
export type CompiledFusionEnvelope = CompiledFusionEnvelopeData & {
  readonly [_compiledBrand]: 'CompiledFusionEnvelope';
};

export interface ValidatedFusionEnvelopeData {
  readonly validationId: Hash256;
  readonly compiledEnvelope: CompiledFusionEnvelope;
  readonly validatedAtMs: number;
  readonly validatorVersion: string;
  readonly truthEvidence: TruthEvidence;
}

/** Branded nominal type for a validated fusion envelope */
export type ValidatedFusionEnvelope = ValidatedFusionEnvelopeData & {
  readonly [_validatedBrand]: 'ValidatedFusionEnvelope';
};

export type DurabilityBarrier =
  | 'FSYNC_COMMITTED'
  | 'QUEUED'
  | 'BUFFERED'
  | 'WRITE_COMPLETE'
  | 'FSYNC_DATA';

export const FSYNC_COMMITTED = 'FSYNC_COMMITTED' as const;

export interface CommittedEnvelopeData {
  readonly journalSeq: bigint;
  readonly envelopeHash: Hash256;
  readonly validatedEnvelope: ValidatedFusionEnvelope;
  readonly committedAtMs: number;
  readonly durability: 'FSYNC_COMMITTED';
}

/** Branded nominal type for a durably committed envelope */
export type CommittedEnvelope = CommittedEnvelopeData & {
  readonly [_committedBrand]: 'CommittedEnvelope';
};


export type IngressReceiptStatus = 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';

export interface IngressReceiptAccepted {
  readonly status: 'ACCEPTED';
  readonly observationId: Hash256;
  readonly journalSeq: bigint;
  readonly envelopeHash: Hash256;
}

export interface IngressReceiptDuplicate {
  readonly status: 'DUPLICATE';
  readonly observationId: Hash256;
  readonly reason: string;
}

export interface IngressReceiptRejected {
  readonly status: 'REJECTED';
  readonly observationId: Hash256;
  readonly reason: string;
}

export type IngressReceipt =
  | IngressReceiptAccepted
  | IngressReceiptDuplicate
  | IngressReceiptRejected;
