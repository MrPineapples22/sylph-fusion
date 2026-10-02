import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSoakSessions } from '../soak-reader.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('compareSoakSessions compares two deterministic session fixtures side by side', async (t) => {
  const sessionsDir = await mkdtemp(join(tmpdir(), 'sylph-session-comparison-'));
  t.after(() => rm(sessionsDir, { recursive: true, force: true }));
  const sessionA = 'soak-2026-09-16T23-13-54-634Z';
  const sessionB = 'soak-2026-09-16T23-14-19-074Z';
  for (const [name, reasons] of [[sessionA, ['all RPC endpoints failed', 'curve bonding incomplete']],
    [sessionB, ['curve bonding incomplete', 'curve bonding incomplete']]]) {
    const directory = join(sessionsDir, name);
    await mkdir(directory);
    await writeFile(join(directory, 'session.jsonl'), reasons.map((reason, index) => JSON.stringify({
      time: `2026-09-16T23:15:0${index}.000Z`, event: 'entry_rejected', reason, mint: `fixture-${index}`,
    })).join('\n') + '\n');
  }

  const comparison = await compareSoakSessions(sessionsDir, sessionA, sessionB);

  assert.ok(comparison);
  assert.equal(comparison.sessionA.name, sessionA);
  assert.equal(comparison.sessionB.name, sessionB);

  assert.ok(typeof comparison.summaryDeltas.scoreDelta === 'number');
  assert.ok(typeof comparison.summaryDeltas.rpcDropRateDelta === 'number');
  assert.ok(typeof comparison.summaryDeltas.rpcDropsDelta === 'number');
  assert.equal(comparison.summaryDeltas.rpcDropRateDelta, -50);
  assert.equal(comparison.summaryDeltas.rpcDropsDelta, -1);

  // Verify all 7 funnel gates are represented in comparison
  assert.equal(comparison.funnelComparison.length, 7);
  const gateIds = comparison.funnelComparison.map(g => g.gate);
  assert.deepEqual(gateIds, ['discovered', 'aged', 'buyerThreshold', 'safetyPassed', 'driftPassed', 'eligible', 'paperFilled']);

  // Verify rejection taxonomy shift is calculated
  assert.ok(Array.isArray(comparison.rejectionDiff));
  assert.equal(comparison.rejectionDiff.find(row => row.reason === 'curve bonding incomplete').deltaCount, 1);
  if (comparison.rejectionDiff.length > 0) {
    const first = comparison.rejectionDiff[0];
    assert.ok(first.reason);
    assert.ok(typeof first.countA === 'number');
    assert.ok(typeof first.countB === 'number');
    assert.ok(typeof first.deltaCount === 'number');
  }
});

test('compareSoakSessions returns null if sessions directory does not exist or has invalid sessions', async () => {
  const comparison = await compareSoakSessions('/non/existent/path', 'invalid-a', 'invalid-b');
  assert.equal(comparison, null);
});
