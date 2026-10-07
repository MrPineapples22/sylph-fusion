import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { appendFileSync, existsSync, linkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DurableResearchSpool,
  DEFAULT_MAX_CAPACITY,
  DEFAULT_MAX_PAYLOAD_BYTES,
  stableResearchEventId,
} from '../../dist/platform/audit/durable-research-spool.js';
import { Engine } from '../../dist/fusion.js';

test('Engine spools execution audit before async Store ack so restart repairs immediate process loss', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sylph-spool-crash-window-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const spoolPath = join(dir, 'research.jsonl');
  const childPath = join(dir, 'write-and-exit.mjs');
  const storeUrl = pathToFileURL(join(process.cwd(), 'dist/store.js')).href;
  const engineUrl = pathToFileURL(join(process.cwd(), 'dist/fusion.js')).href;
  const spoolUrl = pathToFileURL(join(process.cwd(), 'dist/platform/audit/durable-research-spool.js')).href;
  writeFileSync(childPath, `
    import { Store } from ${JSON.stringify(storeUrl)};
    import { Engine } from ${JSON.stringify(engineUrl)};
    import { DurableResearchSpool } from ${JSON.stringify(spoolUrl)};
    const [dbPath, spoolPath] = process.argv.slice(2);
    const store = new Store(dbPath);
    await store.load();
    const engine = Object.create(Engine.prototype);
    engine.store = store;
    engine.researchSpool = new DurableResearchSpool({ spoolFilePath: spoolPath });
    engine.state = {};
    engine.persistResearchObservation('candidate_entry_gates_passed_v1', {
      attemptId: 'attempt-crash', candidateGenerationId: 'generation-crash', mint: 'mint-crash'
    }, 'attempt-crash');
    // Deliberately bypass worker acknowledgement and graceful shutdown.
    process.exit(0);
  `);

  const child = spawnSync(process.execPath, [childPath, dbPath, spoolPath], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr || child.error?.message);

  const spool = new DurableResearchSpool({ spoolFilePath: spoolPath });
  assert.equal(spool.getSnapshot().pendingCount, 1);
  const store = new (await import('../../dist/store.js')).Store(dbPath);
  try {
    await store.load();
    const replay = await spool.replay(store);
    assert.equal(replay.replayedCount, 1);
    assert.equal(replay.remainingCount, 0);
    const rows = await store.getAuditEvents('candidate_entry_gates_passed_v1', 10);
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(rows[0].body), {
      attemptId: 'attempt-crash', candidateGenerationId: 'generation-crash', mint: 'mint-crash'
    });
  } finally {
    await store.close();
  }
});

test('replay after SQLite commit but before spool compaction remains exactly once after restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sylph-spool-after-commit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const spoolPath = join(dir, 'research.jsonl');
  const childPath = join(dir, 'commit-and-exit.mjs');
  const payload = { attemptId: 'attempt-after-commit', candidateGenerationId: 'generation-after-commit' };
  const spool = new DurableResearchSpool({ spoolFilePath: spoolPath });
  assert.equal(spool.enqueue('AUDIT_EVENT', 'candidate_paper_fill_v1', payload, 'attempt-after-commit').accepted, true);
  const storeUrl = pathToFileURL(join(process.cwd(), 'dist/store.js')).href;
  const spoolUrl = pathToFileURL(join(process.cwd(), 'dist/platform/audit/durable-research-spool.js')).href;
  writeFileSync(childPath, `
    import { Store } from ${JSON.stringify(storeUrl)};
    import { DurableResearchSpool } from ${JSON.stringify(spoolUrl)};
    const [dbPath, spoolPath] = process.argv.slice(2);
    const store = new Store(dbPath);
    await store.load();
    const append = store.appendAuditEvent.bind(store);
    store.appendAuditEvent = async (...args) => {
      await append(...args);
      // SQLite has committed, but replay has not returned to compact the spool.
      process.exit(0);
    };
    await new DurableResearchSpool({ spoolFilePath: spoolPath }).replay(store);
    process.exit(9);
  `);
  const child = spawnSync(process.execPath, [childPath, dbPath, spoolPath], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr || child.error?.message);

  const recoveredSpool = new DurableResearchSpool({ spoolFilePath: spoolPath });
  assert.equal(recoveredSpool.getSnapshot().pendingCount, 1, 'old spool copy remains authoritative after interrupted compaction');
  const store = new (await import('../../dist/store.js')).Store(dbPath);
  try {
    await store.load();
    assert.equal((await store.getAuditEvents('candidate_paper_fill_v1', 10)).length, 1);
    const replay = await recoveredSpool.replay(store);
    assert.equal(replay.replayedCount, 1);
    assert.equal(replay.remainingCount, 0);
    assert.equal((await store.getAuditEvents('candidate_paper_fill_v1', 10)).length, 1,
      'stable event ID deduplicates the second replay after the committed first insert');
  } finally {
    await store.close();
  }
});

