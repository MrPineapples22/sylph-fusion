import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store, getStoreIngressCapability } from '../../dist/store.js';
import { CanonicalIngress, DefaultFusionEnvelopeCompiler, DefaultTruthValidator, StoreIngressJournal, InMemoryIngressJournal } from '../../dist/platform/ingress/canonical-ingress.js';
import { createUnvalidatedObservation } from '../../dist/platform/ingress/observation-factory.js';
import { verifyRuntimeTelemetryEvidence, verifyRuntimeTelemetryStoreBinding } from '../../scripts/runtime-telemetry-evidence.mjs';
import { hashCanonicalV10 } from '../../scripts/canonicalization-v10.mjs';
import { RuntimeTelemetryExporter } from '../../dist/platform/ingress/runtime-telemetry-exporter.js';
import { closeEngineResources } from '../../dist/fusion.js';

// Ephemeral test-only attestation key; never written to production configuration.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const trustedPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const options = () => ({ sourceCommitSha: 'a'.repeat(40), sourceTreeSha: 'b'.repeat(40), trustedPublicKeyPem,
  signer: { async signRuntimeTelemetryRoot(root) { return sign(null, Buffer.from(root, 'hex'), privateKey).toString('base64'); } } });
const observation = (id = 1) => createUnvalidatedObservation({ sourceId: 'fixture', providerId: 'fixture', transport: 'mock',
  receivedAtMs: Date.now(), slot: id, commitment: 'confirmed', signature: `fixture-signature-${id}`,
  rawPayload: Buffer.from(JSON.stringify([id])), schemaVersion: 'fixture/v1', processingIntent: 'DETERMINISTIC_REPLAY' });
async function fixture(t, telemetry = options(), subscriber = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-telemetry-producer-'));
  const path = join(directory, 'runtime.sqlite');
  const store = new Store(path);
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const ingress = new CanonicalIngress({ compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(),
    journal: new StoreIngressJournal(store), downstreamSubscriber: subscriber, runtimeTelemetry: telemetry });
  return { directory, path, store, ingress };
}

test('C5 producer records actual ingress spans, persists before signing, and verifies against reopened exact Store', async t => {
  const telemetry = options();
  const f = await fixture(t, telemetry);
  let signed = 0;
  telemetry.signer.signRuntimeTelemetryRoot = async root => {
    const rows = await f.store.getAuditEvents('runtime_telemetry_observed_v2');
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0].body).spans.length, 5, 'all measured lifecycle operations were durable before signing');
    signed++;
    return sign(null, Buffer.from(root, 'hex'), privateKey).toString('base64');
  };
  assert.equal((await f.ingress.submit(observation())).status, 'ACCEPTED');
  const evidence = await f.ingress.captureRuntimeTelemetry();
  assert.equal(signed, 1);
  assert.equal(evidence.schemaVersion, 'SYLPH_RUNTIME_TELEMETRY_V2');
  assert.deepEqual(evidence.spans.map(s => s.name), ['ingress.compile', 'ingress.validate', 'ingress.commit', 'ingress.delivery', 'ingress.observation']);
  assert.ok(evidence.spans.every(s => s.status === 'OK' && BigInt(s.endedAtNs) >= BigInt(s.startedAtNs)));
  assert.equal(new Set(evidence.spans.map(s => s.spanId)).size, 5);
  assert.equal(new Set(evidence.spans.map(s => s.traceId)).size, 1);
  assert.ok(evidence.spans.slice(0, 4).every(s => s.parentSpanId === evidence.spans[4].spanId));
  assert.equal(verifyRuntimeTelemetryEvidence(evidence, { trustedPublicKeyPem }).valid, true);
  assert.equal(verifyRuntimeTelemetryEvidence(evidence).reason, 'C5_RUNTIME_ATTESTATION_TRUST_ROOT_MISSING');
  await f.store.close();
  const reopened = new Store(f.path);
  try {
    assert.equal(await getStoreIngressCapability(reopened).getRuntimeStoreInstanceId(), evidence.durability.storeInstanceId);
  } finally { await reopened.close(); }
  assert.equal(verifyRuntimeTelemetryStoreBinding(evidence, { databasePath: f.path }).valid, true);
});

