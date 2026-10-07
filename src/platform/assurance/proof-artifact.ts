/**
 * SYLPH FUSION — ASSURANCE FABRIC: PROOF ARTIFACT CONTRACT
 * Specifications: Master Blueprint Section XXXIV, XXXV (Proof Artifact Contract)
 *
 * HMAC artifacts provide integrity only when the verifier already holds a
 * trusted secret. They do not establish issuer identity or production authority.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson, hashCanonical } from '../pipeline/canonical-hashing.js';

export interface ProofArtifact<TClaim = unknown, TPayload = unknown> {
  readonly schemaVersion: '1.0.0';
  readonly artifactId: string;
  readonly artifactType: string;
  readonly subject: string;
  readonly claim: TClaim;
  readonly evidenceClass: string;
  readonly issuer: string;
  readonly issuerRole: string;
  readonly issuedAt: number;
  readonly validFrom: number;
  readonly validUntil: number;
  readonly stateRoot: string;
  readonly policyRoot: string;
  readonly configRoot: string;
  readonly releaseRoot: string;
  readonly controlEpoch: number;
  readonly revocationEpoch: number;
  readonly dependencies: readonly string[];
  readonly evidenceRoots: readonly string[];
  readonly payload: TPayload;
  readonly payloadHash: string;
  readonly signature: string;
}

const DATA_LIMIT_BYTES = 1_048_576;
const DATA_LIMIT_DEPTH = 64;
const DATA_LIMIT_NODES = 100_000;
const SHA256_HEX = /^[a-f0-9]{64}$/;

interface SnapshotBudget {
  nodes: number;
  bytes: number;
  readonly seen: Set<object>;
}

function addBytes(budget: SnapshotBudget, value: string): void {
  budget.bytes += Buffer.byteLength(value, 'utf8');
  if (budget.bytes > DATA_LIMIT_BYTES) throw new Error('PROOF_DATA_TOO_LARGE');
}

function snapshotJson(value: unknown, budget: SnapshotBudget, depth = 0): unknown {
  if (depth > DATA_LIMIT_DEPTH) throw new Error('PROOF_DATA_TOO_DEEP');
  budget.nodes += 1;
  if (budget.nodes > DATA_LIMIT_NODES) throw new Error('PROOF_DATA_TOO_COMPLEX');

  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    addBytes(budget, value);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('PROOF_DATA_NONFINITE_NUMBER');
    return value;
  }
  if (typeof value !== 'object' || value === null || utilTypes.isProxy(value)) {
    throw new Error('PROOF_DATA_UNSUPPORTED_VALUE');
  }
  if (budget.seen.has(value)) throw new Error('PROOF_DATA_CYCLE');
  budget.seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > DATA_LIMIT_NODES) {
        throw new Error('PROOF_ARRAY_INVALID');
      }
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== value.length + 1 || ownKeys.some(key =>
        key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) {
        throw new Error('PROOF_ARRAY_INVALID');
      }
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('PROOF_ARRAY_INVALID');
        result.push(snapshotJson(descriptor.value, budget, depth + 1));
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('PROOF_OBJECT_INVALID');
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some(key => typeof key !== 'string')) throw new Error('PROOF_OBJECT_INVALID');
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of (ownKeys as string[]).sort()) {
      addBytes(budget, key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('PROOF_OBJECT_INVALID');
      result[key] = snapshotJson(descriptor.value, budget, depth + 1);
    }
    return result;
  } finally {
    budget.seen.delete(value);
  }
}

function snapshotData(value: unknown): unknown {
  const snapshot = snapshotJson(value, { nodes: 0, bytes: 0, seen: new Set() });
  if (Buffer.byteLength(canonicalJson(snapshot), 'utf8') > DATA_LIMIT_BYTES) throw new Error('PROOF_DATA_TOO_LARGE');
  return snapshot;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function snapshotRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  const snapshot = snapshotData(value);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('PROOF_RECORD_INVALID');
  const record = snapshot as Record<string, unknown>;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Object.keys(record);
  if (requiredKeys.some(key => !Object.hasOwn(record, key)) || keys.some(key => !allowed.has(key))) {
    throw new Error('PROOF_RECORD_FIELDS_INVALID');
  }
  return record;
}

const ARTIFACT_KEYS = [
  'schemaVersion', 'artifactId', 'artifactType', 'subject', 'claim', 'evidenceClass', 'issuer', 'issuerRole',
  'issuedAt', 'validFrom', 'validUntil', 'stateRoot', 'policyRoot', 'configRoot', 'releaseRoot', 'controlEpoch',
  'revocationEpoch', 'dependencies', 'evidenceRoots', 'payload', 'payloadHash', 'signature',
] as const;

const DIGEST_KEYS = [
  'schemaVersion', 'artifactType', 'subject', 'claim', 'evidenceClass', 'issuer', 'issuerRole', 'issuedAt',
  'validFrom', 'validUntil', 'stateRoot', 'policyRoot', 'configRoot', 'releaseRoot', 'controlEpoch',
  'revocationEpoch', 'dependencies', 'evidenceRoots', 'payload',
] as const;

function validString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => validString(item));
}

function validateDigestFields(record: Record<string, unknown>): void {
  for (const key of ['artifactType', 'subject', 'evidenceClass', 'issuer', 'issuerRole', 'stateRoot', 'policyRoot', 'configRoot', 'releaseRoot']) {
    if (!validString(record[key])) throw new Error(`PROOF_FIELD_INVALID:${key}`);
  }
  for (const key of ['issuedAt', 'validFrom', 'validUntil', 'controlEpoch', 'revocationEpoch']) {
    if (typeof record[key] !== 'number' || !Number.isSafeInteger(record[key]) || record[key] < 0) {
      throw new Error(`PROOF_FIELD_INVALID:${key}`);
    }
  }
  if (!validStringArray(record.dependencies) || !validStringArray(record.evidenceRoots)) {
    throw new Error('PROOF_FIELD_INVALID:dependencies_or_evidenceRoots');
  }
}

export function computePayloadHash(payload: unknown): string {
  return hashCanonical(snapshotData(payload));
}

export function computeProofArtifactDigest<TClaim, TPayload>(
  params: Omit<ProofArtifact<TClaim, TPayload>, 'artifactId' | 'signature' | 'payloadHash'> & { payloadHash?: string }
): string {
  const record = snapshotRecord(params, DIGEST_KEYS, ['payloadHash']);
  validateDigestFields(record);
  const payloadHash = record.payloadHash ?? hashCanonical(record.payload);
  if (typeof payloadHash !== 'string' || !SHA256_HEX.test(payloadHash)) throw new Error('PROOF_PAYLOAD_HASH_INVALID');
  const digestPayload = Object.fromEntries(DIGEST_KEYS.map(key => [
    key,
    key === 'dependencies' || key === 'evidenceRoots'
      ? [...(record[key] as string[])].sort()
      : record[key],
  ]));
  return hashCanonical({ schema: 'SYLPH_PROOF_ARTIFACT_V1', ...digestPayload, payloadHash });
}

export function createProofArtifact<TClaim, TPayload>(params: {
  artifactType: string;
  subject: string;
  claim: TClaim;
  evidenceClass: string;
  issuer: string;
  issuerRole: string;
  validDurationMs: number;
  stateRoot: string;
  policyRoot: string;
  configRoot: string;
  releaseRoot: string;
  controlEpoch: number;
  revocationEpoch: number;
  dependencies?: readonly string[];
  evidenceRoots?: readonly string[];
  payload: TPayload;
  signingKey: string;
}): ProofArtifact<TClaim, TPayload> {
  const input = snapshotRecord(params, [
    'artifactType', 'subject', 'claim', 'evidenceClass', 'issuer', 'issuerRole', 'validDurationMs', 'stateRoot',
    'policyRoot', 'configRoot', 'releaseRoot', 'controlEpoch', 'revocationEpoch', 'payload', 'signingKey',
  ], ['dependencies', 'evidenceRoots']);
  if (!validString(input.signingKey)) throw new Error('PROOF_SIGNING_KEY_INVALID');
  if (typeof input.validDurationMs !== 'number' || !Number.isSafeInteger(input.validDurationMs)) {
    throw new Error('PROOF_DURATION_INVALID');
  }
  const now = Date.now();
  const validUntil = now + input.validDurationMs;
  if (!Number.isSafeInteger(validUntil)) throw new Error('PROOF_EXPIRY_INVALID');
  const dependencies = input.dependencies ?? [];
  const evidenceRoots = input.evidenceRoots ?? [];
  if (!validStringArray(dependencies) || !validStringArray(evidenceRoots)) throw new Error('PROOF_REFERENCES_INVALID');

  const base = {
    schemaVersion: '1.0.0' as const,
    artifactType: input.artifactType,
    subject: input.subject,
    claim: input.claim,
    evidenceClass: input.evidenceClass,
    issuer: input.issuer,
    issuerRole: input.issuerRole,
    issuedAt: now,
    validFrom: now,
    validUntil,
    stateRoot: input.stateRoot,
    policyRoot: input.policyRoot,
    configRoot: input.configRoot,
    releaseRoot: input.releaseRoot,
    controlEpoch: input.controlEpoch,
    revocationEpoch: input.revocationEpoch,
    dependencies: [...dependencies],
    evidenceRoots: [...evidenceRoots],
    payload: input.payload,
  };
  const digest = computeProofArtifactDigest(base as unknown as Parameters<typeof computeProofArtifactDigest>[0]);
  const payloadHash = computePayloadHash(base.payload);
  const signature = createHmac('sha256', input.signingKey).update(digest, 'utf8').digest('hex');
  const artifactId = `art_${digest.slice(0, 20)}`;

  return deepFreeze({ ...base, artifactId, payloadHash, signature }) as ProofArtifact<TClaim, TPayload>;
}

export function verifyProofArtifact<TClaim, TPayload>(
  artifact: ProofArtifact<TClaim, TPayload>,
  signingKey: string,
  nowMs: number = Date.now()
): { isValid: boolean; reason?: string } {
  try {
    if (!validString(signingKey)) return { isValid: false, reason: 'SIGNING_KEY_INVALID' };
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return { isValid: false, reason: 'VERIFICATION_TIME_INVALID' };
    const record = snapshotRecord(artifact, ARTIFACT_KEYS);
    if (record.schemaVersion !== '1.0.0') return { isValid: false, reason: 'SCHEMA_VERSION_UNSUPPORTED' };
    validateDigestFields(record);
    if (!validString(record.artifactId) || !SHA256_HEX.test(String(record.payloadHash)) ||
        typeof record.signature !== 'string' || !SHA256_HEX.test(record.signature)) {
      return { isValid: false, reason: 'ARTIFACT_DIGEST_FIELDS_INVALID' };
    }
    if (typeof record.validFrom !== 'number' || typeof record.validUntil !== 'number' ||
        nowMs < record.validFrom || nowMs > record.validUntil) {
      return { isValid: false, reason: `EXPIRED: Valid from ${record.validFrom} to ${record.validUntil}, current is ${nowMs}` };
    }
    const expectedPayloadHash = hashCanonical(record.payload);
    if (record.payloadHash !== expectedPayloadHash) {
      return { isValid: false, reason: 'PAYLOAD_TAMPERED: Payload hash does not match payload content' };
    }
    // The verifier has already snapshotted and validated the full envelope. Project
    // only the signed fields so envelope metadata cannot leak into digest input.
    const digestInput = Object.fromEntries(
      [...DIGEST_KEYS, 'payloadHash']
        .filter(key => Object.hasOwn(record, key))
        .map(key => [key, record[key]])
    );
    const digest = computeProofArtifactDigest(digestInput as unknown as Parameters<typeof computeProofArtifactDigest>[0]);
    const expectedArtifactId = `art_${digest.slice(0, 20)}`;
    if (record.artifactId !== expectedArtifactId) return { isValid: false, reason: 'ARTIFACT_ID_MISMATCH' };
    const expectedSignature = createHmac('sha256', signingKey).update(digest, 'utf8').digest();
    const observedSignature = Buffer.from(record.signature, 'hex');
    if (!timingSafeEqual(expectedSignature, observedSignature)) {
      return { isValid: false, reason: 'INVALID_SIGNATURE: Proof integrity verification failed' };
    }
    return { isValid: true };
  } catch (error) {
    return { isValid: false, reason: `MALFORMED_ARTIFACT: ${error instanceof Error ? error.message : 'invalid data'}` };
  }
}