test('DurableResearchSpool assigns stable event IDs and rejects duplicate submissions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-spool-test-'));
  const spoolFile = join(dir, 'spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));

  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile, maxCapacity: 10 });

  // 1. Enqueue with custom recordId
  const res1 = spool.enqueue('AUDIT_EVENT', 'candidate_discovered_v1', { mint: 'mint-1' }, 'custom-id-1');
  assert.equal(res1.accepted, true);
  assert.match(res1.eventId, /^research_[a-f0-9]{64}$/);
  assert.equal(res1.pendingCount, 1);

  // 2. Duplicate submission with same recordId is suppressed
  const res2 = spool.enqueue('AUDIT_EVENT', 'candidate_discovered_v1', { mint: 'mint-1' }, 'custom-id-1');
  assert.equal(res2.accepted, false);
  assert.equal(res2.reason, 'DUPLICATE_ALREADY_SPOOLED');

  // 3. Enqueue with deterministic hash ID
  const res3 = spool.enqueue('JOURNAL_COUNTERFACTUAL', 'saveCounterfactualEvaluation', { evalId: 'e-1', metric: 42 });
  assert.equal(res3.accepted, true);
  assert.match(res3.eventId, /^research_[a-f0-9]{64}$/);
  assert.equal(res3.pendingCount, 2);

  // 4. Duplicate content without recordId produces same stable ID and is suppressed
  const res4 = spool.enqueue('JOURNAL_COUNTERFACTUAL', 'saveCounterfactualEvaluation', { evalId: 'e-1', metric: 42 });
  assert.equal(res4.accepted, false);
  assert.equal(res4.reason, 'DUPLICATE_ALREADY_SPOOLED');

  const snapshot = spool.getSnapshot();
  assert.equal(snapshot.pendingCount, 2);
  assert.equal(snapshot.totalSpooledCount, 2);
  assert.equal(snapshot.totalDrainedCount, 0);
  assert.equal(snapshot.totalDroppedCount, 0);
});

test('DurableResearchSpool reports fixed-memory conservative append latency percentiles', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-spool-latency-histogram-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const spool = new DurableResearchSpool({ spoolFilePath: join(dir, 'spool.jsonl') });
  const recordDuration = spool['recordDurableAppendDuration'].bind(spool);
  for (const milliseconds of [1, 2, 8, 64]) recordDuration(BigInt(milliseconds) * 1_000_000n);

  const snapshot = spool.getSnapshot();
  assert.equal(snapshot.durableAppendCount, 4);
  assert.equal(snapshot.durableAppendP50UpperBoundMs, 2.048);
  assert.equal(snapshot.durableAppendP95UpperBoundMs, 65.536);
  assert.equal(snapshot.durableAppendP99UpperBoundMs, 65.536);
  assert.ok(snapshot.durableAppendP50UpperBoundMs <= snapshot.durableAppendP95UpperBoundMs);
  assert.ok(snapshot.durableAppendP95UpperBoundMs <= snapshot.durableAppendP99UpperBoundMs);
  assert.equal(snapshot.durableAppendLatencyOverflowCount, 0);

  const interval = spool.getAppendLatencyIntervalSnapshot();
  assert.equal(interval.sampleCount, 4);
  assert.equal(interval.p50UpperBoundMs, snapshot.durableAppendP50UpperBoundMs);
  assert.equal(interval.p95UpperBoundMs, snapshot.durableAppendP95UpperBoundMs);
  assert.equal(interval.overflowCount, 0);
  assert.ok(interval.windowDurationMs >= 0);
  spool.resetAppendLatencyIntervalSnapshot();
  const emptyInterval = spool.getAppendLatencyIntervalSnapshot();
  assert.equal(emptyInterval.sampleCount, 0);
  assert.equal(emptyInterval.p50UpperBoundMs, null);
  assert.equal(spool.getSnapshot().durableAppendCount, 4, 'interval consumption does not change cumulative metrics');
  recordDuration(4_000_000n);
  assert.equal(spool.getAppendLatencyIntervalSnapshot().sampleCount, 1);
  assert.equal(spool.getSnapshot().durableAppendCount, 5);

  const overflowSpool = new DurableResearchSpool({ spoolFilePath: join(dir, 'overflow.jsonl') });
  overflowSpool['recordDurableAppendDuration'](2n ** 50n);
  const overflowSnapshot = overflowSpool.getSnapshot();
  assert.equal(overflowSnapshot.durableAppendP99UpperBoundMs, null);
  assert.equal(overflowSnapshot.durableAppendLatencyOverflowCount, 1);
});

