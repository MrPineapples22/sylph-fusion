import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readLatestSoakSession,
  getSoakTelemetry,
  computeBaselineScore,
  exportSessionArtifact,
} from '../soak-reader.mjs';

test('readLatestSoakSession returns null if sessions dir does not exist', async () => {
  const res = await readLatestSoakSession(join(tmpdir(), 'non-existent-soak-sessions-' + Date.now()));
  assert.equal(res, null);
});

test('computeBaselineScore awards points for low RPC drops, valid rejections, and stability', () => {
  // Corrupted / rate-limited run (50% rpc drops)
  const scoreBad = computeBaselineScore({
    rpcFailureRate: 50,
    totalRejections: 62,
    rpcRejectionCount: 34,
    runtimeSeconds: 300,
    checkpointCount: 0,
    fillsCount: 0,
  });
  // Should get 0 for RPC rate limit, some for valid rejections & runtime
  assert.ok(scoreBad < 50);

  // Clean run (0% rpc drops, 10 valid rejections, 300s runtime, checkpoint, fills)
  const scoreGood = computeBaselineScore({
    rpcFailureRate: 0,
    totalRejections: 10,
    rpcRejectionCount: 0,
    runtimeSeconds: 300,
    checkpointCount: 1,
    fillsCount: 2,
  });
  assert.equal(scoreGood, 100);
});