test('C5 signer failure retains exact durable batch and retries idempotently without redelivering ingress', async t => {
  let calls = 0, deliveries = 0;
  const telemetry = options();
  telemetry.signer.signRuntimeTelemetryRoot = async root => {
    if (++calls === 1) throw new Error('signer unavailable');
    if (calls === 2) return Buffer.alloc(64).toString('base64');
    return sign(null, Buffer.from(root, 'hex'), privateKey).toString('base64');
  };
  const f = await fixture(t, telemetry, () => { deliveries++; });
  assert.equal((await f.ingress.submit(observation())).status, 'ACCEPTED');
  await assert.rejects(f.ingress.captureRuntimeTelemetry(), /signer unavailable/);
  const before = await f.store.getAuditEvents('runtime_telemetry_observed_v2');
  await assert.rejects(f.ingress.captureRuntimeTelemetry(), /C5_ATTESTATION_SIGNATURE_INVALID/);
  const artifact = await f.ingress.captureRuntimeTelemetry();
  assert.deepEqual(await f.store.getAuditEvents('runtime_telemetry_observed_v2'), before);
  assert.equal(artifact.durability.storeAuditId, before[0].id);
  assert.equal(deliveries, 1);
  await assert.rejects(f.ingress.captureRuntimeTelemetry(), /C5_CAPTURE_EMPTY/);
});

test('C5 missing signer/trust pin cannot emit or persist an artifact and never alters ingress outcomes', async t => {
  for (const [change, reason] of [[{ signer: undefined }, /C5_RUNTIME_SIGNER_MISSING/], [{ trustedPublicKeyPem: '' }, /TRUST_ROOT_MISSING/]]) {
    const f = await fixture(t, { ...options(), ...change });
    assert.equal((await f.ingress.submit(observation())).status, 'ACCEPTED');
    await assert.rejects(f.ingress.captureRuntimeTelemetry(), reason);
    assert.equal((await f.store.getAuditEvents('runtime_telemetry_observed_v2')).length, 0);
  }
  assert.throws(() => new CanonicalIngress({ compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(),
    journal: new InMemoryIngressJournal(), runtimeTelemetry: options() }), /C5_DURABLE_STORE_REQUIRED/);
});

test('C5 Store binding rejects wrong identity, changed body bytes and consistently rehashed span mismatch', async t => {
  const f = await fixture(t);
  await f.ingress.submit(observation());
  const artifact = await f.ingress.captureRuntimeTelemetry();
  await f.store.close();
  const wrong = new Store(join(f.directory, 'wrong.sqlite'));
  try { await getStoreIngressCapability(wrong).getRuntimeStoreInstanceId(); } finally { await wrong.close(); }
  assert.equal(verifyRuntimeTelemetryStoreBinding(artifact, { databasePath: join(f.directory, 'wrong.sqlite') }).reason, 'C5_DURABLE_STORE_IDENTITY_MISMATCH');
  const db = new DatabaseSync(f.path);
  try {
    const body = db.prepare('SELECT body FROM audit WHERE id=?').get(artifact.durability.storeAuditId).body;
    db.prepare('UPDATE audit SET body=? WHERE id=?').run(`${body} `, artifact.durability.storeAuditId);
    assert.equal(verifyRuntimeTelemetryStoreBinding(artifact, { databasePath: f.path }).reason, 'C5_DURABLE_STORE_RECORD_MISMATCH');
    const changed = JSON.parse(body);
    changed.spans[0].status = 'ERROR';
    const changedBody = JSON.stringify(changed);
    const hash = createHash('sha256').update(`runtime_telemetry_observed_v2:${changedBody}`).digest('hex');
    db.prepare('UPDATE audit SET body=? WHERE id=?').run(changedBody, artifact.durability.storeAuditId);
    db.prepare('UPDATE audit_event_dedupe SET event_hash=? WHERE event_id=?').run(hash, artifact.durability.storeEventId);
    const edited = { ...artifact, durability: { ...artifact.durability, storeEventHash: hash } };
    assert.equal(verifyRuntimeTelemetryStoreBinding(edited, { databasePath: f.path }).reason, 'C5_DURABLE_STORE_CONTENT_MISMATCH');
    assert.equal(verifyRuntimeTelemetryEvidence(edited, { trustedPublicKeyPem }).reason, 'C5_ATTESTATION_SIGNATURE_INVALID');
  } finally { db.close(); }
});