test('DurableResearchSpool enforces capacity, payload size, and aggregate byte bounds fail-closed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-spool-bounds-'));
  const spoolFile = join(dir, 'spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));

  const spool = new DurableResearchSpool({
    spoolFilePath: spoolFile,
    maxCapacity: 2,
    maxPayloadBytes: 1024,
    maxAggregateBytes: 1500,
  });

  // Enqueue 1
  const r1 = spool.enqueue('AUDIT_EVENT', 'event_one', { data: 'a'.repeat(400) }, 'id-1');
  assert.equal(r1.accepted, true);

  // Oversized single payload
  const rOversized = spool.enqueue('AUDIT_EVENT', 'oversized', { data: 'x'.repeat(2000) }, 'id-oversized');
  assert.equal(rOversized.accepted, false);
  assert.equal(rOversized.reason, 'PAYLOAD_OVERSIZED');

  // Enqueue 2
  const r2 = spool.enqueue('AUDIT_EVENT', 'event_two', { data: 'b'.repeat(400) }, 'id-2');
  assert.equal(r2.accepted, true);

  // Capacity exceeded (maxCapacity = 2)
  const rCap = spool.enqueue('AUDIT_EVENT', 'event_three', { data: 'c' }, 'id-3');
  assert.equal(rCap.accepted, false);
  assert.equal(rCap.reason, 'SPOOL_CAPACITY_EXCEEDED');

  const snap = spool.getSnapshot();
  assert.equal(snap.pendingCount, 2);
  assert.equal(snap.totalDroppedCount, 2);
});

test('DurableResearchSpool recovers complete records and fails closed on a torn tail', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-spool-recovery-'));
  const spoolFile = join(dir, 'spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));

  // Process 1: enqueue items
  const spool1 = new DurableResearchSpool({ spoolFilePath: spoolFile });
  spool1.enqueue('AUDIT_EVENT', 'event_alpha', { step: 1 }, 'rec-1');
  spool1.enqueue('JOURNAL_COUNTERFACTUAL', 'saveCounterfactualEvaluation', { step: 2 }, 'rec-2');

  // Simulate an interrupted write / partial trailing line
  const rawDisk = await readFile(spoolFile, 'utf8');
  await writeFile(spoolFile, rawDisk + '{"eventId":"rec-3","incomplete":tru\n');

  // Corrupt or truncated state is surfaced; recovery must not silently report
  // an empty spool and lose the caller's ability to account for missing data.
  assert.throws(() => new DurableResearchSpool({ spoolFilePath: spoolFile }),
    /DURABLE_RESEARCH_SPOOL_RECOVERY_FAILED/);

  // Restore the two fully written records and restart successfully.
  await writeFile(spoolFile, rawDisk);
  const spool2 = new DurableResearchSpool({ spoolFilePath: spoolFile });
  const snap2 = spool2.getSnapshot();
  assert.equal(snap2.pendingCount, 2);
  assert.equal(snap2.totalSpooledCount, 2);

  // Duplicate suppression works against recovered items
  const dupCheck = spool2.enqueue('AUDIT_EVENT', 'event_alpha', { step: 1 }, 'rec-1');
  assert.equal(dupCheck.accepted, false);
  assert.equal(dupCheck.reason, 'DUPLICATE_ALREADY_SPOOLED');

  await writeFile(spoolFile, `${rawDisk}{}\n`);
  assert.throws(() => new DurableResearchSpool({ spoolFilePath: spoolFile }),
    /DURABLE_RESEARCH_SPOOL_RECOVERY_FAILED/);
});

test('DurableResearchSpool refuses hard-linked files that bypass path-based single-writer ownership', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-spool-hardlink-'));
  const spoolFile = join(dir, 'spool.jsonl');
  const aliasFile = join(dir, 'spool-alias.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile });
  assert.equal(spool.enqueue('AUDIT_EVENT', 'before_alias', { n: 1 }, 'hardlink-1').accepted, true);
  try { linkSync(spoolFile, aliasFile); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(error?.code)) {
      t.skip(`filesystem does not permit hard links: ${error.code}`);
      return;
    }
    throw error;
  }

  const bytesBeforeRejectedAppend = await readFile(spoolFile);
  const rejected = spool.enqueue('AUDIT_EVENT', 'after_alias', { n: 2 }, 'hardlink-2');
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'DISK_WRITE_FAILED');
  assert.deepEqual(await readFile(spoolFile), bytesBeforeRejectedAppend);

  const bytesBeforeRejectedCompaction = await readFile(spoolFile);
  const replay = await spool.replay({ appendAuditEvent: async () => {} });
  assert.equal(replay.replayedCount, 0);
  assert.equal(replay.remainingCount, 1);
  assert.equal(replay.error, 'DURABLE_RESEARCH_SPOOL_HARDLINK_UNSUPPORTED');
  assert.deepEqual(await readFile(spoolFile), bytesBeforeRejectedCompaction);
  assert.deepEqual(await readFile(aliasFile), bytesBeforeRejectedCompaction);

  let recoveryError;
  try { new DurableResearchSpool({ spoolFilePath: aliasFile }); }
  catch (error) { recoveryError = error; }
  assert.equal(recoveryError?.message, 'DURABLE_RESEARCH_SPOOL_RECOVERY_FAILED');
  assert.equal(recoveryError?.cause?.message, 'DURABLE_RESEARCH_SPOOL_HARDLINK_UNSUPPORTED');
});

