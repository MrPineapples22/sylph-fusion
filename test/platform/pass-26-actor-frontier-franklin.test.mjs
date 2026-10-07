import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ActorKnowledgeGraph,
} from '../../dist/intelligence/adversarial/actor-graph.js';
import {
  IngestionGapReconciler,
} from '../../dist/platform/ingestion/gap-reconciler.js';
import {
  FranklinControlledExperimentationEngine,
} from '../../dist/intelligence/experimentation/franklin-experiment.js';
import { Store } from '../../dist/store.js';

test('PASS-26 REQ-1 (Target 1): ActorKnowledgeGraph reversible edge contribution ledger & rollbackSlot / retractLaunch', () => {
  const akg = new ActorKnowledgeGraph();
  const actorAlpha = 'ActorAlpha111111111111111111111111111111111';
  const mint1 = 'Mint111111111111111111111111111111111111111';
  const mint2 = 'Mint222222222222222222222222222222222222222';
  const mint3 = 'Mint333333333333333333333333333333333333333';

  // 1. Register 3 launches for ActorAlpha across slots 100, 105, 110
  // Launch 1 (Slot 100): High runner launch
  akg.registerLaunch({
    launchId: 'launch-slot-100',
    mint: mint1,
    creatorAddress: actorAlpha,
    slot: 100,
    timestampMs: 1000,
    rapidLiquidityLoss: false,
    maePct: 10,
    mfePct: 150, // runner
    averageHoldingTimeSec: 120,
  });

  // Launch 2 (Slot 105): Moderate neutral launch
  akg.registerLaunch({
    launchId: 'launch-slot-105',
    mint: mint2,
    creatorAddress: actorAlpha,
    slot: 105,
    timestampMs: 2000,
    rapidLiquidityLoss: false,
    maePct: 20,
    mfePct: 30,
    averageHoldingTimeSec: 60,
  });

  // Launch 3 (Slot 110): Malicious rug launch (rapid liquidity loss)
  akg.registerLaunch({
    launchId: 'launch-slot-110',
    mint: mint3,
    creatorAddress: actorAlpha,
    slot: 110,
    timestampMs: 3000,
    rapidLiquidityLoss: true, // rug
    maePct: 90,
    mfePct: 0,
    averageHoldingTimeSec: 15,
  });

  // Initial state: 3 launches, 1 rug (33.3%), 1 runner (33.3%)
  const profileBefore = akg.getActorProfile(actorAlpha);
  assert.ok(profileBefore);
  assert.strictEqual(profileBefore.totalLaunchesAssociated, 3);
  assert.strictEqual(profileBefore.rugOrDumpRatePct, 33.3);
  assert.strictEqual(profileBefore.runnerRatePct, 33.3);
  assert.strictEqual(akg.getActiveLaunchesForActor(actorAlpha).length, 3);

  // 2. Rollback slot 110 (reorg / invalid block containing the rug launch)
  const rolledBackCount = akg.rollbackSlot(110);
  assert.strictEqual(rolledBackCount, 1, 'Exactly 1 launch at slot 110 must be retracted');

  // Profile must be recalculated dynamically strictly from remaining active launches (slot 100 & 105)
  const profileAfterRollback = akg.getActorProfile(actorAlpha);
  assert.ok(profileAfterRollback);
  assert.strictEqual(profileAfterRollback.totalLaunchesAssociated, 2);
  assert.strictEqual(profileAfterRollback.rugOrDumpRatePct, 0, 'Rug percentage must revert to 0% after retracting slot 110 rug');
  assert.strictEqual(profileAfterRollback.runnerRatePct, 50, 'Runner percentage must be 1/2 = 50%');

  const activeLaunches = akg.getActiveLaunchesForActor(actorAlpha);
  assert.strictEqual(activeLaunches.length, 2);
  assert.strictEqual(activeLaunches[0].launchId, 'launch-slot-100');
  assert.strictEqual(activeLaunches[1].launchId, 'launch-slot-105');

  // 3. Retract specific launch by ID: retract launch-slot-105
  const retracted = akg.retractLaunch('launch-slot-105');
  assert.strictEqual(retracted, true);

  const profileAfterSingleRetract = akg.getActorProfile(actorAlpha);
  assert.ok(profileAfterSingleRetract);
  assert.strictEqual(profileAfterSingleRetract.totalLaunchesAssociated, 1);
  assert.strictEqual(profileAfterSingleRetract.runnerRatePct, 100, 'Only the runner launch remains active');

  // 4. Retract remaining launch at slot 100
  akg.rollbackSlot(100);
  assert.strictEqual(akg.getActorProfile(actorAlpha), undefined, 'Profile must be cleaned up when 0 active launches remain');
});

