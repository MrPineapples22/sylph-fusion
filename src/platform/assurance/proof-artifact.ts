/**
 * SYLPH FUSION — ASSURANCE FABRIC: PROOF ARTIFACT CONTRACT
 * Specifications: Master Blueprint Section XXXIV, XXXV (Proof Artifact Contract)
 *
 * Invariant: Every authority-bearing decision requires typed, hash-chained, cryptographic proof artifacts.
 */

import { createHash, createHmac } from 'node:crypto';

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

export function computePayloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function computeProofArtifactDigest<TClaim, TPayload>(
  params: Omit<ProofArtifact<TClaim, TPayload>, 'artifactId' | 'signature' | 'payloadHash'> & { payloadHash?: string }
): string {
  const pHash = params.payloadHash ?? computePayloadHash(params.payload);
  const sortedDeps = [...params.dependencies].sort().join(';');
  const sortedRoots = [...params.evidenceRoots].sort().join(';');

  const digestPayload = [
    params.schemaVersion,
    params.artifactType,
    params.subject,
    JSON.stringify(params.claim),
    params.evidenceClass,
    params.issuer,
    params.issuerRole,
    params.issuedAt,
    params.validFrom,
    params.validUntil,
    params.stateRoot,
    params.policyRoot,
    params.configRoot,
    params.releaseRoot,
    params.controlEpoch,
    params.revocationEpoch,
    sortedDeps,
    sortedRoots,
    pHash,
  ].join('|');

  return createHash('sha256').update(digestPayload).digest('hex');
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
  const now = Date.now();
  const payloadHash = computePayloadHash(params.payload);
  const dependencies = params.dependencies ?? [];
  const evidenceRoots = params.evidenceRoots ?? [];

  const base = {
    schemaVersion: '1.0.0' as const,
    artifactType: params.artifactType,
    subject: params.subject,
    claim: params.claim,
    evidenceClass: params.evidenceClass,
    issuer: params.issuer,
    issuerRole: params.issuerRole,
    issuedAt: now,
    validFrom: now,
    validUntil: now + params.validDurationMs,
    stateRoot: params.stateRoot,
    policyRoot: params.policyRoot,
    configRoot: params.configRoot,
    releaseRoot: params.releaseRoot,
    controlEpoch: params.controlEpoch,
    revocationEpoch: params.revocationEpoch,
    dependencies,
    evidenceRoots,
    payload: params.payload,
    payloadHash,
  };

  const digest = computeProofArtifactDigest(base);
  const signature = createHmac('sha256', params.signingKey).update(digest).digest('hex');
  const artifactId = `art_${digest.slice(0, 20)}`;

  return {
    ...base,
    artifactId,
    signature,
  };
}

export function verifyProofArtifact<TClaim, TPayload>(
  artifact: ProofArtifact<TClaim, TPayload>,
  signingKey: string,
  nowMs: number = Date.now()
): { isValid: boolean; reason?: string } {
  if (nowMs < artifact.validFrom || nowMs > artifact.validUntil) {
    return { isValid: false, reason: `EXPIRED: Valid from ${artifact.validFrom} to ${artifact.validUntil}, current is ${nowMs}` };
  }

  const expectedPayloadHash = computePayloadHash(artifact.payload);
  if (artifact.payloadHash !== expectedPayloadHash) {
    return { isValid: false, reason: 'PAYLOAD_TAMPERED: Payload hash does not match payload content' };
  }

  const digest = computeProofArtifactDigest(artifact);
  const expectedSig = createHmac('sha256', signingKey).update(digest).digest('hex');
  if (artifact.signature !== expectedSig) {
    return { isValid: false, reason: 'INVALID_SIGNATURE: Proof cryptographic signature verification failed' };
  }

  return { isValid: true };
}