test('DurableResearchSpool preserves valid legacy event IDs during recovery', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-spool-legacy-'));
  const spoolFile = join(dir, 'spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const queuedAtMs = Date.now();
  await writeFile(spoolFile, [
    JSON.stringify({ eventId: 'custom-id-1', eventType: 'AUDIT_EVENT', eventName: 'legacy_event', payload: { n: 1 }, queuedAtMs, attempts: 0 }),
    JSON.stringify({ eventId: 'spool_0123456789abcdef01234567', eventType: 'AUDIT_EVENT', eventName: 'legacy_event', payload: { n: 2 }, queuedAtMs, attempts: 0 }),
    JSON.stringify({ eventId: 'legacy-long-error', eventType: 'AUDIT_EVENT', eventName: 'legacy_event', payload: { n: 3 }, queuedAtMs, attempts: 1, lastErrorReason: 'x'.repeat(5000) }),
    '',
  ].join('\n'));

  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile });
  const ids = [];
  const result = await spool.replay({ appendAuditEvent: async (_event, _payload, eventId) => ids.push(eventId) });
  assert.equal(result.replayedCount, 3);
  assert.deepEqual(ids, ['custom-id-1', 'spool_0123456789abcdef01234567', 'legacy-long-error']);
});

test('DurableResearchSpool rolls back partial appends before accepting later records', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-spool-partial-append-'));
  const spoolFile = join(dir, 'spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile });
  assert.equal(spool.enqueue('AUDIT_EVENT', 'first_event', { n: 1 }, 'first-id').accepted, true);
  const originalBytes = await readFile(spoolFile);
  const durableAppend = spool['appendDurably'].bind(spool);
  spool['appendDurably'] = line => {
    appendFileSync(spoolFile, line.slice(0, 20));
    throw new Error('injected fsync failure after partial write');
  };
  const failed = spool.enqueue('AUDIT_EVENT', 'failed_event', { n: 2 }, 'failed-id');
  assert.equal(failed.accepted, false);
  assert.equal(failed.reason, 'DISK_WRITE_FAILED');
  assert.deepEqual(await readFile(spoolFile), originalBytes);

  spool['appendDurably'] = durableAppend;
  const accepted = spool.enqueue('AUDIT_EVENT', 'later_event', { n: 3 }, 'later-id');
  assert.equal(accepted.accepted, true);
  const recovered = new DurableResearchSpool({ spoolFilePath: spoolFile });
  assert.equal(recovered.getSnapshot().pendingCount, 2);
});

