import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PointInTimeFeatureStore,
} from '../../dist/intelligence/truth/feature-store.js';
import {
  YellowstoneTruthBridge,
} from '../../dist/platform/ingestion/yellowstone-truth-bridge.js';
import {
  ProviderHealthTracker,
} from '../../dist/platform/ingestion/provider-health.js';
import {
  ReversibleRollingWindow,
  computeStateRecoveryRoot,
  computeBlastRadiusCertificate,
} from '../../dist/platform/ingestion/contract-canary.js';
import { Store } from '../../dist/store.js';

test('PASS-28 REQ-1: PointInTimeFeatureStore validity layer & bitemporal replay (AS_KNOWN_THEN vs CORRECTED_TRUTH)', () => {
  const store = new PointInTimeFeatureStore(100);
  const mint = 'FeatureMint111111111111111111111111111111111';

  // 1. Record two snapshots across slots
  const snap1 = store.recordSnapshot({
    snapshotId: 'snap_1',
    mint,
    slot: 100,
    timestampMs: 1_000,
    tokenAgeSeconds: 10,
    featureSchemaVersion: '1.0.0',
    features: { hsi: 85, price: 1.0 },
    dataQualityScore: 0.95,
    freshnessMs: 50,
    contractEpochId: 'epoch_canary_01',
  });

  const snap2 = store.recordSnapshot({
    snapshotId: 'snap_2',
    mint,
    slot: 200,
    timestampMs: 2_000,
    tokenAgeSeconds: 20,
    featureSchemaVersion: '1.0.0',
    features: { hsi: 92, price: 1.5 },
    dataQualityScore: 0.98,
    freshnessMs: 40,
    contractEpochId: 'epoch_canary_02',
  });

  assert.equal(store.getSnapshotValidity('snap_1').status, 'ACTIVE');
  assert.equal(store.getSnapshotValidity('snap_2').status, 'ACTIVE');

  // Both replay modes initially return the latest snapshot (snap2)
  const asKnownInitial = store.getSnapshotAsOf(mint, 2_500, 250, 'AS_KNOWN_THEN');
  const correctedInitial = store.getSnapshotAsOf(mint, 2_500, 250, 'CORRECTED_TRUTH');
  assert.equal(asKnownInitial?.snapshotId, 'snap_2');
  assert.equal(correctedInitial?.snapshotId, 'snap_2');

  // 2. Retroactively invalidate snap2 due to upstream contract epoch drift
  store.invalidateSnapshot({
    snapshotId: 'snap_2',
    status: 'CONTAMINATED',
    reason: 'UPSTREAM_BONDING_CURVE_PRICE_MANIPULATION',
    invalidatedBy: 'CONTRACT_CANARY_CYCLE_3',
  });

  assert.equal(store.getSnapshotValidity('snap_2').status, 'CONTAMINATED');

  // 3. Invariant: CORRECTED_TRUTH must purge contaminated snapshot and fall back to snap1
  const correctedPostInvalidation = store.getSnapshotAsOf(mint, 2_500, 250, 'CORRECTED_TRUTH');
  assert.equal(correctedPostInvalidation?.snapshotId, 'snap_1', 'CORRECTED_TRUTH must exclude contaminated snapshot');

  // 4. Invariant: AS_KNOWN_THEN reproduces what SYLPH believed at time T (snap2)
  const asKnownPostInvalidation = store.getSnapshotAsOf(mint, 2_500, 250, 'AS_KNOWN_THEN');
  assert.equal(asKnownPostInvalidation?.snapshotId, 'snap_2', 'AS_KNOWN_THEN preserves point-in-time belief');

  // 5. Invalidate by whole contract epoch
  const invalidatedCount = store.invalidateSnapshotsForContractEpoch('epoch_canary_01', 'EPOCH_SUPERSEDED');
  assert.equal(invalidatedCount, 1);
  assert.equal(store.getSnapshotValidity('snap_1').status, 'INVALIDATED');

  // When both snapshots are invalidated, CORRECTED_TRUTH safely returns undefined
  const allInvalidated = store.getSnapshotAsOf(mint, 2_500, 250, 'CORRECTED_TRUTH');
  assert.equal(allInvalidated, undefined, 'Must fail closed when all available snapshots are invalidated');
});

