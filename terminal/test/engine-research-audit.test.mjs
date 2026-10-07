import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Store} from '../../dist/store.js';
import {readEngineResearchAudit, resolveEngineDatabasePath, sqliteReadOnlyOptionSupported} from '../engine-research-audit.mjs';
import {parseRuntimeIdentityResponse} from '../src/components/engine-research-audit.js';

test('runtime identity UI parser accepts consistent current and changed disk fingerprints', () => {
  const unchanged = 'a'.repeat(64);
  const changed = 'b'.repeat(64);
  const base = {schemaVersion: 1, capturedAtMs: 100, startupFingerprint: unchanged,
    currentFingerprint: unchanged, changedArtifactCount: 0, changedArtifacts: [], changedArtifactsTruncated: false};
  assert.equal(parseRuntimeIdentityResponse({...base, status: 'UNCHANGED_SINCE_STARTUP'}).status, 'UNCHANGED_SINCE_STARTUP');
  const parsed = parseRuntimeIdentityResponse({...base, status: 'CHANGED_SINCE_STARTUP', currentFingerprint: changed,
    changedArtifactCount: 1, changedArtifacts: ['dist/fusion.js']});
  assert.equal(parsed.status, 'CHANGED_SINCE_STARTUP');
  assert.equal(parsed.changedArtifacts[0], 'dist/fusion.js');
});

test('runtime identity UI parser fails closed on inconsistent or unsafe diagnostics', () => {
  const base = {schemaVersion: 1, capturedAtMs: 100, startupFingerprint: 'a'.repeat(64),
    currentFingerprint: 'b'.repeat(64), status: 'CHANGED_SINCE_STARTUP', changedArtifactCount: 1,
    changedArtifacts: ['dist/fusion.js'], changedArtifactsTruncated: false};
  assert.equal(parseRuntimeIdentityResponse({...base, currentFingerprint: base.startupFingerprint}).status, 'UNKNOWN');
  assert.equal(parseRuntimeIdentityResponse({...base, changedArtifacts: ['../secrets.env']}).status, 'UNKNOWN');
  assert.equal(parseRuntimeIdentityResponse({schemaVersion: 1, capturedAtMs: 100, startupFingerprint: 'a'.repeat(64),
    status: 'UNKNOWN', reason: 'RUNTIME_ARTIFACT_SCAN_FAILED', currentFingerprint: null,
    changedArtifactCount: null, changedArtifacts: [], changedArtifactsTruncated: false}).status, 'UNKNOWN');
});

