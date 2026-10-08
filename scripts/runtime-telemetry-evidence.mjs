import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashCanonicalV10 } from './canonicalization-v10.mjs';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME_TELEMETRY_EVIDENCE_PATH = resolve(ROOT_DIR, 'artifacts', 'connectivity', 'runtime-telemetry.json');
const CERTIFICATION_CONFIG_PATH = resolve(ROOT_DIR, 'config', 'certification-config.json');
const HASH = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const SPAN_ID = /^[a-f0-9]{16}$/;
const TRACE_ID = /^[a-f0-9]{32}$/;
const SPAN_NAMES = new Set(['ingress.observation', 'ingress.compile', 'ingress.validate', 'ingress.commit', 'ingress.delivery']);

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

export function verifyRuntimeTelemetryEvidence(value, { trustedPublicKeyPem } = {}) {
  const v2 = value?.schemaVersion === 'SYLPH_RUNTIME_TELEMETRY_V2';
  const required = ['schemaVersion', 'provenanceClass', 'sourceCommitSha', 'sourceTreeSha', 'runtimeInstanceId',
    'processId', 'nodeVersion', 'processStartedAtMs', 'captureStartedAtMs', 'captureEndedAtMs', 'durability', 'spans', 'attestation', 'evidenceHash'];
  if (!exactKeys(value, required) || (!v2 && value.schemaVersion !== 'SYLPH_RUNTIME_TELEMETRY_V1') || value.provenanceClass !== 'REAL_RUNTIME') {
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
  if (!exactKeys(d, ['barrier', 'storeEventId', 'storeAuditId', 'storeEventHash', ...(v2 ? ['storeInstanceId'] : [])]) || d.barrier !== 'FSYNC_COMMITTED' ||
      (v2 && (typeof d.storeInstanceId !== 'string' || !/^[a-f0-9]{32}$/.test(d.storeInstanceId))) ||
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
        (v2 && (/^0+$/.test(span.spanId) || /^0+$/.test(span.traceId))) ||
        (span.parentSpanId !== null && (typeof span.parentSpanId !== 'string' || !SPAN_ID.test(span.parentSpanId))) ||
        !SPAN_NAMES.has(span.name) || !['OK', 'ERROR'].includes(span.status) ||
        typeof span.startedAtNs !== 'string' || !/^[1-9][0-9]{0,19}$/.test(span.startedAtNs) ||
        typeof span.endedAtNs !== 'string' || !/^[1-9][0-9]{0,19}$/.test(span.endedAtNs) ||
        BigInt(span.endedAtNs) < BigInt(span.startedAtNs)) {
      return { valid: false, reason: 'C5_SPAN_INVALID' };
    }
    ids.add(span.spanId);
  }
  if (v2) {
    const parents = new Map(value.spans.map(span => [span.spanId, span]));
    const roots = new Map();
    for (const span of value.spans) {
      if (span.name === 'ingress.observation') {
        if (span.parentSpanId !== null || roots.has(span.traceId)) return { valid: false, reason: 'C5_SPAN_LINEAGE_INVALID' };
        roots.set(span.traceId, span);
      } else {
        const parent = parents.get(span.parentSpanId);
        if (!parent || parent.name !== 'ingress.observation' || parent.traceId !== span.traceId ||
            BigInt(span.startedAtNs) < BigInt(parent.startedAtNs) || BigInt(span.endedAtNs) > BigInt(parent.endedAtNs)) {
          return { valid: false, reason: 'C5_SPAN_LINEAGE_INVALID' };
        }
      }
    }
    if (roots.size === 0 || [...roots.values()].some(root => !value.spans.some(span => span.parentSpanId === root.spanId))) {
      return { valid: false, reason: 'C5_SPAN_LINEAGE_INVALID' };
    }
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

/**
 * Bind the signed receipt to the configured SQLite store. The durable row is a
 * separately persisted runtime event; its body must carry the same runtime,
 * source, interval, and span observations as the signed certificate.
 */
export function verifyRuntimeTelemetryStoreBinding(value, { databasePath = process.env.DB_PATH ?? 'fusion.sqlite' } = {}) {
  let db;
  try {
    const absolutePath = resolve(databasePath);
    db = new DatabaseSync(absolutePath, { readOnly: true, allowExtension: false });
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
    const v2 = value.schemaVersion === 'SYLPH_RUNTIME_TELEMETRY_V2';
    if (v2) {
      const present = db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='runtime_store_identity_v1'").get();
      const identities = present ? db.prepare('SELECT singleton,instance_id FROM runtime_store_identity_v1').all() : [];
      if (identities.length !== 1 || identities[0].singleton !== 1 || identities[0].instance_id !== value.durability.storeInstanceId) {
        return { valid: false, reason: 'C5_DURABLE_STORE_IDENTITY_MISMATCH' };
      }
    }
    const tables = db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='audit_event_dedupe'").get();
    if (!tables) return { valid: false, reason: 'C5_DURABLE_STORE_RECORD_MISSING' };
    const row = db.prepare(`SELECT COALESCE(a.id,d.audit_id) AS id,a.event,a.body,
      d.event_hash AS eventHash,(a.id IS NULL) AS pruned FROM audit_event_dedupe d
      LEFT JOIN audit a ON a.id=d.audit_id WHERE d.event_id=?`).get(value.durability.storeEventId);
    if (!row) return { valid: false, reason: 'C5_DURABLE_STORE_RECORD_MISSING' };
    if (row.pruned || typeof row.body !== 'string' || typeof row.event !== 'string') {
      return { valid: false, reason: 'C5_DURABLE_STORE_RECORD_PRUNED' };
    }
    if (row.id !== value.durability.storeAuditId || row.event !== (v2 ? 'runtime_telemetry_observed_v2' : 'runtime_telemetry_observed_v1') ||
        typeof row.eventHash !== 'string' || row.eventHash !== value.durability.storeEventHash ||
        createHash('sha256').update(`${row.event}:${row.body}`).digest('hex') !== row.eventHash) {
      return { valid: false, reason: 'C5_DURABLE_STORE_RECORD_MISMATCH' };
    }
    const body = JSON.parse(row.body);
    if (!exactKeys(body, ['schemaVersion', 'runtimeInstanceId', 'sourceCommitSha', 'sourceTreeSha', 'processId',
      'processStartedAtMs', 'captureStartedAtMs', 'captureEndedAtMs', 'spans', ...(v2 ? ['storeInstanceId'] : [])]) ||
        body.schemaVersion !== (v2 ? 'SYLPH_RUNTIME_TELEMETRY_STORE_V2' : 'SYLPH_RUNTIME_TELEMETRY_STORE_V1') ||
        (v2 && body.storeInstanceId !== value.durability.storeInstanceId) ||
        body.runtimeInstanceId !== value.runtimeInstanceId || body.sourceCommitSha !== value.sourceCommitSha ||
        body.sourceTreeSha !== value.sourceTreeSha || body.processId !== value.processId ||
        body.processStartedAtMs !== value.processStartedAtMs || body.captureStartedAtMs !== value.captureStartedAtMs ||
        body.captureEndedAtMs !== value.captureEndedAtMs ||
        JSON.stringify(body.spans) !== JSON.stringify(value.spans)) {
      return { valid: false, reason: 'C5_DURABLE_STORE_CONTENT_MISMATCH' };
    }
    return { valid: true, storePath: absolutePath, storeAuditId: row.id, storeEventHash: row.eventHash };
  } catch {
    return { valid: false, reason: 'C5_DURABLE_STORE_UNAVAILABLE' };
  } finally {
    db?.close();
  }
}

export function loadRuntimeTelemetryEvidence(path = RUNTIME_TELEMETRY_EVIDENCE_PATH) {
  if (!existsSync(path)) return { valid: false, reason: 'C5_DURABLE_RUNTIME_EVIDENCE_MISSING' };
  try {
    const config = JSON.parse(readFileSync(CERTIFICATION_CONFIG_PATH, 'utf8'));
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const verification = verifyRuntimeTelemetryEvidence(parsed, { trustedPublicKeyPem: config.runtimeAttestationPublicKeyPem });
    if (!verification.valid) return verification;
    const storeBinding = verifyRuntimeTelemetryStoreBinding(parsed);
    return storeBinding.valid ? { ...verification, storeBinding, evidence: parsed } : storeBinding;
  } catch {
    return { valid: false, reason: 'C5_DURABLE_RUNTIME_EVIDENCE_INVALID' };
  }
}