test('PASS-26 REQ-2 (Target 2): unverified persisted frontier rows cannot pre-seed continuous coverage', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sylph-pass26-frontier-'));
  const dbPath = join(tempDir, 'reconciler-frontier.db');
  const store = new Store(dbPath);

  try {
    // 1. Simulate prior engine session persisting continuous coverage frontier at slot 50_000
    await store.saveCoverageFrontier({
      lane: 'CHAIN_BLOCK',
      continuousSlot: 50_000,
      frontierSlot: 50_000,
      updatedAtMs: Date.now(),
    });

    // Verify persistence in store
    const persisted = await store.getCoverageFrontier('CHAIN_BLOCK');
    assert.ok(persisted);
    assert.strictEqual(persisted.continuous_slot, 50_000);

    // 2. A legacy slot/root row is not bound to a verified range certificate,
    // so the reconciler must fail closed instead of treating it as continuity proof.
    const reconciler = new IngestionGapReconciler();
    assert.strictEqual(reconciler.getContinuousSlot(), 0, 'Before loading frontier, continuousSlot is 0');
    await assert.rejects(reconciler.loadPersistedFrontier(store, 'CHAIN_BLOCK'), /PERSISTED_COVERAGE_FRONTIER_UNVERIFIED/);
    assert.strictEqual(reconciler.getContinuousSlot(), 0, 'Unverified database rows never advance the in-memory frontier');

    // 3. The first live contiguous receipt establishes a fresh local baseline.
    const gap1 = reconciler.observeSlot(50_001);
    assert.strictEqual(gap1, null, 'The first contiguous live receipt establishes a baseline');
    assert.strictEqual(reconciler.getContinuousSlot(), 50_001);

    // 4. Stream slot 50,005 (slots 50,002, 50,003, 50,004 dropped by provider)
    const detectedGap = reconciler.observeSlot(50_005);
    assert.ok(detectedGap, 'Real missing interval must be accurately detected');
    assert.strictEqual(detectedGap.startSlot, 50_002);
    assert.strictEqual(detectedGap.endSlot, 50_004);

    // 5. Test constructor pre-seeding option
    const reconcilerDirect = new IngestionGapReconciler(undefined, 80_000);
    assert.strictEqual(reconcilerDirect.getContinuousSlot(), 80_000);
    const directGap = reconcilerDirect.observeSlot(80_001);
    assert.strictEqual(directGap, null);
  } finally {
    await store.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('PASS-26 REQ-3 (Target 3): FranklinControlledExperimentationEngine evidence supersession & cohort demotion', () => {
  const engine = new FranklinControlledExperimentationEngine();

  // 1. Register experimental candidate
  const expAlpha = engine.registerExperiment({
    name: 'AdaptiveSpreadRegime',
    hypothesis: 'Dynamic spread widening during high actor recurrence reduces adverse selection',
    target_sample_size: 50,
    rollback_version: 'v1.4.2',
  });
  assert.strictEqual(expAlpha.current_stage, 'STAGE_1_HYPOTHESIS');

  const root1 = 'ev_root_hash_alpha_stage1_slot100_120';
  const root2 = 'ev_root_hash_alpha_stage2_slot121_150';

  // 2. Promote candidate Stage 1 -> Stage 2 (OFFLINE)
  const promo1 = engine.evaluatePromotion(expAlpha.experiment_id, {
    samples: 30,
    sharpe: 2.4,
    win_rate: 0.65,
    drawdown_pct: 4.0,
    brier_score: 0.15,
    evidence_root: root1,
    slot_range: { start: 100, end: 120 },
  });
  assert.strictEqual(promo1.promoted, true);
  assert.strictEqual(promo1.next_stage, 'STAGE_2_OFFLINE');

  // 3. Promote candidate Stage 2 -> Stage 3 (ATLAS_REPLAY)
  const promo2 = engine.evaluatePromotion(expAlpha.experiment_id, {
    samples: 40,
    sharpe: 2.8,
    win_rate: 0.70,
    drawdown_pct: 3.5,
    brier_score: 0.12,
    evidence_root: root2,
    slot_range: { start: 121, end: 150 },
  });
  assert.strictEqual(promo2.promoted, true);
  assert.strictEqual(promo2.next_stage, 'STAGE_3_ATLAS_REPLAY');

  // Verify recorded evidence roots
  const roots = engine.getExperimentEvidenceRoots(expAlpha.experiment_id);
  assert.deepStrictEqual(roots, [root1, root2]);

  // 4. Verify supersession fence: Reject promotion if an evidence root has been invalidated
  const supersededRoot = 'ev_root_superseded_pre_reconciliation';
  engine.invalidateEvidenceRoot(supersededRoot);
  assert.strictEqual(engine.isEvidenceRootSuperseded(supersededRoot), true);

  const expBeta = engine.registerExperiment({
    name: 'FlawedModel',
    hypothesis: 'Model trained on unreconciled gap interval',
    target_sample_size: 50,
    rollback_version: 'v1.0.0',
  });

  const rejectPromo = engine.evaluatePromotion(expBeta.experiment_id, {
    samples: 35,
    sharpe: 3.1,
    win_rate: 0.75,
    drawdown_pct: 2.0,
    brier_score: 0.10,
    evidence_root: supersededRoot,
  });
  assert.strictEqual(rejectPromo.promoted, false);
  assert.strictEqual(rejectPromo.next_stage, undefined);
  assert.match(rejectPromo.rejection_reason ?? '', /superseded by historical gap reconciliation/);

  // 5. Test RecoveryCertificate processing and automated cohort demotion
  // A gap [115, 125] was detected and repaired via RecoveryCertificate.
  // This overlaps expAlpha's Stage 1 slot range [100, 120] and Stage 2 slot range [121, 150].
  const demotionReport = engine.handleRecoveryCertificate({
    gapId: 'gap-reconciliation-slots-115-125',
    startSlot: 115,
    endSlot: 125,
    stateRoot: 'state_root_hash_repaired_3892',
    coverageRoot: 'coverage_root_repaired_9918',
  });

  // Verify expAlpha was identified and demoted
  assert.ok(demotionReport.demotedExperiments.includes(expAlpha.experiment_id));
  assert.ok(engine.isEvidenceRootSuperseded(root1));
  assert.ok(engine.isEvidenceRootSuperseded(root2));

  // ExpAlpha must be demoted back to STAGE_2_OFFLINE
  const currentExpAlpha = engine.getExperiment(expAlpha.experiment_id);
  assert.ok(currentExpAlpha);
  assert.strictEqual(currentExpAlpha.current_stage, 'STAGE_2_OFFLINE', 'Experiment cohort must be demoted to STAGE_2_OFFLINE upon gap repair');

  // 6. Direct invalidation of an individual evidence root
  const expGamma = engine.registerExperiment({
    name: 'DirectInvalidationTest',
    hypothesis: 'Direct invalidation test',
    target_sample_size: 50,
    rollback_version: 'v1.0.0',
  });
  const gammaRoot = 'ev_root_gamma_independent';
  engine.evaluatePromotion(expGamma.experiment_id, {
    samples: 30,
    sharpe: 2.0,
    win_rate: 0.60,
    drawdown_pct: 5.0,
    brier_score: 0.20,
    evidence_root: gammaRoot,
  });
  assert.strictEqual(engine.getExperiment(expGamma.experiment_id)?.current_stage, 'STAGE_2_OFFLINE');

  // Advance to Stage 3
  const gammaRoot2 = 'ev_root_gamma_stage2';
  engine.evaluatePromotion(expGamma.experiment_id, {
    samples: 30,
    sharpe: 2.2,
    win_rate: 0.62,
    drawdown_pct: 4.5,
    brier_score: 0.18,
    evidence_root: gammaRoot2,
  });
  assert.strictEqual(engine.getExperiment(expGamma.experiment_id)?.current_stage, 'STAGE_3_ATLAS_REPLAY');

  const { demotedExperiments } = engine.invalidateEvidenceRoot(gammaRoot2);
  assert.deepStrictEqual(demotedExperiments, [expGamma.experiment_id]);
  assert.strictEqual(engine.getExperiment(expGamma.experiment_id)?.current_stage, 'STAGE_2_OFFLINE');
});