test('C5 lifecycle captures delivery failure and explicit retry, without inventing successful spans', async t => {
  let attempts = 0;
  const f = await fixture(t, options(), () => { if (++attempts === 1) throw new Error('consumer unavailable'); });
  assert.equal((await f.ingress.submit(observation())).reason, 'COMMITTED_DELIVERY_PENDING_RETRY');
  assert.equal(await f.ingress.retryPendingDeliveries(), 1);
  const artifact = await f.ingress.captureRuntimeTelemetry();
  assert.deepEqual(artifact.spans.filter(s => s.name === 'ingress.delivery').map(s => s.status), ['ERROR', 'OK']);
  assert.equal(artifact.spans.filter(s => s.name === 'ingress.observation').length, 2);
  assert.deepEqual(artifact.spans.filter(s => s.name === 'ingress.observation').map(s => s.status), ['ERROR', 'OK']);
  assert.equal(verifyRuntimeTelemetryEvidence(artifact, { trustedPublicKeyPem }).valid, true);
  assert.equal(verifyRuntimeTelemetryStoreBinding(artifact, { databasePath: f.path }).valid, true);
});

test('C5 observation root is ERROR when the compiler returns a rejected ingress receipt', async t => {
  const f = await fixture(t);
  const ingress = new CanonicalIngress({ compiler: { compile() { throw new Error('invalid input'); } },
    validator: new DefaultTruthValidator(), journal: new StoreIngressJournal(f.store), runtimeTelemetry: options() });
  assert.equal((await ingress.submit(observation())).status, 'REJECTED');
  const artifact = await ingress.captureRuntimeTelemetry();
  assert.deepEqual(artifact.spans.map(s => [s.name, s.status]), [['ingress.compile', 'ERROR'], ['ingress.observation', 'ERROR']]);
  assert.equal(verifyRuntimeTelemetryEvidence(artifact, { trustedPublicKeyPem }).valid, true);
});

