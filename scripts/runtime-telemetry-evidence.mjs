import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { hashCanonicalV10 } from './canonicalization-v10.mjs';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME_TELEMETRY_EVIDENCE_PATH = resolve(ROOT_DIR, 'artifacts', 'connectivity', 'runtime-telemetry.json');
const CERTIFICATION_CONFIG_PATH = resolve(ROOT_DIR, 'config', 'certification-config.json');
const HASH = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const SPAN_ID = /^[a-f0-9]{16}$/;
const TRACE_ID = /^[a-f0-9]{32}$/;
const SPAN_NAMES = new Set(['ingress.compile', 'ingress.validate', 'ingress.commit', 'ingress.delivery']);

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

export function verifyRuntimeTelemetryEvidence(value, { trustedPublicKeyPem } = {}) {
  const required = ['schemaVersion', 'provenanceClass', 'sourceCommitSha', 'sourceTreeSha', 'runtimeInstanceId',
    'processId', 'nodeVersion', 'processStartedAtMs', 'captureStartedAtMs', 'captureEndedAtMs', 'durability', 'spans', 'attestation', 'evidenceHash'];
  if (!exactKeys(value, required) || value.schemaVersion !== 'SYLPH_RUNTIME_TELEMETRY_V1' || value.provenanceClass !== 'REAL_RUNTIME') {
    return { valid: false, reason: 'C5_EVIDENCE_SCHEMA_INVALID' };
  }
  if (!SHA1.test(value.sourceCommitSha) || !SHA1.test(value.sourceTreeSha) ||
      typeof value.runtimeInstanceId !== 'string' || !/^[a-f0-9]{32}$/.test(value.runtimeInstanceId) ||
      !Number.isSafeInteger(value.processId) || value.processId < 1 ||
      typeof value.nodeVersion !== 'string' || !/^v(?:2[4-9]|[3-9]\d)\./.test(value.nodeVersion)) {
    return { valid: false, reason: 'C5_RUNTIME_IDENTITY_INVALID' };
  }
  if (![value.processStartedAtMs, value.captureStartedAtMs, value.captureEndedAtMs].every(Number.isSafeInteger) ||
      value.processStartedAtMs < 1 || value.captureStartedAtMs < value.processStartedAtMs ||
      value.captureEndedAtMs < value.captureStartedAtMs) {
    return { valid: false, reason: 'C5_RUNTIME_INTERVAL_INVALID' };
  }
  const d = value.durability;
  if (!exactKeys(d, ['barrier', 'storeEventId', 'storeAuditId', 'storeEventHash']) || d.barrier !== 'FSYNC_COMMITTED' ||
      typeof d.storeEventId !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/.test(d.storeEventId) ||
      !Number.isSafeInteger(d.storeAuditId) || d.storeAuditId < 1 || typeof d.storeEventHash !== 'string' || !HASH.test(d.storeEventHash)) {
    return { valid: false, reason: 'C5_DURABILITY_RECEIPT_INVALID' };
  }
  if (!Array.isArray(value.spans) || value.spans.length < 1 || value.spans.length > 10_000) {
    return { valid: false, reason: 'C5_SPANS_INVALID' };
  }
  const ids = new Set();
  for (const span of value.spans) {
    if (!exactKeys(span, ['spanId', 'traceId', 'parentSpanId', 'name', 'startedAtNs', 'endedAtNs', 'status']) ||
        typeof span.spanId !== 'string' || !SPAN_ID.test(span.spanId) || ids.has(span.spanId) ||
        typeof span.traceId !== 'string' || !TRACE_ID.test(span.traceId) ||
        (span.parentSpanId !== null && (typeof span.parentSpanId !== 'string' || !SPAN_ID.test(span.parentSpanId))) ||
        !SPAN_NAMES.has(span.name) || !['OK', 'ERROR'].includes(span.status) ||
        typeof span.startedAtNs !== 'string' || !/^[1-9][0-9]{0,19}$/.test(span.startedAtNs) ||
        typeof span.endedAtNs !== 'string' || !/^[1-9][0-9]{0,19}$/.test(span.endedAtNs) ||
        BigInt(span.endedAtNs) < BigInt(span.startedAtNs)) {
      return { valid: false, reason: 'C5_SPAN_INVALID' };
    }
    ids.add(span.spanId);
  }
  if (typeof value.evidenceHash !== 'string' || !HASH.test(value.evidenceHash)) {
    return { valid: false, reason: 'C5_EVIDENCE_HASH_INVALID' };
  }
  const attestation = value.attestation;
  if (!exactKeys(attestation, ['algorithm', 'signatureBase64']) || attestation.algorithm !== 'Ed25519' ||
      typeof attestation.signatureBase64 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(attestation.signatureBase64)) {
    return { valid: false, reason: 'C5_ATTESTATION_INVALID' };
  }
  if (typeof trustedPublicKeyPem !== 'string' || !trustedPublicKeyPem.trim()) {
    return { valid: false, reason: 'C5_RUNTIME_ATTESTATION_TRUST_ROOT_MISSING' };
  }
  let attestedRoot;
  try {
    const { evidenceHash: _evidenceHash, attestation: _attestation, ...attestedPayload } = value;
    attestedRoot = hashCanonicalV10(attestedPayload);
    const signature = Buffer.from(attestation.signatureBase64, 'base64');
    if (signature.toString('base64') !== attestation.signatureBase64 ||
        !verifySignature(null, Buffer.from(attestedRoot, 'hex'), createPublicKey(trustedPublicKeyPem), signature)) {
      return { valid: false, reason: 'C5_ATTESTATION_SIGNATURE_INVALID' };
    }
  } catch {
    return { valid: false, reason: 'C5_ATTESTATION_SIGNATURE_INVALID' };
  }
  const { evidenceHash, ...payload } = value;
  if (hashCanonicalV10(payload) !== evidenceHash) return { valid: false, reason: 'C5_EVIDENCE_HASH_MISMATCH' };
  return { valid: true, evidenceHash, attestedRoot, spanCount: value.spans.length, provenanceClass: value.provenanceClass };
}

export function loadRuntimeTelemetryEvidence(path = RUNTIME_TELEMETRY_EVIDENCE_PATH) {
  if (!existsSync(path)) return { valid: false, reason: 'C5_DURABLE_RUNTIME_EVIDENCE_MISSING' };
  try {
    const config = JSON.parse(readFileSync(CERTIFICATION_CONFIG_PATH, 'utf8'));
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const verification = verifyRuntimeTelemetryEvidence(parsed, { trustedPublicKeyPem: config.runtimeAttestationPublicKeyPem });
    return verification.valid ? { ...verification, evidence: parsed } : verification;
  } catch {
    return { valid: false, reason: 'C5_DURABLE_RUNTIME_EVIDENCE_INVALID' };
  }
}