test('PASS-28 REQ-2: YellowstoneTruthBridge topology classification and calibrated confidence', () => {
  const mockChainTruth = {
    registerEvent: (ev) => true,
  };

  // Direct validator connection
  const directBridge = new YellowstoneTruthBridge({
    chainTruth: mockChainTruth,
    endpointUrl: 'grpc.validator-01.solana.internal:10000',
    topology: 'DIRECT_VALIDATOR_GEYSER',
    validatorIdentity: 'ValIdent111111111111111111111111111111111111',
  });

  const directMeta = directBridge.getTopologyMeta();
  assert.equal(directMeta.topology, 'DIRECT_VALIDATOR_GEYSER');
  assert.equal(directMeta.verifiedDirectLeader, true);
  assert.equal(directMeta.maxAllowedSlotSkew, 2);

  let capturedDirectEvent = null;
  directBridge.on('canonical_event', (ev) => { capturedDirectEvent = ev; });

  directBridge.ingestTransactionUpdate({
    slot: 310555100,
    signature: 'SigDirect111111111111111111111111111111111111111111111111111111111111111111111111111111',
    logs: ['Program log: Instruction: InitializeMint', 'Program log: mint: MintTest1111111111111111111111111111111111'],
  });

  assert.ok(capturedDirectEvent);
  assert.equal(capturedDirectEvent.sourceConfidence, 0.999);
  assert.equal(capturedDirectEvent.payload.topology, 'DIRECT_VALIDATOR_GEYSER');
  assert.ok(capturedDirectEvent.payload.wireWitnessId.startsWith('wit_SOLANA_GEYSER_'));

  // Intermediate proxy relay connection
  const proxyBridge = new YellowstoneTruthBridge({
    chainTruth: mockChainTruth,
    endpointUrl: 'grpc.triton-proxy.edge:10000',
    topology: 'INTERMEDIATE_PROXY_RELAY',
  });

  const proxyMeta = proxyBridge.getTopologyMeta();
  assert.equal(proxyMeta.topology, 'INTERMEDIATE_PROXY_RELAY');
  assert.equal(proxyMeta.verifiedDirectLeader, false);
  assert.equal(proxyMeta.maxAllowedSlotSkew, 8);

  let capturedProxyEvent = null;
  proxyBridge.on('canonical_event', (ev) => { capturedProxyEvent = ev; });

  proxyBridge.ingestTransactionUpdate({
    slot: 310555105,
    signature: 'SigProxy1111111111111111111111111111111111111111111111111111111111111111111111111111111',
    logs: ['Program log: Instruction: Buy', 'Program log: mint: MintTest1111111111111111111111111111111111'],
  });

  assert.ok(capturedProxyEvent);
  assert.equal(capturedProxyEvent.sourceConfidence, 0.850, 'Proxy relay must calibrate down to 0.850 confidence');
  assert.equal(capturedProxyEvent.payload.topology, 'INTERMEDIATE_PROXY_RELAY');
});

test('PASS-28 REQ-3: ProviderHealthTracker adaptive rate-limit & circuit breaker WAL persistence', async () => {
  const dbPath = resolve(process.cwd(), `test-provider-quota-${Date.now()}.db`);
  const store = new Store(dbPath);

  try {
    const tracker = new ProviderHealthTracker();
    tracker.setProviderConfiguration('RUGCHECK_API', true, true, true);
    const now = Date.now();

    // 1. Record rate limit with 30s cooldown and persist
    await tracker.recordRateLimitAndPersist('RUGCHECK_API', 30_000, store);

    const report = tracker.getReport(now);
    assert.equal(report.providers.RUGCHECK_API.state, 'RATE_LIMITED');
    assert.ok(report.providers.RUGCHECK_API.rateLimitedUntilMs > now);

    // 2. Fetch directly from SQLite WAL
    const quotaRow = await store.getProviderQuota('RUGCHECK_API');
    assert.ok(quotaRow);
    assert.equal(quotaRow.provider_id, 'RUGCHECK_API');
    assert.equal(quotaRow.circuit_state, 'DEGRADED');
    assert.equal(quotaRow.last_failure_reason, 'HTTP_429_RATE_LIMITED');

    // 3. Simulate process restart: new instance hydrated from SQLite WAL
    const restartedTracker = new ProviderHealthTracker();
    restartedTracker.setProviderConfiguration('RUGCHECK_API', true, true, true);

    const allQuotas = await store.getAllProviderQuotas();
    const hydratedCount = restartedTracker.hydrateDurableState(allQuotas);
    assert.equal(hydratedCount, 1);

    // 4. Invariant: Restarted engine remembers rate-limit cooldown
    const restartedReport = restartedTracker.getReport(now);
    assert.equal(restartedReport.providers.RUGCHECK_API.state, 'RATE_LIMITED', 'Rate limited state must survive restart');
    assert.ok(restartedReport.providers.RUGCHECK_API.rateLimitedUntilMs > now);
  } finally {
    await store.close();
    try { rmSync(dbPath, { force: true }); } catch {}
    try { rmSync(`${dbPath}-wal`, { force: true }); } catch {}
    try { rmSync(`${dbPath}-shm`, { force: true }); } catch {}
  }
});

