import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CapitalFlowGraph,
} from '../../dist/intelligence/graph/capital-flow-graph.js';
import {
  FundingAncestryEngine,
} from '../../dist/intelligence/graph/funding-ancestry.js';
import {
  PhaseTransitionDetector,
} from '../../dist/intelligence/signals/phase-transition.js';
import { Store } from '../../dist/store.js';

test('PASS-25 REQ-1 (Target 1): CapitalFlowGraph reversible contribution ledger & rollbackSlot', () => {
  const cfg = new CapitalFlowGraph();
  const walletA = 'WalletAlpha11111111111111111111111111111111';
  const mintA = 'MintAlpha1111111111111111111111111111111111';

  // 1. Initial buy at slot 100: wallet buys 5.0 SOL into pool/token
  cfg.recordTransfer({
    fromNode: walletA,
    toNode: `pool:${mintA}`,
    amountSol: 5.0,
    timestampMs: 1000,
    slot: 100,
    mint: mintA,
  });

  assert.strictEqual(cfg.getNetHolding(walletA), 5.0);
  assert.strictEqual(cfg.getWalletBehaviorState(walletA), 'ACCUMULATING');

  // 2. Second buy at slot 110: wallet buys another 3.0 SOL
  cfg.recordTransfer({
    fromNode: walletA,
    toNode: `pool:${mintA}`,
    amountSol: 3.0,
    timestampMs: 2000,
    slot: 110,
    mint: mintA,
  });

  assert.strictEqual(cfg.getNetHolding(walletA), 8.0);

  // Flow metrics evaluate correctly (2 transactions, no outflow -> CAPITAL_ARRIVING)
  const metricsBefore = cfg.evaluateTokenFlow(mintA, 10_000, 2500);
  assert.strictEqual(metricsBefore.netInflowSol, 8.0);
  assert.strictEqual(metricsBefore.phase, 'CAPITAL_ARRIVING');

  // 3. Rollback slot 110 (reorg abandoned slot 110)
  const rolledBackCount = cfg.rollbackSlot(110);
  assert.strictEqual(rolledBackCount, 1, 'Slot 110 transfer must be retracted');

  // Net holding must be restored to 5.0 SOL (8.0 - 3.0 = 5.0)
  assert.strictEqual(cfg.getNetHolding(walletA), 5.0, 'Balance must be cleanly deducted on rollback');

  // Flow metrics now reflect only active transfers
  const metricsAfter = cfg.evaluateTokenFlow(mintA, 10_000, 2500);
  assert.strictEqual(metricsAfter.netInflowSol, 5.0, 'Rolled-back transfer must not count in token flow');

  // 4. Retract remaining transfer at slot 100
  cfg.rollbackSlot(100);
  assert.strictEqual(cfg.getNetHolding(walletA), 0.0);
  assert.strictEqual(cfg.getWalletBehaviorState(walletA), 'SCOUTING');
});

test('PASS-25 REQ-2 (Target 1): FundingAncestryEngine bitemporal relationship stack & rollbackSlot', () => {
  const engine = new FundingAncestryEngine();
  const wallet = 'SybilChildWallet111111111111111111111111111';
  const parent1 = 'FunderParentOne1111111111111111111111111111';
  const parent2 = 'FunderParentTwo1111111111111111111111111111';

  // 1. Funding parent 1 assigned at slot 50
  engine.recordFunding(wallet, parent1, 50, 1000, 'tx-slot-50');
  assert.strictEqual(engine.getParent(wallet), parent1);

  // 2. Fork alternative / repair reassigns parent 2 at slot 60
  engine.recordFunding(wallet, parent2, 60, 2000, 'tx-slot-60');
  assert.strictEqual(engine.getParent(wallet), parent2);

  // Analysis with 3 wallets shows parent2 as funder
  const report1 = engine.analyzeAncestry([
    { walletAddress: wallet, fundingAmountSol: 1.0 },
    { walletAddress: 'W2', fundingParentAddress: parent2, fundingAmountSol: 1.0 },
    { walletAddress: 'W3', fundingParentAddress: parent2, fundingAmountSol: 1.0 },
  ]);
  assert.strictEqual(report1.sharedFunderRatio, 1.0);
  assert.strictEqual(report1.dominantFunder, parent2);

  // 3. Rollback slot 60 (fork abandoned) -> parent reverts to parent 1!
  const rolledBackCount = engine.rollbackSlot(60);
  assert.strictEqual(rolledBackCount, 1);
  assert.strictEqual(engine.getParent(wallet), parent1, 'Active parent must revert to parent 1 after rollback');

  // Re-evaluating ancestry now shows parent 1 for wallet
  const report2 = engine.analyzeAncestry([
    { walletAddress: wallet, fundingAmountSol: 1.0 },
    { walletAddress: 'W2', fundingParentAddress: parent2, fundingAmountSol: 1.0 },
    { walletAddress: 'W3', fundingParentAddress: parent2, fundingAmountSol: 1.0 },
  ]);
  assert.strictEqual(report2.sharedFunderRatio, 0.667);
  assert.strictEqual(report2.independentFundingRootsCount, 2);
});

