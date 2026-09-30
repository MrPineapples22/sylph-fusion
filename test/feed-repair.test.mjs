import test from 'node:test';
import assert from 'node:assert/strict';
import { Feed } from '../dist/feed.js';
import { Connection } from '@solana/web3.js';

test('Feed: accepts bounded late slots for historical repair without renewing execution freshness', () => {
  const events = [];
  const cfg = {
    FEED_STALE_MS: 5000,
    MIN_AGE_MS: 1000,
    WS_URLS: [],
    YELLOWSTONE_URL: '',
  };
  const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  const feed = new Feed(cfg, conn, (e) => events.push(e));

  // Mock parser parseLogs to return a synthetic decoded event
  feed.parser = {
    parseLogs: () => [{ name: 'TradeEvent', data: { mint: 'mint123', solAmount: 100 } }]
  };

  const logs = ['Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]', 'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'];
  const src = { sourceId: 'src-1', providerId: 'https://rpc.example.com', transport: 'ws' };
  const repairSrc = { ...src, isRepair: true };

  // First event at slot 500
  feed.accept('sig-1', 500, logs, src);
  assert.equal(events.length, 1);
  assert.equal(feed.slot, 500);
  const firstLastTime = feed.last;
  assert.ok(firstLastTime > 0);

  // Late event at slot 450 (within 1000 slot repair window with isRepair: true)
  feed.accept('sig-2', 450, logs, repairSrc);
  assert.equal(events.length, 2, 'Late slot within repair window should be accepted and consumed');
  assert.equal(events[1].slot, 450);
  assert.equal(feed.slot, 500, 'Feed slot should remain at max slot 500');
  assert.equal(feed.last, firstLastTime, 'Feed last execution timestamp should not be updated by late slot');

  // Excessively stale event (slot 500 - slot 200 > 1000? No, let's test slot 2000 vs 500)
  feed.accept('sig-3', 2000, logs, src);
  assert.equal(events.length, 3);
  assert.equal(feed.slot, 2000);

  // Slot 500 is now > 1000 slots behind 2000 (diff 1500 > 1000)
  feed.accept('sig-4', 500, logs, src);
  assert.equal(events.length, 3, 'Slot older than bounded 1000-slot window should be rejected');
});
