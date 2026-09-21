import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionEvents } from '../soak-reader.mjs';

test('readSessionEvents parses chronological events with pagination', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'replay-test-'));
  try {
    const sessionDir = join(dir, 'soak-2026-test');
    await mkdir(sessionDir, { recursive: true });
    const eventsData = [
      JSON.stringify({ time: '2026-09-16T23:00:00.000Z', event: 'entry_rejected', mint: 'Mint1111', reason: 'all RPC endpoints failed' }),
      JSON.stringify({ time: '2026-09-16T23:01:00.000Z', event: 'exit_blocked_by_pending', mint: 'Mint2222', reason: 'stop', pendingMint: 'Mint3333', stage: 0 }),
      JSON.stringify({ time: '2026-09-16T23:02:00.000Z', event: 'exit_block_cleared', mint: 'Mint2222', reason: 'stop' }),
      JSON.stringify({ time: '2026-09-16T23:03:00.000Z', event: 'soak_checkpoint', uptimeHours: 0.05, feedHealthy: true, realizedPnl: '50000', cash: '1000000000' }),
    ].join('\n');

    await writeFile(join(sessionDir, 'session.jsonl'), eventsData, 'utf8');

    // Read full events
    const result = await readSessionEvents(dir, 'soak-2026-test', 10, 0);
    assert.equal(result.total, 4);
    assert.equal(result.events.length, 4);
    assert.equal(result.events[0].event, 'entry_rejected');
    assert.equal(result.events[1].event, 'exit_blocked_by_pending');
    assert.equal(result.events[2].event, 'exit_block_cleared');
    assert.equal(result.events[3].event, 'soak_checkpoint');

    // Test pagination (limit 2, offset 1)
    const paged = await readSessionEvents(dir, 'soak-2026-test', 2, 1);
    assert.equal(paged.total, 4);
    assert.equal(paged.events.length, 2);
    assert.equal(paged.events[0].event, 'exit_blocked_by_pending');
    assert.equal(paged.events[1].event, 'exit_block_cleared');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readSessionEvents returns empty array gracefully if session directory is missing', async () => {
  const result = await readSessionEvents('/nonexistent/sessions/path', 'nonexistent-session');
  assert.equal(result.total, 0);
  assert.equal(result.events.length, 0);
});