test('PASS-28 REQ-4: ReversibleRollingWindow contribution lineage & non-subtractive recalculation', () => {
  const window = new ReversibleRollingWindow(60_000, (v) => v);
  const now = Date.now();

  // Add 4 price velocity observations
  window.append({
    contributionId: 'obs_1',
    targetStateId: 'price_velocity',
    sourceEventId: 'ev_1',
    evidenceId: 'evd_1',
    contractEpochId: 'epoch_good',
    observedAtMs: now - 30_000,
    delta: 10,
  });

  window.append({
    contributionId: 'obs_2',
    targetStateId: 'price_velocity',
    sourceEventId: 'ev_2',
    evidenceId: 'evd_2',
    contractEpochId: 'epoch_bad', // Bad provider epoch!
    observedAtMs: now - 20_000,
    delta: 50,                    // Spike
  });

  window.append({
    contributionId: 'obs_3',
    targetStateId: 'price_velocity',
    sourceEventId: 'ev_3',
    evidenceId: 'evd_3',
    contractEpochId: 'epoch_good',
    observedAtMs: now - 10_000,
    delta: 20,
  });

  assert.equal(window.computeSum(now), 80);
  assert.equal(window.getActiveObservations(now).length, 3);

  // Invalidate the bad observation from compromised contract epoch
  const invalidatedCount = window.invalidateContractEpoch('epoch_bad');
  assert.equal(invalidatedCount, 1);

  // Sum recomputed exclusively from surviving ACTIVE observations (10 + 20 = 30)
  assert.equal(window.computeSum(now), 30);
  assert.equal(window.getActiveObservations(now).length, 2);

  // Velocity correctly recomputed between obs_1 (10 @ -30s) and obs_3 (20 @ -10s):
  // dt = 20s, dVal = 10 -> velocity = 0.5/s
  const velocity = window.computeVelocity(now);
  assert.equal(Number(velocity.toFixed(2)), 0.50);
});

test('PASS-28 REQ-5: StateRecoveryRoot and BlastRadiusCertificate generation', () => {
  // 1. Generate StateRecoveryRoot
  const recoveryRoot = computeStateRecoveryRoot({
    recoverySlot: 310555500,
    recoveryEpoch: 42,
    rawEvidenceRoot: '0x1111111111111111111111111111111111111111111111111111111111111111',
    contractEpochRoot: '0x2222222222222222222222222222222222222222222222222222222222222222',
    canonicalEventRoot: '0x3333333333333333333333333333333333333333333333333333333333333333',
    rollingStateRoot: '0x4444444444444444444444444444444444444444444444444444444444444444',
    featureSnapshotRoot: '0x5555555555555555555555555555555555555555555555555555555555555555',
    modelEpochRoot: '0x6666666666666666666666666666666666666666666666666666666666666666',
    calibrationRoot: '0x7777777777777777777777777777777777777777777777777777777777777777',
    positionReconciliationRoot: '0x8888888888888888888888888888888888888888888888888888888888888888',
  });

  assert.equal(recoveryRoot.rootDigest.length, 64);
  assert.equal(recoveryRoot.recoverySlot, 310555500);
  assert.equal(recoveryRoot.recoveryEpoch, 42);

  // 2. Blast radius with affected positions -> RECONCILE_POSITION
  const certPosition = computeBlastRadiusCertificate({
    invalidatedContractEpochId: 'epoch_drift_01',
    affectedRawWitnessCount: 15,
    affectedCanonicalEventsCount: 12,
    affectedSnapshotCount: 4,
    affectedPositionCount: 1,
  });

  assert.equal(certPosition.requiredAction, 'RECONCILE_POSITION');
  assert.ok(certPosition.certificateId.startsWith('brc_epoch_drift_01_'));
  assert.equal(certPosition.certificateDigest.length, 64);

  // 3. Blast radius with no open positions but affected snapshots -> RECOMPUTE
  const certFeatures = computeBlastRadiusCertificate({
    invalidatedContractEpochId: 'epoch_drift_02',
    affectedRawWitnessCount: 8,
    affectedCanonicalEventsCount: 6,
    affectedSnapshotCount: 2,
    affectedPositionCount: 0,
  });

  assert.equal(certFeatures.requiredAction, 'RECOMPUTE');
});