test('readLatestSoakSession supports multi-session discovery and selection', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'soak-multi-test-'));
  try {
    const s1 = join(tempDir, 'soak-2026-09-16T10-00-00-000Z');
    const s2 = join(tempDir, 'soak-2026-09-16T11-00-00-000Z');
    await mkdir(s1, { recursive: true });
    await mkdir(s2, { recursive: true });

    await writeFile(join(s1, 'session.jsonl'), JSON.stringify({ time: '2026-09-16T10:00:01.000Z', event: 'entry_rejected', reason: 'reason1' }) + '\n');
    await writeFile(join(s2, 'session.jsonl'), JSON.stringify({ time: '2026-09-16T11:00:01.000Z', event: 'entry_rejected', reason: 'reason2' }) + '\n');

    // Default to latest (s2)
    const latest = await readLatestSoakSession(tempDir);
    assert.ok(latest);
    assert.equal(latest.sessionDir, 'soak-2026-09-16T11-00-00-000Z');
    assert.deepEqual(latest.availableSessions, ['soak-2026-09-16T11-00-00-000Z', 'soak-2026-09-16T10-00-00-000Z']);

    // Explicit selection (s1)
    const specific = await readLatestSoakSession(tempDir, 'soak-2026-09-16T10-00-00-000Z');
    assert.ok(specific);
    assert.equal(specific.sessionDir, 'soak-2026-09-16T10-00-00-000Z');
    assert.equal(specific.rejections.taxonomy[0].reason, 'reason1');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('readLatestSoakSession parses session events and fills correctly', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'soak-test-'));
  try {
    const sessionDir = join(tempDir, 'soak-2026-09-16T12-00-00-000Z');
    await mkdir(sessionDir, { recursive: true });

    const jsonlLines = [
      JSON.stringify({ time: '2026-09-16T12:00:01.000Z', event: 'entry_rejected', reason: 'all RPC endpoints failed', mint: 'MINT1' }),
      JSON.stringify({ time: '2026-09-16T12:00:02.000Z', event: 'entry_rejected', reason: 'all RPC endpoints failed', mint: 'MINT2' }),
      JSON.stringify({ time: '2026-09-16T12:00:03.000Z', event: 'entry_rejected', reason: 'curve bonding incomplete', mint: 'MINT3' }),
      JSON.stringify({ time: '2026-09-16T12:00:04.000Z', event: 'entry_rejected', reason: 'creator dev concentration > 20%', mint: 'MINT4' }),
      JSON.stringify({ time: '2026-09-16T12:00:05.000Z', event: 'exit_blocked_by_pending', mint: 'MINT5', orderId: 'ord-1' }),
      JSON.stringify({ time: '2026-09-16T12:00:06.000Z', event: 'exit_block_cleared', mint: 'MINT5', orderId: 'ord-1' }),
      JSON.stringify({ time: '2026-09-16T12:00:07.000Z', event: 'soak_checkpoint', candidates: 4, memoryMb: 85, balanceSol: 50.0 }),
    ];
    await writeFile(join(sessionDir, 'session.jsonl'), jsonlLines.join('\n') + '\n');

    const csvContent = 'time,mint,side,qty,price,slippage,fee\n2026-09-16T12:00:02.000Z,MINT1,BUY,100,0.01,0.05,0.00005\n';
    await writeFile(join(sessionDir, 'fills.csv'), csvContent);

    const res = await readLatestSoakSession(tempDir);
    assert.ok(res);
    assert.equal(res.available, true);
    assert.equal(res.eventsCount, 7);
    assert.equal(res.rejections.total, 4);

    // RPC health
    assert.equal(res.rpcHealth.failedRpcCount, 2);
    assert.equal(res.rpcHealth.rateLimitPct, 50);
    assert.equal(res.rpcHealth.gatePassed, false);
    assert.match(res.rpcHealth.alert, /50% candidate drop rate/);

    // Taxonomy
    assert.equal(res.rejections.taxonomy.length, 3);
    const rpcItem = res.rejections.taxonomy.find(t => t.reason === 'all RPC endpoints failed');
    assert.ok(rpcItem);
    assert.equal(rpcItem.count, 2);
    assert.equal(rpcItem.category, 'rpc');

    const curveItem = res.rejections.taxonomy.find(t => t.reason === 'curve bonding incomplete');
    assert.ok(curveItem);
    assert.equal(curveItem.category, 'curve');

    const safetyItem = res.rejections.taxonomy.find(t => t.reason === 'creator dev concentration > 20%');
    assert.ok(safetyItem);
    assert.equal(safetyItem.category, 'safety');

    // Blocked exits
    assert.equal(res.blockedExits.totalBlocked, 1);
    assert.equal(res.blockedExits.totalCleared, 1);

    // Latest checkpoint
    assert.ok(res.latestCheckpoint);
    assert.equal(res.latestCheckpoint.memoryMb, 85);

    // Fills
    assert.equal(res.fills.count, 1);
    assert.equal(res.fills.recent[0].mint, 'MINT1');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('exportSessionArtifact exports jsonl, csv, and summary format', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'soak-export-test-'));
  try {
    const sessionDirName = 'soak-2026-09-16T12-00-00-000Z';
    const sessionDir = join(tempDir, sessionDirName);
    await mkdir(sessionDir, { recursive: true });

    await writeFile(join(sessionDir, 'session.jsonl'), '{"event":"test"}\n');
    await writeFile(join(sessionDir, 'fills.csv'), 'mint,side\nMINT1,BUY\n');

    const jsonlExp = await exportSessionArtifact(tempDir, sessionDirName, 'jsonl');
    assert.equal(jsonlExp.contentType, 'application/x-ndjson; charset=utf-8');
    assert.equal(jsonlExp.filename, `${sessionDirName}.jsonl`);
    assert.equal(jsonlExp.content, '{"event":"test"}\n');

    const csvExp = await exportSessionArtifact(tempDir, sessionDirName, 'csv');
    assert.equal(csvExp.contentType, 'text/csv; charset=utf-8');
    assert.equal(csvExp.filename, `${sessionDirName}-fills.csv`);
    assert.match(csvExp.content, /MINT1,BUY/);

    const summaryExp = await exportSessionArtifact(tempDir, sessionDirName, 'summary');
    assert.equal(summaryExp.contentType, 'application/json; charset=utf-8');
    assert.match(summaryExp.content, /soak-2026-09-16T12-00-00-000Z/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('getSoakTelemetry returns session telemetry payload', async () => {
  const projectRoot = join(import.meta.dirname, '..', '..');
  const res = await getSoakTelemetry(projectRoot);
  assert.ok(res);
  assert.equal(typeof res.timestamp, 'number');
  assert.equal(typeof res.engineRunning, 'boolean');
  if (res.session) {
    assert.ok(res.session.rejections);
    assert.ok(res.session.rpcHealth);
  }
});
