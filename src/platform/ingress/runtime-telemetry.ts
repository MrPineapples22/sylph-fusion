import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import type { StoreIngressCapability } from '../../store.js';
import { hashCanonical } from '../pipeline/canonical-hashing.js';

/** Dedicated runtime evidence service. This is deliberately not a transaction signer. */
export interface RuntimeAttestationSigner {
  signRuntimeTelemetryRoot(rootSha256: string): Promise<string>;
}
export interface RuntimeTelemetryOptions {
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly trustedPublicKeyPem: string;
  readonly signer: RuntimeAttestationSigner;
}
type SpanName = 'ingress.observation' | 'ingress.compile' | 'ingress.validate' | 'ingress.commit' | 'ingress.delivery';
export interface RuntimeTelemetryTrace { readonly traceId: string; readonly rootSpanId: string }
interface RuntimeSpan {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId: string | null;
  readonly name: SpanName;
  readonly startedAtNs: string;
  readonly endedAtNs: string;
  readonly status: 'OK' | 'ERROR';
}
const EVENT = 'runtime_telemetry_observed_v2';
const PROCESS_STARTED_AT = Math.floor(performance.timeOrigin);
const nonzeroId = (bytes: number) => {
  let id: string;
  do { id = randomBytes(bytes).toString('hex'); } while (/^0+$/.test(id));
  return id;
};

/** Internal ingress observer. It has no decision, delivery or wallet capability.
 * Capture is explicit, bounded and serialized. A failed signing attempt retains
 * its exact immutable snapshot for retry; new observations enter the next batch.
 * Returned JSON is the artifact; callers choose its publication destination. */
export class RuntimeTelemetryCapture {
  readonly #store: StoreIngressCapability;
  readonly #options: RuntimeTelemetryOptions;
  readonly #runtimeInstanceId = nonzeroId(16);
  readonly #spans: RuntimeSpan[] = [];
  #captureStartedAtMs = Date.now();
  #active = 0;
  #overflow = false;
  #pending: { body: Readonly<Record<string, unknown>>; storeEventId: string } | null = null;
  #capture: Promise<Readonly<Record<string, unknown>>> | null = null;

  constructor(store: StoreIngressCapability, options: RuntimeTelemetryOptions) {
    this.#store = store;
    this.#options = Object.freeze({ ...options });
  }

  async observe<T>(operation: (trace: RuntimeTelemetryTrace) => T | Promise<T>, succeeded: (result: T) => boolean): Promise<T> {
    let trace: RuntimeTelemetryTrace;
    try { trace = { traceId: nonzeroId(16), rootSpanId: nonzeroId(8) }; }
    catch { this.#overflow = true; trace = { traceId: '0'.repeat(32), rootSpanId: '0'.repeat(16) }; }
    return this.measure('ingress.observation', trace, () => operation(trace), succeeded);
  }

  async measure<T>(name: SpanName, trace: RuntimeTelemetryTrace, operation: () => T | Promise<T>, succeeded: (result: T) => boolean = () => true): Promise<T> {
    const startedAtNs = process.hrtime.bigint().toString();
    this.#active++;
    let status: 'OK' | 'ERROR' = 'ERROR';
    try {
      const result = await operation();
      status = succeeded(result) ? 'OK' : 'ERROR';
      return result;
    } finally {
      this.#active--;
      // Never let a broken observer change the result of authoritative work.
      try {
        if (this.#spans.length >= 128) { this.#overflow = true; }
        else this.#spans.push(Object.freeze({ spanId: name === 'ingress.observation' ? trace.rootSpanId : nonzeroId(8), traceId: trace.traceId,
          parentSpanId: name === 'ingress.observation' ? null : trace.rootSpanId, name,
          startedAtNs, endedAtNs: process.hrtime.bigint().toString(), status }));
      } catch { this.#overflow = true; }
    }
  }

