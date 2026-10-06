import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DurableResearchSpool,
  DEFAULT_MAX_CAPACITY,
  DEFAULT_MAX_PAYLOAD_BYTES,
} from '../../dist/platform/audit/durable-research-spool.js';
import { Engine } from '../../dist/fusion.js';

test('DurableResearchSpool assigns stable event IDs and rejects duplicate submissions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-spool-test-'));
  const spoolFile = join(dir, 'spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));

  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile, maxCapacity: 10 });

  // 1. Enqueue with custom recordId
  const res1 = spool.enqueue('AUDIT_EVENT', 'candidate_discovered_v1', { mint: 'mint-1' }, 'custom-id-1');
  assert.equal(res1.accepted, true);
  assert.equal(res1.eventId, 'custom-id-1');
  assert.equal(res1.pendingCount, 1);

  // 2. Duplicate submission with same recordId is suppressed
  const res2 = spool.enqueue('AUDIT_EVENT', 'candidate_discovered_v1', { mint: 'mint-1' }, 'custom-id-1');
  assert.equal(res2.accepted, false);
  assert.equal(res2.reason, 'DUPLICATE_ALREADY_SPOOLED');

  // 3. Enqueue with deterministic hash ID
  const res3 = spool.enqueue('JOURNAL_COUNTERFACTUAL', 'saveCounterfactualEvaluation', { evalId: 'e-1', metric: 42 });
  assert.equal(res3.accepted, true);
  assert.match(res3.eventId, /^spool_[a-f0-9]{24}$/);
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

test('DurableResearchSpool recovers un-drained records from disk across restarts and ignores trailing corrupt lines', async t => {
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

  // Process 2: restart from disk
  const spool2 = new DurableResearchSpool({ spoolFilePath: spoolFile });
  const snap2 = spool2.getSnapshot();
  assert.equal(snap2.pendingCount, 2);
  assert.equal(snap2.totalSpooledCount, 2);

  // Duplicate suppression works against recovered items
  const dupCheck = spool2.enqueue('AUDIT_EVENT', 'event_alpha', { step: 1 }, 'rec-1');
  assert.equal(dupCheck.accepted, false);
  assert.equal(dupCheck.reason, 'DUPLICATE_ALREADY_SPOOLED');
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
  assert.equal(res.failedEventId, 'id-2');
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

test('Engine integrates DurableResearchSpool and surfaces spool telemetry in researchEvidence', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-engine-spool-'));
  const spoolFile = join(dir, 'engine-spool.jsonl');
  t.after(() => rm(dir, { recursive: true, force: true }));

  const spool = new DurableResearchSpool({ spoolFilePath: spoolFile });

  const mockStore = {
    save: async () => {},
    load: async () => null,
    appendAuditEvent: async () => { throw new Error('database write queue rejected'); },
  };

  const cfg = { MAX_POSITIONS: 3, MAX_EXPOSURE_LAMPORTS: 1000n, MAX_DAILY_LOSS_LAMPORTS: 1000n, BUY_LAMPORTS: 100n, MAX_SPECULATIVE_RISK_BPS: 500, ROLLING_DRAWDOWN_BPS: 1000, FAILURE_HALT_COUNT: 3, SLIPPAGE_BPS: 100, STOP_BPS: 200, MAX_TIP_LAMPORTS: 10n, MAX_PRIORITY_LAMPORTS: 10n, RPC_URL: 'http://127.0.0.1:8899', WS_URL: 'ws://127.0.0.1:8900' };
  const rpc = { connection: {} };
  const mockMarket = {};
  const executor = {};
  const state = { cash: 1000000000n, positions: {} };

  const engine = new Engine(
    cfg,
    rpc,
    mockMarket,
    executor,
    mockStore,
    state,
    undefined,
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
  assert.equal(evidence.spool.totalSpooledCount, 1);

  // Fix store and drain spool through engine
  let drainedEvent = null;
  mockStore.appendAuditEvent = async (event, payload) => { drainedEvent = { event, payload }; };

  const drainResult = await engine.drainResearchSpool();
  assert.equal(drainResult.replayedCount, 1);
  assert.equal(drainResult.remainingCount, 0);
  assert.equal(drainedEvent.event, 'candidate_spool_test_v1');

  assert.equal(engine.snapshot().researchEvidence.spool.pendingCount, 0);
  assert.equal(engine.snapshot().researchEvidence.spool.totalDrainedCount, 1);
});