test('PASS-25 REQ-3 (Target 2): PhaseTransitionDetector chronological sorting & non-inverting kinematics', () => {
  const detector = new PhaseTransitionDetector();
  const mint = 'MintKinematics11111111111111111111111111111';

  // Ingest observation at T=2000 (slot 200)
  detector.recordMetrics(mint, { exitCapacity: 10.0, sellPressure: 1.0, dtf: 0.8 }, 2000, 200);

  // Ingest observation at T=3000 (slot 300)
  detector.recordMetrics(mint, { exitCapacity: 8.0, sellPressure: 1.5, dtf: 0.7 }, 3000, 300);

  // Out-of-order historical repair arrives: happened at T=2500 (slot 250)!
  // Previously, inserting T=2500 after T=3000 produced dt = 2500 - 3000 = -500ms, inverting velocity!
  const reportRepair = detector.recordMetrics(mint, { exitCapacity: 9.0, sellPressure: 1.2, dtf: 0.75 }, 2500, 250);

  // Predecessor of T=2500 is T=2000! dt = (2500 - 2000)/1000 = 0.5s.
  // d(exitCapacity) = 9.0 - 10.0 = -1.0 -> velocity = -1.0 / 0.5 = -2.0 SOL/s
  assert.ok(reportRepair.kinematics.exitCapacity, 'Kinematics must exist');
  assert.strictEqual(reportRepair.kinematics.exitCapacity.velocity, -2.0);
  assert.strictEqual(reportRepair.kinematics.exitCapacity.direction, 'DECREASING');

  // Curve reserves tracking also maintains chronological order
  detector.trackCurveReserves(mint, 10.0, 1000, 100);
  detector.trackCurveReserves(mint, 20.0, 3000, 300);
  // Out of order repair at T=2000 with 15.0 SOL reserve
  const curveReport = detector.trackCurveReserves(mint, 15.0, 2000, 200);
  // dt = (2000 - 1000)/1000 = 1.0s, delta = 15 - 10 = 5 SOL -> velocity = +5.0 SOL/s
  assert.strictEqual(curveReport.velocitySolPerSec, 5.0);

  // Rollback slot 250 removes retroactive metric
  const rolledBackCount = detector.rollbackSlot(250);
  assert.strictEqual(rolledBackCount, 1);
});