test('Engine audit database path honors explicit path, DB_PATH, project .env, then engine default', () => {
  const root = mkdtempSync(join(tmpdir(), 'sylph-path-fixture-'));
  try {
    assert.equal(resolveEngineDatabasePath(root, {SYLPH_ENGINE_DB_PATH: 'custom.sqlite'}), join(root, 'custom.sqlite'));
    assert.equal(resolveEngineDatabasePath(root, {DB_PATH: 'configured.sqlite'}), join(root, 'configured.sqlite'));
    writeFileSync(join(root, '.env'), 'DB_PATH=project.sqlite\nRPC_URLS=https://private.invalid\n');
    assert.equal(resolveEngineDatabasePath(root, {}), join(root, 'project.sqlite'));
    rmSync(join(root, '.env'));
    assert.equal(resolveEngineDatabasePath(root, {}), join(root, 'fusion.sqlite'));
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('SQLite audit reads require a runtime version with the documented read-only open option', () => {
  assert.equal(sqliteReadOnlyOptionSupported('24.3.9'), false);
  assert.equal(sqliteReadOnlyOptionSupported('24.4.0'), true);
  assert.equal(sqliteReadOnlyOptionSupported('24.21.0'), true);
  assert.equal(sqliteReadOnlyOptionSupported('25.0.0'), true);
  assert.equal(sqliteReadOnlyOptionSupported('not-a-version'), false);
});

test('read-only candidate projection reads retained Engine Store events without converting them into lifecycle stages', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'sylph-engine-audit-'));
  const databasePath = join(directory, 'engine.sqlite');
  const store = new Store(databasePath);
  t.after(async () => { await store.close(); rmSync(directory, {recursive: true, force: true}); });

  await store.appendAuditEvent('candidate_discovered_v1', {
    schemaVersion: 1, candidateId: 'candidate-generation-1', mint: 'mint-1', creator: 'creator-1',
    slot: 123, sourceObservation: {raw: 'not projected'}, observedAtMs: 1_800_000_000_001,
  }, 'audit:discovery:1');
  await store.appendAuditEvent('candidate_order_build_failed_v1', {
    schemaVersion: 1, candidateGenerationId: 'candidate-generation-1', attemptId: 'attempt-1',
    attemptNumber: 1, side: 'buy', mint: 'mint-1', failedAtMs: 1_800_000_000_002,
    failureClass: 'STALE_MARKET_SNAPSHOT',
    error: 'sensitive-detail-is-not-projected',
  }, 'audit:failed:1');
  await store.appendAuditEvent('candidate_order_built_v1', {
    schemaVersion: 1, candidateGenerationId: 'candidate-generation-1', attemptId: 'attempt-2',
    attemptNumber: 2, side: 'buy', mint: 'mint-1', pendingOrderId: 'paper-order-2',
    requestedAmountRaw: '100000000', requestedAmountUnit: 'LAMPORTS',
    quotedOutput: '1250000', quotedOutputUnit: 'TOKEN_RAW', marketSnapshotAtMs: 1_800_000_000_002,
    marketSnapshotAgeMs: 8,
    baseFeeLamports: '5000', priorityFeeLamports: '200000', jitoTipLamports: '10000',
    rentLamports: '3000000', estimatedSellSlippageLamports: '0', modeledSlippageBps: 300,
    costEvidenceClass: 'PAPER_BUILD_ESTIMATE', outcomeEvidenceClass: 'PAPER_BUILD_RESULT',
  }, 'audit:built:1');
  await store.appendAuditEvent('candidate_paper_fill_v1', {
    schemaVersion: 1, candidateGenerationId: 'candidate-generation-1', attemptId: 'attempt-3',
    attemptNumber: 2, side: 'buy', mint: 'mint-1', settledAtMs: 1_800_000_000_003,
    requestedAmountRaw: '100000000', requestedAmountUnit: 'LAMPORTS',
    quotedOutput: '1250000', quotedOutputUnit: 'TOKEN_RAW', simulatedLamportDelta: '-1000000', baseFeeLamports: '5000',
    priorityFeeLamports: '200000', jitoTipLamports: '10000', rentLamports: '3000000',
    estimatedSellSlippageLamports: '0', modeledSlippageBps: 300, costEvidenceClass: 'PAPER_SIMULATED_FILL',
    outcomeEvidenceClass: 'PAPER_SIMULATED_FILL_NOT_CHAIN_EVIDENCE',
  }, 'audit:paper-fill:1');
  await store.appendAuditEvent('candidate_tracking_ended_v1', {
    schemaVersion: 1, candidateGenerationId: 'candidate-generation-1', mint: 'mint-1',
    endedAtMs: 1_800_000_000_004, reason: 'TRACKING_CAPACITY_EVICTION',
    outcomeStatus: 'UNRESOLVED', lastObservedSlot: 124, sourceObservationId: 'observation-1', snapshotId: 'snapshot-1',
  }, 'audit:tracking-ended:1');
  await store.appendAuditEvent('candidate_restriction_v1', {
    schemaVersion: 1, candidateGenerationId: 'candidate-generation-1', mint: 'mint-1',
    scope: 'MARKET', effect: 'WAIT', reason: 'EXCESSIVE_PRICE_DRIFT', reasonCode: 'EXCESSIVE_PRICE_DRIFT',
    decisionAtMs: 1_800_000_000_005, snapshotId: 'snapshot-restricted',
  }, 'audit:restriction:1');
  await store.save({version: 1, researchEvidenceLoss: {
    schemaVersion: 1, failureCount: 1, firstFailureAtMs: 1_800_000_000_000,
    lastFailureAtMs: 1_800_000_000_000, lastEvent: 'candidate_paper_fill_v1',
    lastReason: 'write_rejected', recoveryRequired: true,
  }});

  const result = readEngineResearchAudit(databasePath);
  assert.equal(result.recordStatus, 'RECORDED');
  assert.equal(result.completeness, 'UNKNOWN');
  assert.equal(result.source, 'ENGINE_AUDIT_STORE');
  assert.equal(result.returnedEventCount, 6);
  assert.equal(result.invalidEventCount, 0);
  assert.equal(result.researchEvidenceLossMarker, 'RECORDED');
  assert.deepEqual(result.events.map(event => event.eventType), [
    'candidate_restriction_v1', 'candidate_tracking_ended_v1', 'candidate_paper_fill_v1', 'candidate_order_built_v1', 'candidate_order_build_failed_v1', 'candidate_discovered_v1',
  ]);
  assert.equal(result.events[0].fields.scope, 'MARKET');
  assert.equal(result.events[0].fields.effect, 'WAIT');
  assert.equal(result.events[0].fields.reasonCode, 'EXCESSIVE_PRICE_DRIFT');
  assert.equal(Object.hasOwn(result.events[0].fields, 'reason'), false, 'free-form restriction text is not projected');
  assert.equal(result.events[1].fields.outcomeStatus, 'UNRESOLVED');
  assert.equal(result.events[1].fields.reason, 'TRACKING_CAPACITY_EVICTION');
  assert.equal(result.events[2].fields.outcomeEvidenceClass, 'PAPER_SIMULATED_FILL_NOT_CHAIN_EVIDENCE');
  assert.equal(result.events[2].fields.costEvidenceClass, 'PAPER_SIMULATED_FILL');
  assert.equal(result.events[2].fields.simulatedLamportDelta, '-1000000');
  assert.equal(result.events[2].fields.requestedAmountUnit, 'LAMPORTS');
  assert.equal(result.events[2].fields.baseFeeLamports, '5000');
  assert.equal(result.events[3].fields.costEvidenceClass, 'PAPER_BUILD_ESTIMATE');
  assert.equal(result.events[3].fields.marketSnapshotAgeMs, 8);
  assert.equal(result.events[3].fields.jitoTipLamports, '10000');
  assert.equal(result.events[3].fields.requestedAmountUnit, 'LAMPORTS');
  assert.equal(result.events[3].fields.quotedOutputUnit, 'TOKEN_RAW');
  assert.equal(result.events[4].fields.failureClass, 'STALE_MARKET_SNAPSHOT');
  assert.equal(Object.hasOwn(result.events[4].fields, 'error'), false);
  assert.equal(result.events[5].fields.candidateId, 'candidate-generation-1');
  assert.equal(Object.hasOwn(result.events[5].fields, 'sourceObservation'), false);

  const readOnlyCheck = new DatabaseSync(databasePath, {readOnly: true});
  assert.throws(() => readOnlyCheck.exec("INSERT INTO audit(at,event,body) VALUES(1,'candidate_discovered_v1','{}')"));
  readOnlyCheck.close();
});