test('expired spool records remain pending and block replay instead of being discarded', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-spool-expired-'));
  const spoolFile = join(dir, 'spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(spoolFile, `${JSON.stringify({
    eventId: 'legacy-expired-id', eventType: 'AUDIT_EVENT', eventName: 'expired_event',
    payload: { n: 1 }, queuedAtMs: 1, attempts: 0,
  })}\n`);
  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile, maxRecordAgeMs: 1000 });
  let dispatched = false;
  const result = await spool.replay({ appendAuditEvent: async () => { dispatched = true; } });
  assert.equal(dispatched, false);
  assert.equal(result.remainingCount, 1);
  assert.equal(result.failedEventId, 'legacy-expired-id');
  assert.equal(result.error, 'SPOOL_RECORD_EXPIRED_HELD');
  assert.equal(spool.getSnapshot().totalDroppedCount, 0);
  assert.equal(new DurableResearchSpool({ spoolFilePath: spoolFile }).getSnapshot().pendingCount, 1);
});

test('DurableResearchSpool replays records in bounded batches and compacts on-disk journal', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-spool-replay-'));
  const spoolFile = join(dir, 'spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));

  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile });
  spool.enqueue('AUDIT_EVENT', 'cand_disc', { mint: 'm1' }, 'e-1');
  spool.enqueue('JOURNAL_COUNTERFACTUAL', 'saveCounterfactualEvaluation', { eval: 'e2' }, 'e-2');
  spool.enqueue('JOURNAL_FALSIFICATION', 'saveFalsificationReport', { report: 'e3' }, 'e-3');

  const dispatched = [];
  const mockTarget = {
    async appendAuditEvent(event, payload) { dispatched.push({ event, payload }); },
    async saveCounterfactualEvaluation(evalData) { dispatched.push({ journal: 'counterfactual', evalData }); },
    async saveFalsificationReport(reportData) { dispatched.push({ journal: 'falsification', reportData }); },
  };

  // Replay batch 1: max 2
  const result1 = await spool.replay(mockTarget, 2);
  assert.equal(result1.replayedCount, 2);
  assert.equal(result1.remainingCount, 1);
  assert.equal(dispatched.length, 2);

  // Drained items are suppressed from re-submission
  const dupDrained = spool.enqueue('AUDIT_EVENT', 'cand_disc', { mint: 'm1' }, 'e-1');
  assert.equal(dupDrained.accepted, false);
  assert.equal(dupDrained.reason, 'DUPLICATE_ALREADY_DRAINED');

  // Replay batch 2: drains final item
  const result2 = await spool.replay(mockTarget, 10);
  assert.equal(result2.replayedCount, 1);
  assert.equal(result2.remainingCount, 0);
  assert.equal(dispatched.length, 3);

  // Spool file is unlinked / empty after full drain
  assert.equal(existsSync(spoolFile), false);

  const finalSnap = spool.getSnapshot();
  assert.equal(finalSnap.pendingCount, 0);
  assert.equal(finalSnap.totalDrainedCount, 3);
  assert.ok(finalSnap.lastDrainedAtMs !== null);
});

test('DurableResearchSpool handles partial replay failure with bounded backoff and keeps remaining items', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-spool-fail-'));
  const spoolFile = join(dir, 'spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));

  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile });
  spool.enqueue('AUDIT_EVENT', 'item_1', {}, 'id-1');
  spool.enqueue('AUDIT_EVENT', 'item_2_will_fail', {}, 'id-2');
  spool.enqueue('AUDIT_EVENT', 'item_3', {}, 'id-3');

  let attempts = 0;
  const failingTarget = {
    async appendAuditEvent(event) {
      attempts++;
      if (event === 'item_2_will_fail') {
        throw new Error('Database busy; lock timeout');
      }
    },
  };

  const res = await spool.replay(failingTarget, 10);
  assert.equal(res.replayedCount, 1); // item 1 succeeded
  assert.equal(res.remainingCount, 2); // item 2 and 3 stay pending
  assert.match(res.failedEventId, /^research_[a-f0-9]{64}$/);
  assert.match(res.error, /lock timeout/);

  const snap = spool.getSnapshot();
  assert.equal(snap.pendingCount, 2);
  assert.equal(snap.totalDrainedCount, 1);
  assert.equal(snap.lastSpoolError, 'Database busy; lock timeout');

  // Recover in another instance to prove compacted disk state preserves items 2 and 3
  const recoveredSpool = new DurableResearchSpool({ spoolFilePath: spoolFile });
  assert.equal(recoveredSpool.getSnapshot().pendingCount, 2);

  // Now replay with a fixed target
  const successTarget = { async appendAuditEvent() {} };
  const resFixed = await recoveredSpool.replay(successTarget, 10);
  assert.equal(resFixed.replayedCount, 2);
  assert.equal(resFixed.remainingCount, 0);
});

test('failed spool compaction does not retire accepted records in memory or on disk', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-spool-compact-failure-'));
  const spoolFile = join(dir, 'spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile });
  spool.enqueue('AUDIT_EVENT', 'compact_first', { n: 1 }, 'compact-1');
  spool.enqueue('AUDIT_EVENT', 'compact_second', { n: 2 }, 'compact-2');
  const originalFlush = spool['flushToDisk'].bind(spool);
  spool['flushToDisk'] = () => false;
  const acceptedByTarget = [];
  const failed = await spool.replay({ appendAuditEvent: async event => acceptedByTarget.push(event) }, 1);
  assert.deepEqual(acceptedByTarget, ['compact_first']);
  assert.equal(failed.replayedCount, 0);
  assert.equal(failed.remainingCount, 2);
  assert.match(failed.error, /compaction/i);
  assert.equal(spool.getSnapshot().pendingCount, 2);
  assert.equal(spool.getSnapshot().totalDrainedCount, 0);
  assert.equal(new DurableResearchSpool({ spoolFilePath: spoolFile }).getSnapshot().pendingCount, 2);
  spool['flushToDisk'] = originalFlush;
  const retried = await spool.replay({ appendAuditEvent: async (_event, _payload, eventId) => acceptedByTarget.push(eventId) }, 1);
  assert.equal(retried.replayedCount, 1);
  assert.equal(retried.remainingCount, 1);
});

test('Engine integrates DurableResearchSpool and surfaces spool telemetry in researchEvidence', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-engine-spool-'));
  const spoolFile = join(dir, 'engine-spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));

  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile });

  let firstEventId;
  const mockStore = {
    save: async () => {},
    load: async () => null,
    appendAuditEvent: async (_event, _payload, eventId) => {
      firstEventId = eventId;
      throw new Error('database write queue rejected');
    },
  };

  const cfg = { MAX_POSITIONS: 3, MAX_EXPOSURE_LAMPORTS: 1000n, MAX_DAILY_LOSS_LAMPORTS: 1000n, BUY_LAMPORTS: 100n, MAX_SPECULATIVE_RISK_BPS: 500, ROLLING_DRAWDOWN_BPS: 1000, FAILURE_HALT_COUNT: 3, SLIPPAGE_BPS: 100, STOP_BPS: 200, MAX_TIP_LAMPORTS: 10n, MAX_PRIORITY_LAMPORTS: 10n, RPC_URL: 'http://127.0.0.1:8899', WS_URL: 'ws://127.0.0.1:8900' };
  const rpc = { connection: {} };
  const mockMarket = {};
  const executor = {};
  const state = { cash: 1000000000n, positions: {} };
  const loggedEvents = [];
  const mockLogger = { writeEvent: (event, payload) => loggedEvents.push({ event, ...payload }) };

  const engine = new Engine(
    cfg,
    rpc,
    mockMarket,
    executor,
    mockStore,
    state,
    mockLogger,
    undefined,
    'deterministic_only',
    undefined,
    undefined,
    spool
  );

  // Trigger failed audit event
  engine['persistResearchObservation']('candidate_spool_test_v1', { test: true }, 'rec-spool-1');
  await new Promise(resolve => setImmediate(resolve));

  const evidence = engine.snapshot().researchEvidence;
  assert.equal(evidence.persistenceFailures, 1);
  assert.equal(evidence.lastPersistenceFailure.event, 'candidate_spool_test_v1');
  assert.equal(evidence.lastPersistenceFailure.reason, 'write_rejected');

  // Verify spool state is visible in snapshot
  assert.ok(evidence.spool !== null);
  assert.equal(evidence.spool.pendingCount, 1);
  assert.equal(evidence.spool.pendingPayloadBytes, Buffer.byteLength(JSON.stringify({ test: true })));
  assert.equal(evidence.spool.capacityLimit, DEFAULT_MAX_CAPACITY);
  assert.equal(evidence.spool.totalSpooledCount, 1);
  assert.equal(evidence.spool.durableAppendCount, 1);
  assert.ok(evidence.spool.durableAppendTotalMs >= evidence.spool.durableAppendMaxMs);
  assert.ok(evidence.spool.durableAppendP50UpperBoundMs <= evidence.spool.durableAppendP95UpperBoundMs);
  assert.ok(evidence.spool.durableAppendP95UpperBoundMs <= evidence.spool.durableAppendP99UpperBoundMs);

  // A second rejected write with identical identity is safely covered by the
  // already-pending spool entry and must not be counted as another lost event.
  engine['persistResearchObservation']('candidate_spool_test_v1', { test: true }, 'rec-spool-1');
  await new Promise(resolve => setImmediate(resolve));
  const duplicateEvidence = engine.snapshot().researchEvidence;
  assert.equal(duplicateEvidence.persistenceFailures, 2);
  assert.equal(duplicateEvidence.lastPersistenceFailure.reason, 'write_rejected');
  assert.equal(duplicateEvidence.spool.pendingCount, 1);
  assert.equal(duplicateEvidence.spool.totalDroppedCount, 0);
  assert.equal(duplicateEvidence.spool.durableAppendCount, 1, 'duplicate retry does not perform another durable append');

  const originalWriteEvent = mockLogger.writeEvent;
  mockLogger.writeEvent = () => { throw new Error('injected checkpoint persistence failure'); };
  assert.throws(() => engine.emitCheckpoint(), /injected checkpoint persistence failure/);
  assert.equal(engine.snapshot().researchEvidence.spool.durableAppendCount, 1, 'failed checkpoint keeps interval samples available');
  mockLogger.writeEvent = originalWriteEvent;

  engine.emitCheckpoint();
  const checkpoint = loggedEvents.find(event => event.event === 'soak_checkpoint');
  assert.ok(checkpoint?.researchSpool);
  assert.equal(checkpoint.researchSpool.pendingCount, 1);
  assert.equal(checkpoint.researchSpool.durableAppendCount, 1);
  assert.equal(checkpoint.researchSpool.appendLatencyInterval.sampleCount, 1);
  assert.equal(checkpoint.researchSpool.appendLatencyInterval.p50UpperBoundMs, evidence.spool.durableAppendP50UpperBoundMs);
  assert.equal(checkpoint.researchSpool.durableAppendP99UpperBoundMs, evidence.spool.durableAppendP99UpperBoundMs);
  assert.equal(Object.hasOwn(checkpoint.researchSpool, 'spoolFilePath'), false, 'soak telemetry excludes local paths');

  engine.snapshot(); // Dashboard polling is read-only and cannot consume the next interval.
  engine.emitCheckpoint();
  const secondCheckpoint = loggedEvents.filter(event => event.event === 'soak_checkpoint').at(-1);
  assert.equal(secondCheckpoint.researchSpool.appendLatencyInterval.sampleCount, 0);
  assert.equal(secondCheckpoint.researchSpool.durableAppendCount, 1, 'cumulative metrics remain available after interval reset');

  // Fix store and drain spool through engine
  let drainedEvent = null;
  mockStore.appendAuditEvent = async (event, payload, eventId) => { drainedEvent = { event, payload, eventId }; };

  const drainResult = await engine.drainResearchSpool();
  assert.equal(drainResult.replayedCount, 1);
  assert.equal(drainResult.remainingCount, 0);
  assert.equal(drainedEvent.event, 'candidate_spool_test_v1');
  assert.match(drainedEvent.eventId, /^research_[a-f0-9]{64}$/);
  assert.equal(drainedEvent.eventId, firstEventId);

  assert.equal(engine.snapshot().researchEvidence.spool.pendingCount, 0);
  assert.equal(engine.snapshot().researchEvidence.spool.totalDrainedCount, 1);
});

test('Engine recovers the spool before its loop and drains observations again during shutdown', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-engine-spool-lifecycle-'));
  const spoolFile = join(dir, 'engine-spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile });
  spool.enqueue('AUDIT_EVENT', 'startup_recovered_event', { sequence: 1 }, 'startup-id');
  const dispatched = [];
  const mockStore = {
    save: async () => {},
    appendAuditEvent: async (event, payload, stableEventId) => dispatched.push({ event, payload, stableEventId }),
  };
  const cfg = { MAX_POSITIONS: 3, MAX_EXPOSURE_LAMPORTS: 1000n, MAX_DAILY_LOSS_LAMPORTS: 1000n,
    BUY_LAMPORTS: 100n, MAX_SPECULATIVE_RISK_BPS: 500, ROLLING_DRAWDOWN_BPS: 1000,
    FAILURE_HALT_COUNT: 3, SLIPPAGE_BPS: 100, STOP_BPS: 200, MAX_TIP_LAMPORTS: 10n,
    MAX_PRIORITY_LAMPORTS: 10n, RPC_URL: 'http://127.0.0.1:8899', WS_URL: 'http://127.0.0.1:8900',
    POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const engine = new Engine(cfg, { connection: {} }, {}, {}, mockStore,
    { cash: 1000000000n, positions: {} }, undefined, undefined, 'deterministic_only', undefined, undefined, spool);
  engine.feed.run = async () => {};
  engine.feed.stop = () => {};
  engine.saveState = async () => {};
  engine.drainResearchSpool = () => spool.replay(mockStore, 1);
  engine.tick = async () => {
    assert.equal(dispatched[0]?.event, 'startup_recovered_event');
    spool.enqueue('AUDIT_EVENT', 'periodic_drained_event', { sequence: 2 }, 'periodic-id');
    spool.enqueue('AUDIT_EVENT', 'shutdown_drained_event', { sequence: 3 }, 'shutdown-id');
    engine.nextResearchSpoolDrainAt = 0;
    engine.stop();
  };
  await engine.run();
  assert.deepEqual(dispatched.map(row => row.event), ['startup_recovered_event', 'periodic_drained_event', 'shutdown_drained_event']);
  assert.deepEqual(dispatched.map(row => row.stableEventId), [
    stableResearchEventId('AUDIT_EVENT', 'startup_recovered_event', { sequence: 1 }, 'startup-id'),
    stableResearchEventId('AUDIT_EVENT', 'periodic_drained_event', { sequence: 2 }, 'periodic-id'),
    stableResearchEventId('AUDIT_EVENT', 'shutdown_drained_event', { sequence: 3 }, 'shutdown-id'),
  ]);
  assert.equal(spool.getSnapshot().pendingCount, 0);
});

test('Engine retries a failed research-loss marker save without waiting for another trade', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-engine-loss-marker-retry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let saveCalls = 0;
  let persisted;
  const saveEvents = [];
  const mockStore = {
    appendAuditEvent: async () => { throw new Error('audit sink unavailable'); },
    save: async (state, event) => {
      saveCalls++;
      saveEvents.push(event);
      if (saveCalls === 1) throw new Error('temporary state sink failure');
      persisted = structuredClone(state);
    },
  };
  const cfg = { MAX_POSITIONS: 3, MAX_EXPOSURE_LAMPORTS: 1000n, MAX_DAILY_LOSS_LAMPORTS: 1000n,
    BUY_LAMPORTS: 100n, MAX_SPECULATIVE_RISK_BPS: 500, ROLLING_DRAWDOWN_BPS: 1000,
    FAILURE_HALT_COUNT: 3, SLIPPAGE_BPS: 100, STOP_BPS: 200, MAX_TIP_LAMPORTS: 10n,
    MAX_PRIORITY_LAMPORTS: 10n, RPC_URL: 'http://127.0.0.1:8899', WS_URL: 'http://127.0.0.1:8900',
    POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const engine = new Engine(cfg, { connection: {} }, {}, {}, mockStore,
    { cash: 1000000000n, positions: {} });
  engine.feed.run = async () => {};
  engine.feed.stop = () => {};
  let ticks = 0;
  engine.tick = async () => {
    ticks++;
    if (ticks === 1) {
      engine['persistResearchObservation']('candidate_loss_marker_retry_v1', { sample: true }, 'loss-retry');
      await new Promise(resolve => setImmediate(resolve));
    } else {
      // Release the one-second retry throttle so the test covers the retry
      // path without sleeping; production keeps the bounded cadence.
      engine.nextResearchLossMarkerSaveAt = 0;
      engine.stop();
    }
  };
  await engine.run();
  assert.ok(saveCalls >= 3, 'initial retry, successful retry, and shutdown save were attempted');
  assert.equal(persisted.researchEvidenceLoss.failureCount, 1);
  assert.equal(persisted.researchEvidenceLoss.lastEvent, 'candidate_loss_marker_retry_v1');
  assert.equal(engine.snapshot().researchEvidence.lossMarkerStatus, 'PERSISTED');
  assert.deepEqual(saveEvents.slice(0, 2), [undefined, undefined]);
});

test('Engine records immutable journal identity conflicts without spooling them as transient failures', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-engine-immutable-conflict-'));
  const spoolFile = join(dir, 'engine-spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile });
  const mockStore = {
    save: async () => {},
    load: async () => null,
    saveCounterfactualEvaluation: async () => { throw new Error('COUNTERFACTUAL_ID_CONTENT_CONFLICT'); },
  };
  const cfg = { MAX_POSITIONS: 3, MAX_EXPOSURE_LAMPORTS: 1000n, MAX_DAILY_LOSS_LAMPORTS: 1000n,
    BUY_LAMPORTS: 100n, MAX_SPECULATIVE_RISK_BPS: 500, ROLLING_DRAWDOWN_BPS: 1000,
    FAILURE_HALT_COUNT: 3, SLIPPAGE_BPS: 100, STOP_BPS: 200, MAX_TIP_LAMPORTS: 10n,
    MAX_PRIORITY_LAMPORTS: 10n, RPC_URL: 'http://127.0.0.1:8899', WS_URL: 'ws://127.0.0.1:8900' };
  const engine = new Engine(cfg, { connection: {} }, {}, {}, mockStore,
    { cash: 1000000000n, positions: {} }, undefined, undefined, 'deterministic_only', undefined, undefined, spool);
  engine['persistResearchJournal']('saveCounterfactualEvaluation', { evaluationId: 'cfr_conflict' }, 'cfr_conflict');
  await new Promise(resolve => setImmediate(resolve));
  const evidence = engine.snapshot().researchEvidence;
  assert.equal(evidence.persistenceFailures, 1);
  assert.equal(evidence.lastPersistenceFailure.reason, 'immutable_identity_conflict');
  assert.equal(evidence.spool.pendingCount, 0);
  assert.equal(evidence.spool.totalSpooledCount, 0);
});

test('Engine records a second loss when the research spool cannot write its recovery record', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-engine-spool-disk-failure-'));
  const spoolFile = join(dir, 'missing-parent', 'spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile });
  const mockStore = {
    save: async () => {},
    load: async () => null,
    appendAuditEvent: async () => { throw new Error('database write queue rejected'); },
  };
  const cfg = { MAX_POSITIONS: 3, MAX_EXPOSURE_LAMPORTS: 1000n, MAX_DAILY_LOSS_LAMPORTS: 1000n,
    BUY_LAMPORTS: 100n, MAX_SPECULATIVE_RISK_BPS: 500, ROLLING_DRAWDOWN_BPS: 1000,
    FAILURE_HALT_COUNT: 3, SLIPPAGE_BPS: 100, STOP_BPS: 200, MAX_TIP_LAMPORTS: 10n,
    MAX_PRIORITY_LAMPORTS: 10n, RPC_URL: 'http://127.0.0.1:8899', WS_URL: 'ws://127.0.0.1:8900' };
  const engine = new Engine(cfg, { connection: {} }, {}, {}, mockStore,
    { cash: 1000000000n, positions: {} }, undefined, undefined, 'deterministic_only', undefined, undefined, spool);
  engine['persistResearchObservation']('candidate_spool_disk_failure_v1', { test: true }, 'disk-failure-record');
  await new Promise(resolve => setImmediate(resolve));
  const evidence = engine.snapshot().researchEvidence;
  assert.equal(evidence.persistenceFailures, 2);
  assert.equal(evidence.lastPersistenceFailure.reason, 'spool_enqueue_failed');
  assert.equal(evidence.spool.pendingCount, 0);
  assert.equal(evidence.spool.diskFailureCount, 1);
});

test('DurableResearchSpool serializes replay and rejects concurrent drain attempts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-spool-concurrent-'));
  const spoolFile = join(dir, 'spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));

  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile });
  spool.enqueue('AUDIT_EVENT', 'concurrent_evt', { n: 1 }, 'c-1');
  spool.enqueue('AUDIT_EVENT', 'concurrent_evt', { n: 2 }, 'c-2');

  let releaseDrain;
  const drainPromise = new Promise(resolve => { releaseDrain = resolve; });

  const slowTarget = {
    async appendAuditEvent() {
      await drainPromise;
    },
  };

  // Launch first replay which blocks
  const firstReplay = spool.replay(slowTarget, 2);

  // Attempt second concurrent replay immediately
  const concurrentReplay = await spool.replay(slowTarget, 2);
  assert.equal(concurrentReplay.error, 'DRAIN_IN_PROGRESS');
  assert.equal(concurrentReplay.replayedCount, 0);

  // Unblock first replay and await completion
  releaseDrain();
  const firstResult = await firstReplay;
  assert.equal(firstResult.replayedCount, 2);
  assert.equal(firstResult.remainingCount, 0);
});