test('runtime publication commit point prevents false timeout during delayed rename and fences duplicate publication', async t => {
  const f = await fixture(t);
  await f.ingress.submit(observation());
  const artifactPath = join(f.directory, 'committed-publication.json');
  let releaseRename, enteredRename;
  const entered = new Promise(resolve => { enteredRename = resolve; });
  const release = new Promise(resolve => { releaseRename = resolve; });
  let captures = 0, renames = 0;
  const errors = [];
  const exporter = new RuntimeTelemetryExporter({ async captureRuntimeTelemetry() { captures++; return f.ingress.captureRuntimeTelemetry(); } },
    { ...options(), artifactPath, captureIntervalMs: 25, captureTimeoutMs: 500 }, code => errors.push(code), {
      async rename(from, to) { renames++; enteredRename(); await release; await rename(from, to); },
    });
  t.after(async () => { releaseRename(); await exporter.close(); });
  const flush = exporter.flush();
  await entered;
  await flush;
  assert.deepEqual(errors, [], 'a publication already committed cannot report C5_CAPTURE_TIMEOUT');
  await exporter.flush();
  await assert.rejects(closeEngineResources({ runtimeTelemetry: exporter, store: f.store, walletLock: createServer() }),
    error => error instanceof AggregateError && error.errors.some(cause => cause.message === 'C5_PUBLICATION_PENDING_AT_SHUTDOWN'));
  await assert.rejects(exporter.close(), /C5_PUBLICATION_PENDING_AT_SHUTDOWN/);
  await assert.rejects(f.store.load(), /Database is closing/);
  assert.equal(captures, 1);
  assert.equal(renames, 1);
  assert.equal(existsSync(artifactPath), false);
  releaseRename();
  for (let i = 0; i < 100 && !existsSync(artifactPath); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(verifyRuntimeTelemetryEvidence(JSON.parse(await readFile(artifactPath, 'utf8')), { trustedPublicKeyPem }).valid, true);
  for (let i = 0; i < 100; i++) {
    try { await exporter.close(); break; }
    catch (error) { if (i === 99) throw error; await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  await exporter.close();
  assert.deepEqual(errors, []);
});

test('C5 V2 verifier rejects independently re-signed disconnected, cross-trace and out-of-root spans', async t => {
  const f = await fixture(t);
  await f.ingress.submit(observation());
  const artifact = await f.ingress.captureRuntimeTelemetry();
  for (const edit of [s => { s[3].parentSpanId = null; }, s => { s[3].traceId = 'c'.repeat(32); },
    s => { s[3].endedAtNs = (BigInt(s[4].endedAtNs) + 1n).toString(); }, s => { s.pop(); }]) {
    const altered = structuredClone(artifact);
    edit(altered.spans);
    delete altered.attestation; delete altered.evidenceHash;
    altered.attestation = { algorithm: 'Ed25519', signatureBase64: sign(null, Buffer.from(hashCanonicalV10(altered), 'hex'), privateKey).toString('base64') };
    altered.evidenceHash = hashCanonicalV10(altered);
    assert.equal(verifyRuntimeTelemetryEvidence(altered, { trustedPublicKeyPem }).reason, 'C5_SPAN_LINEAGE_INVALID');
  }
});

test('runtime export publishes verified evidence periodically and drains final ingress before Store cleanup', async t => {
  const f = await fixture(t);
  const artifactPath = join(f.directory, 'evidence.json');
  const errors = [];
  const exporter = new RuntimeTelemetryExporter(f.ingress, { ...options(), artifactPath, captureIntervalMs: 25, captureTimeoutMs: 1000 }, code => errors.push(code));
  t.after(() => exporter.close());
  await f.ingress.submit(observation(1));
  for (let i = 0; i < 100 && !existsSync(artifactPath); i++) await new Promise(resolve => setTimeout(resolve, 10));
  const first = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.equal(verifyRuntimeTelemetryEvidence(first, { trustedPublicKeyPem }).valid, true);
  await f.ingress.submit(observation(2));
  await closeEngineResources({ runtimeTelemetry: exporter, store: f.store, walletLock: createServer() });
  const final = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.notEqual(final.evidenceHash, first.evidenceHash);
  assert.equal(verifyRuntimeTelemetryStoreBinding(final, { databasePath: f.path }).valid, true);
  assert.deepEqual(errors, []);
  const bytes = await readFile(artifactPath, 'utf8');
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(await readFile(artifactPath, 'utf8'), bytes, 'closed exporter cannot restart its timer');
});

test('runtime exporter bounds stalled signing, fences late publication and never retries a hung operation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-export-timeout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = join(directory, 'never.json');
  let calls = 0, complete;
  const errors = [];
  const exporter = new RuntimeTelemetryExporter({ captureRuntimeTelemetry() {
    calls++;
    return new Promise(resolve => { complete = resolve; });
  } }, { ...options(), artifactPath, captureIntervalMs: 25, captureTimeoutMs: 25 }, code => errors.push(code));
  const started = Date.now();
  await closeEngineResources({ runtimeTelemetry: exporter, store: { close() { assert.ok(Date.now() - started < 1000); } }, walletLock: createServer() });
  assert.equal(calls, 1);
  assert.deepEqual(errors, ['C5_CAPTURE_TIMEOUT']);
  complete({ invalid: 'late result' });
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(calls, 1);
  assert.equal(existsSync(artifactPath), false);
});