test('missing and incompatible Engine audit databases stay UNKNOWN and are never created', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sylph-engine-audit-missing-'));
  const missing = join(directory, 'missing.sqlite');
  const absent = readEngineResearchAudit(missing);
  assert.equal(absent.recordStatus, 'UNKNOWN');
  assert.equal(absent.completeness, 'UNKNOWN');
  assert.equal(existsSync(missing), false);

  const wrong = join(directory, 'wrong.sqlite');
  const db = new DatabaseSync(wrong);
  db.exec('CREATE TABLE unrelated(value TEXT)');
  db.close();
  const incompatible = readEngineResearchAudit(wrong);
  assert.equal(incompatible.recordStatus, 'UNKNOWN');
  assert.equal(incompatible.reason, 'AUDIT_SCHEMA_UNAVAILABLE');
  rmSync(directory, {recursive: true, force: true});
});

test('malformed and oversized candidate event payloads are visible as invalid without exposing their body', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sylph-engine-audit-invalid-'));
  const databasePath = join(directory, 'engine.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, event TEXT NOT NULL, body TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)');
  insert.run(Date.now(), 'candidate_discovered_v1', '[]');
  insert.run(Date.now(), 'candidate_order_build_failed_v1', 'x'.repeat(70_000));
  insert.run(Date.now(), 'candidate_order_build_failed_v1', JSON.stringify({mint: '', candidateGenerationId: 'candidate-1', attemptId: 'attempt-1'}));
  insert.run(Date.now(), 'candidate_order_build_failed_v1', JSON.stringify({mint: 'mint-1', candidateGenerationId: 3, attemptId: 'attempt-1'}));
  insert.run(Date.now(), 'candidate_order_build_failed_v1', JSON.stringify({mint: 'mint-1', candidateGenerationId: 'candidate-1', attemptId: 'attempt-1', failureClass: 'UNRECOGNIZED'}));
  insert.run(Date.now(), 'candidate_restriction_v1', JSON.stringify({mint: 'mint-1', candidateGenerationId: 'candidate-1', scope: 'MARKET', effect: 'WAIT', reasonCode: 'private-provider-detail'}));
  insert.run(Date.now(), 'candidate_paper_fill_v1', JSON.stringify({mint: 'mint-1', candidateGenerationId: 'candidate-1', attemptId: 'attempt-1', privateObservation: '☃'.repeat(22_000)}));
  insert.run(Date.now(), 'candidate_paper_fill_v1', JSON.stringify({mint: 'mint-1', candidateGenerationId: 'candidate-1', attemptId: 'attempt-2', baseFeeLamports: '5e3'}));
  db.close();

  const result = readEngineResearchAudit(databasePath);
  assert.equal(result.recordStatus, 'RECORDED');
  assert.equal(result.completeness, 'UNKNOWN');
  assert.equal(result.invalidEventCount, 8);
  assert.ok(result.events.every(event => event.payloadStatus === 'UNPROJECTABLE' && Object.keys(event.fields).length === 0));
  rmSync(directory, {recursive: true, force: true});
});
