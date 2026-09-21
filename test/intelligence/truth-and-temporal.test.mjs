import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ChainTruthEngine } from '../../dist/intelligence/truth/chain-truth.js';
import { RPCProviderPool } from '../../dist/intelligence/truth/rpc-pool.js';
import { TemporalFirewall, TemporalLeakageError } from '../../dist/intelligence/truth/temporal-firewall.js';
import { PointInTimeFeatureStore } from '../../dist/intelligence/truth/feature-store.js';

test('ChainTruthEngine: tracks commitments, handles forks, and triggers forensic rollback', () => {
  const engine = new ChainTruthEngine();
  const rollbacks = [];
  engine.registerRollbackListener((action) => rollbacks.push(action));

  const evt1 = {
    eventId: 'evt-1',
    eventType: 'SWAP_BUY',
    mint: 'Mint11111111111111111111111111111111111111',
    source: 'pump_portal',
    sourceTimestampMs: 1_000_000,
    receivedTimestampMs: 1_000_050,
    monotonicTimestampNs: 1000n,
    slot: 100,
    commitment: 'processed',
    sequenceId: 1n,
    chainState: 'TENTATIVE',
    payload: { amount: 1000 },
    sourceConfidence: 0.95,
    freshnessMs: 50,
    provenance: {
      endpointId: 'ws-main',
      transport: 'websocket',
      rawPayloadHash: 'hash-1',
      ingestedByWorkerId: 'worker-1',
    },
  };

  const evt2 = {
    ...evt1,
    eventId: 'evt-2',
    slot: 101,
    sequenceId: 2n,
  };

  engine.registerEvent(evt1);
  engine.registerEvent(evt2);

  // Advance commitment
  engine.advanceSlotCommitment(100, 'confirmed');
  assert.equal(engine.getEvent('evt-1')?.chainState, 'CONFIRMED');

  engine.advanceSlotCommitment(100, 'finalized');
  assert.equal(engine.getEvent('evt-1')?.chainState, 'FINAL');

  // Fork reorg: Slot 101 orphaned in favor of slot 102
  engine.handleForkDetected([101], 102);

  assert.equal(engine.getEvent('evt-2')?.chainState, 'ORPHANED');
  assert.equal(rollbacks.length, 1);
  assert.equal(rollbacks[0].orphanedEvent.eventId, 'evt-2');
  assert.match(rollbacks[0].reason, /Slot 101 orphaned/);

  // Forensics preserved
  const summary = engine.getCommitmentSummary();
  assert.equal(summary.totalTrackedEvents, 2);
  assert.equal(summary.totalOrphanedEvents, 1);
  assert.equal(engine.getForensicOrphanedHistory().length, 1);
});

test('RPCProviderPool: quorum consensus and slot discrepancy tracking', () => {
  const pool = new RPCProviderPool([
    { endpointId: 'rpc-helius', url: 'https://helius.mock' },
    { endpointId: 'rpc-quicknode', url: 'https://quicknode.mock' },
    { endpointId: 'rpc-triton', url: 'https://triton.mock' },
  ]);

  pool.recordTelemetry('rpc-helius', { latencyMs: 25, slot: 200, blockhash: 'hashA' });
  pool.recordTelemetry('rpc-quicknode', { latencyMs: 30, slot: 200, blockhash: 'hashA' });
  pool.recordTelemetry('rpc-triton', { latencyMs: 28, slot: 199, blockhash: 'hashA' });

  assert.equal(pool.getHealthyEndpoints().length, 3);

  // Quorum check: All agree on token balance 5000
  const agreedQuorum = pool.verifyQuorum([
    { endpointId: 'rpc-helius', value: 5000n, slot: 200, blockhash: 'hashA' },
    { endpointId: 'rpc-quicknode', value: 5000n, slot: 200, blockhash: 'hashA' },
    { endpointId: 'rpc-triton', value: 5000n, slot: 199, blockhash: 'hashA' },
  ]);

  assert.equal(agreedQuorum.agreed, true);
  assert.equal(agreedQuorum.agreeingEndpoints.length, 3);
  assert.equal(agreedQuorum.maxSlotDiscrepancy, 1);

  // Quorum check with dissenter: One endpoint reports 99999n
  const splitQuorum = pool.verifyQuorum([
    { endpointId: 'rpc-helius', value: 5000n, slot: 200, blockhash: 'hashA' },
    { endpointId: 'rpc-quicknode', value: 99999n, slot: 200, blockhash: 'hashA' },
  ]);

  assert.equal(splitQuorum.agreed, false); // 50% does not satisfy 60% majority
  assert.equal(splitQuorum.dissentingEndpoints.includes('rpc-quicknode'), true);
});

test('TemporalFirewall & PointInTimeFeatureStore: eliminates lookahead leakage', () => {
  const store = new PointInTimeFeatureStore();
  const mint = 'TargetToken111111111111111111111111111111';

  // Snapshot at T=10,000, Slot 100
  const snap1 = store.recordSnapshot({
    snapshotId: 'snap-1',
    mint,
    slot: 100,
    timestampMs: 10_000,
    tokenAgeSeconds: 10,
    featureSchemaVersion: '1.0.0',
    features: { hsi: 75, volumeSol: 15.5, buyerCount: 20 },
    dataQualityScore: 0.98,
    freshnessMs: 50,
  });

  assert.match(snap1.snapshotHash, /^[a-f0-9]{64}$/);

  // Snapshot at T=20,000, Slot 200
  store.recordSnapshot({
    snapshotId: 'snap-2',
    mint,
    slot: 200,
    timestampMs: 20_000,
    tokenAgeSeconds: 20,
    featureSchemaVersion: '1.0.0',
    features: { hsi: 85, volumeSol: 50.0, buyerCount: 65 },
    dataQualityScore: 0.99,
    freshnessMs: 20,
  });

  // Decision at T=15,000, Slot 150 must retrieve snap1 (NOT snap2 from the future!)
  const retrieved = store.getSnapshotAsOf(mint, 15_000, 150);
  assert.equal(retrieved?.snapshotId, 'snap-1');
  assert.equal(retrieved?.features.buyerCount, 20);

  // Direct check: Attempting to assert snap2 before decision T=15,000 throws TemporalLeakageError
  assert.throws(
    () => {
      TemporalFirewall.assertAvailableBeforeDecision(
        { artifactId: 'snap-2', availableTimestampMs: 20_000, availableSlot: 200 },
        { decisionTimestampMs: 15_000, decisionSlot: 150 }
      );
    },
    (err) => {
      assert.ok(err instanceof TemporalLeakageError);
      assert.match(err.message, /lookahead leakage/);
      return true;
    }
  );
});
