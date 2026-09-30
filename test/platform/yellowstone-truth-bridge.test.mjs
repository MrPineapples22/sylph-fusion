import test from 'node:test';
import assert from 'node:assert/strict';
import { YellowstoneTruthBridge } from '../../dist/platform/ingestion/yellowstone-truth-bridge.js';
import { ChainTruthEngine } from '../../dist/intelligence/truth/chain-truth.js';

test('YellowstoneTruthBridge: in-flight parsing and canonical event registration', () => {
  const chainTruth = new ChainTruthEngine();
  const bridge = new YellowstoneTruthBridge({
    chainTruth,
    endpointUrl: 'grpc://yellowstone.solana-mainnet.internal:10000',
    workerId: 'worker-node-1',
  });

  const emittedEvents = [];
  bridge.on('canonical_event', (evt) => emittedEvents.push(evt));

  // 1. Ingest SWAP_BUY
  const buyTx = {
    signature: '5x11111111111111111111111111111111111111111111111111111111111111111111111111111111111111',
    slot: 123456,
    logs: [
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
      'Program log: Instruction: Buy',
      'Program log: mint: TokenMintBuy11111111111111111111111111111111',
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success',
    ],
  };

  const reg1 = bridge.ingestUpdate(buyTx);
  assert.equal(reg1, true);
  assert.equal(emittedEvents.length, 1);
  assert.equal(emittedEvents[0].eventType, 'SWAP_BUY');
  assert.equal(emittedEvents[0].mint, 'TokenMintBuy11111111111111111111111111111111');
  assert.equal(emittedEvents[0].source, 'yellowstone_grpc');
  assert.equal(emittedEvents[0].provenance.transport, 'geyser_grpc');
  assert.equal(emittedEvents[0].provenance.endpointId, 'grpc://yellowstone.solana-mainnet.internal:10000');
  assert.equal(emittedEvents[0].provenance.ingestedByWorkerId, 'worker-node-1');

  // 2. Ingest SWAP_SELL
  const sellTx = {
    signature: '4x22222222222222222222222222222222222222222222222222222222222222222222222222222222222222',
    slot: 123457,
    logs: [
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
      'Program log: Instruction: Sell',
      'Program log: mint: TokenMintSell1111111111111111111111111111111',
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success',
    ],
  };

  const reg2 = bridge.ingestUpdate(sellTx);
  assert.equal(reg2, true);
  assert.equal(emittedEvents.length, 2);
  assert.equal(emittedEvents[1].eventType, 'SWAP_SELL');
  assert.equal(emittedEvents[1].mint, 'TokenMintSell1111111111111111111111111111111');

  // 3. Ingest POOL_CREATE
  const createTx = {
    signature: '3x33333333333333333333333333333333333333333333333333333333333333333333333333333333333333',
    slot: 123458,
    logs: [
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
      'Program log: Instruction: InitializeMint2',
      'Program log: mint: NewTokenMintCreated11111111111111111111111111',
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success',
    ],
  };

  const reg3 = bridge.ingestUpdate(createTx);
  assert.equal(reg3, true);
  assert.equal(emittedEvents.length, 3);
  assert.equal(emittedEvents[2].eventType, 'POOL_CREATE');

  // 4. Verify metrics
  const stats = bridge.getIngestionStats();
  assert.equal(stats.total_ingested, 3);
  assert.ok(stats.p50_latency_ms >= 0);
  assert.ok(stats.p95_latency_ms >= 0);
  assert.ok(stats.p99_latency_ms >= 0);
});

test('YellowstoneTruthBridge: Deduplication blocks repeated events from counting twice', () => {
  const chainTruth = new ChainTruthEngine();
  const bridge = new YellowstoneTruthBridge({
    chainTruth,
    endpointUrl: 'grpc://yellowstone-backup.internal:10000',
  });

  const tx = {
    signature: '2x44444444444444444444444444444444444444444444444444444444444444444444444444444444444444',
    slot: 200000,
    logs: ['Program log: Instruction: Buy'],
  };

  const first = bridge.ingestUpdate(tx);
  assert.equal(first, true);

  const duplicate = bridge.ingestUpdate(tx);
  assert.equal(duplicate, false);

  const stats = bridge.getIngestionStats();
  assert.equal(stats.total_ingested, 1);
});