  capture(): Promise<Readonly<Record<string, unknown>>> {
    if (this.#capture) return this.#capture;
    const promise = this.#attest();
    this.#capture = promise;
    void promise.finally(() => { this.#capture = null; }).catch(() => {});
    return promise;
  }

  async #attest(): Promise<Readonly<Record<string, unknown>>> {
    const { sourceCommitSha, sourceTreeSha, signer, trustedPublicKeyPem } = this.#options;
    if (!/^[a-f0-9]{40}$/.test(sourceCommitSha) || !/^[a-f0-9]{40}$/.test(sourceTreeSha)) throw new Error('C5_SOURCE_IDENTITY_INVALID');
    if (!signer || typeof signer.signRuntimeTelemetryRoot !== 'function') throw new Error('C5_RUNTIME_SIGNER_MISSING');
    if (typeof trustedPublicKeyPem !== 'string' || !trustedPublicKeyPem.trim()) throw new Error('C5_RUNTIME_ATTESTATION_TRUST_ROOT_MISSING');
    const publicKey = createPublicKey(trustedPublicKeyPem);
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('C5_RUNTIME_ATTESTATION_KEY_INVALID');
    if (this.#overflow) throw new Error('C5_CAPTURE_OVERFLOW');
    if (this.#active) throw new Error('C5_CAPTURE_OPERATIONS_PENDING');
    await this.#store.assertDurable();
    const storeInstanceId = await this.#store.getRuntimeStoreInstanceId();
    if (!this.#pending) {
      if (!this.#spans.length) throw new Error('C5_CAPTURE_EMPTY');
      // There are no awaits between the final state check and snapshot sealing.
      if (this.#active || this.#overflow) throw new Error('C5_CAPTURE_OPERATIONS_PENDING');
      const body = Object.freeze({ schemaVersion: 'SYLPH_RUNTIME_TELEMETRY_STORE_V2', storeInstanceId,
        runtimeInstanceId: this.#runtimeInstanceId, sourceCommitSha, sourceTreeSha, processId: process.pid,
        processStartedAtMs: PROCESS_STARTED_AT, captureStartedAtMs: this.#captureStartedAtMs,
        captureEndedAtMs: Date.now(), spans: Object.freeze(this.#spans.splice(0)) });
      this.#captureStartedAtMs = Date.now();
      this.#pending = { body, storeEventId: `runtime:${hashCanonical(body)}` };
    }
    const { body, storeEventId } = this.#pending;
    if (body.storeInstanceId !== storeInstanceId) throw new Error('C5_DURABLE_STORE_IDENTITY_MISMATCH');
    const expectedBody = JSON.stringify(body);
    const expectedHash = createHash('sha256').update(`${EVENT}:${expectedBody}`).digest('hex');
    const result = await this.#store.appendAuditEvent(EVENT, body, storeEventId);
    const row = await this.#store.getAuditEventByStableId(storeEventId);
    if (!row || row.pruned || row.id !== result.auditId || row.event !== EVENT || row.body !== expectedBody || row.eventHash !== expectedHash) {
      throw new Error('C5_DURABLE_STORE_RECORD_MISMATCH');
    }
    const { schemaVersion: _schemaVersion, storeInstanceId: _storeInstanceId, ...observation } = body;
    const payload = { schemaVersion: 'SYLPH_RUNTIME_TELEMETRY_V2', provenanceClass: 'REAL_RUNTIME', ...observation,
      nodeVersion: process.version, durability: { barrier: 'FSYNC_COMMITTED', storeInstanceId,
        storeEventId, storeAuditId: row.id, storeEventHash: expectedHash } };
    // All payload strings are controlled ASCII, so the runtime canonical hash
    // equals V10; the independent verifier tests that contract on emitted bytes.
    const root = hashCanonical(payload);
    const signatureBase64 = await signer.signRuntimeTelemetryRoot(root);
    if (typeof signatureBase64 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signatureBase64)) throw new Error('C5_ATTESTATION_SIGNATURE_INVALID');
    const signature = Buffer.from(signatureBase64, 'base64');
    if (signature.toString('base64') !== signatureBase64 || !verify(null, Buffer.from(root, 'hex'), publicKey, signature)) throw new Error('C5_ATTESTATION_SIGNATURE_INVALID');
    const attested = { ...payload, attestation: { algorithm: 'Ed25519', signatureBase64 } };
    const artifact = { ...attested, evidenceHash: hashCanonical(attested) };
    this.#pending = null;
    // Defensive JSON snapshot: caller mutation cannot change retained evidence.
    return Object.freeze(JSON.parse(JSON.stringify(artifact)));
  }
}