test('PASS-25 REQ-4 (Target 3): Store SQLite WAL durable recovery certificate & coverage frontier persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-wal-recovery-'));
  const dbPath = join(dir, 'recovery-journal.db');
  const store = new Store(dbPath);

  try {
    const cert = {
      certificateId: 'cert-wal-001',
      gapId: 'gap-100-110',
      fromSlot: 101,
      toSlot: 109,
      providerId: 'archival-helios-prime',
      recoveredEventIds: ['evt-1', 'evt-2', 'evt-3'],
      skippedSlots: [105],
      deadForkSlots: [],
      coverageRoot: 'cov-root-sha256-abcdef0123456789',
      stateRoot: 'state-root-sha256-9876543210fedcba',
      resolvedAtMs: Date.now(),
      signature: 'ed25519-sig-valid-recovery-proof',
    };

    // 1. Save recovery certificate
    await store.saveRecoveryCertificate(cert);

    // 2. Retrieve by certificate ID
    const retrievedById = await store.getRecoveryCertificate('cert-wal-001');
    assert.ok(retrievedById);
    assert.strictEqual(retrievedById.certificateId, 'cert-wal-001');
    assert.strictEqual(retrievedById.gapId, 'gap-100-110');
    assert.strictEqual(retrievedById.fromSlot, 101);
    assert.strictEqual(retrievedById.toSlot, 109);
    assert.strictEqual(retrievedById.stateRoot, cert.stateRoot);

    // 3. Retrieve by gap ID
    const retrievedByGap = await store.getRecoveryCertificate('gap-100-110');
    assert.ok(retrievedByGap);
    assert.strictEqual(retrievedByGap.certificateId, 'cert-wal-001');
    await store.saveRecoveryCertificate(cert);
    await assert.rejects(
      store.saveRecoveryCertificate({...cert, stateRoot: 'conflicting-content'}),
      /RECOVERY_CERTIFICATE_CONTENT_CONFLICT/,
    );

    // 4. Save and retrieve multi-lane coverage frontier
    const frontier = {
      lane: 'CHAIN_BLOCK',
      continuousSlot: 310_000_150,
      sealedSlot: 310_000_100,
      coverageRoot: 'cov-lane-block-root-777',
    };
    await store.saveCoverageFrontier(frontier);

    const retrievedFrontier = await store.getCoverageFrontier('CHAIN_BLOCK');
    assert.ok(retrievedFrontier);
    assert.strictEqual(retrievedFrontier.lane, 'CHAIN_BLOCK');
    assert.strictEqual(retrievedFrontier.continuous_slot, 310_000_150);
    assert.strictEqual(retrievedFrontier.sealed_slot, 310_000_100);
    assert.strictEqual(retrievedFrontier.coverage_root, 'cov-lane-block-root-777');
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Store: verified range certificates persist append-only in the current schema', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-verified-recovery-'));
  const dbPath = join(dir, 'state.sqlite');
  const store = new Store(dbPath);
  const secondStore = new Store(dbPath);
  const certificate = Object.freeze({
    certificateId: 'verified-cert-v2-001',
    gapId: 'gap-v2-10-11',
    startSlot: 10,
    endSlot: 11,
    providerId: 'archival-provider-a',
    classification: 'MISSING_OBSERVATION',
    lane: 'CHAIN_BLOCK',
    recoveredEventIds: Object.freeze(['event-v2-10']),
    perSlotStatus: Object.freeze({'10': 'RECOVERED', '11': 'EMPTY'}),
    stateRoot: 'a'.repeat(64),
    coverageRoot: 'b'.repeat(64),
    isVerified: true,
    certifiedAtMs: Date.now(),
  });
  try {
    await Promise.all([
      store.saveVerifiedRecoveryCertificate(certificate),
      secondStore.saveVerifiedRecoveryCertificate(certificate),
    ]);
    await store.saveVerifiedRecoveryCertificate(certificate);
    assert.equal(JSON.stringify(await store.getVerifiedRecoveryCertificate(certificate.certificateId)), JSON.stringify(certificate));
    assert.equal(JSON.stringify(await store.getVerifiedRecoveryCertificate(certificate.gapId)), JSON.stringify(certificate));
    await assert.rejects(
      store.saveVerifiedRecoveryCertificate({...certificate, stateRoot: 'c'.repeat(64)}),
      /RECOVERY_CERTIFICATE_CONTENT_CONFLICT/,
    );
    await assert.rejects(
      store.saveVerifiedRecoveryCertificate({...certificate, certificateId: 'unverified', isVerified: false}),
      /RECOVERY_CERTIFICATE_INVALID/,
    );
  } finally {
    await Promise.all([store.close(), secondStore.close()]);
    await rm(dir, {recursive: true, force: true});
  }
});
