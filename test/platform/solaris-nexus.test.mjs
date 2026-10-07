import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LeaderScheduleTracker,
  SLOTS_PER_EPOCH,
  SLOTS_PER_LEADER_CHUNK,
} from '../../dist/platform/execution/solaris/leader-schedule.js';

import {
  DynamicTipAndContentionOracle,
} from '../../dist/platform/execution/solaris/tip-oracle.js';

import {
  BimodalExecutionRouter,
} from '../../dist/platform/execution/solaris/bimodal-router.js';

import {
  PostGraduationAmmBridge,
} from '../../dist/platform/execution/solaris/amm-bridge.js';

import {
  IngestionGapReconciler,
} from '../../dist/platform/ingestion/gap-reconciler.js';

import { globalCommandGateway } from '../../dist/command-gateway.js';
import { globalProjectionService } from '../../dist/projection-service.js';
import { Market } from '../../dist/market.js';

test('SOLARIS LeaderScheduleTracker: Indexes 432,000 slots per epoch and tracks Jito vs Vanilla leaders', () => {
  const jitoLeaderKey = 'JitoLeader1111111111111111111111111111111111';
  const agaveLeaderKey = 'AgaveLeader222222222222222222222222222222222';

  const tracker = new LeaderScheduleTracker([jitoLeaderKey]);

  tracker.registerValidatorStakes([
    { pubkey: jitoLeaderKey, stakeLamports: 80_000_000_000_000_000n, isJito: true },
    { pubkey: agaveLeaderKey, stakeLamports: 20_000_000_000_000_000n, isJito: false },
  ]);

  // Load an epoch schedule: chunk 0-3 assigned to Jito, chunk 4-7 assigned to Agave
  tracker.loadEpochSchedule(
    100,
    {
      [jitoLeaderKey]: [0, 1, 2, 3],
      [agaveLeaderKey]: [4, 5, 6, 7],
    },
    250_000
  );

  const slot0Leader = tracker.getSlotLeader(250_000);
  assert.equal(slot0Leader.leaderPubkey, jitoLeaderKey);
  assert.equal(slot0Leader.isJitoLeader, true);
  assert.equal(slot0Leader.clusterStakeShareBps, 8000);

  const slot4Leader = tracker.getSlotLeader(250_004);
  assert.equal(slot4Leader.leaderPubkey, agaveLeaderKey);
  assert.equal(slot4Leader.isJitoLeader, false);
  assert.equal(slot4Leader.clusterStakeShareBps, 2000);

  // Chunk calculations
  const chunk0Info = tracker.calculateChunkInfo(250_001);
  assert.equal(chunk0Info.chunkStartSlot, 250_000);
  assert.equal(chunk0Info.chunkEndSlot, 250_003);
  assert.equal(chunk0Info.remainingSlotsInChunk, 2);

  // Lookahead window
  const window = tracker.getUpcomingWindow(250_000, 8);
  assert.equal(window.length, 8);
  assert.equal(window[0].isJitoLeader, true);
  assert.equal(window[4].isJitoLeader, false);

  // Stats verification
  const stats = tracker.getStats();
  assert.equal(stats.currentEpoch, 100);
  assert.equal(stats.cachedSlotCount, 8);
  assert.equal(stats.knownJitoCount, 1);
});

test('SOLARIS DynamicTipAndContentionOracle: Calculates tip percentiles and write-lock contention tiers', () => {
  const oracle = new DynamicTipAndContentionOracle({
    minTipLamports: 10_000n,
    maxTipLamports: 10_000_000n,
    cacheTtlMs: 2500,
  });

  // Default baseline
  const baselineFloor = oracle.getTipFloor();
  assert.equal(baselineFloor.isFresh, false);
  assert.equal(baselineFloor.source, 'FALLBACK_MANDATE');
  assert.equal(baselineFloor.p75Lamports, 60_000n);

  // Recommends tip by urgency
  const stdTip = oracle.getRecommendedTip('STANDARD');
  const breakoutTip = oracle.getRecommendedTip('URGENT_BREAKOUT');
  const exitTip = oracle.getRecommendedTip('EMERGENCY_EXIT');

  assert.equal(stdTip, 60_000n);
  assert.ok(breakoutTip > stdTip);
  assert.equal(exitTip, 250_000n);

  // Update tip floor with live auction data
  oracle.updateTipFloor(50_000n, 100_000n, 250_000n, 1_000_000n, 'LIVE_API');
  const updatedFloor = oracle.getTipFloor();
  assert.equal(updatedFloor.isFresh, true);
  assert.equal(updatedFloor.p75Lamports, 250_000n);
  assert.equal(updatedFloor.p95Lamports, 1_000_000n);
  assert.equal(updatedFloor.source, 'LIVE_API');

  // Account Contention estimation: nominal scenario
  const tokenAccount = 'TokenAccount1111111111111111111111111111111';
  oracle.registerAccountPrioritizationSamples(tokenAccount, [
    10_000n, 25_000n, 30_000n, 40_000n, 50_000n,
  ]);

  const nominalEst = oracle.estimateContention([tokenAccount]);
  assert.equal(nominalEst.isObserved, true);
  assert.equal(nominalEst.contentionTier, 'NOMINAL');

  // High / Critical contention scenario
  const congestedAccount = 'HotPoolAccount2222222222222222222222222222';
  oracle.registerAccountPrioritizationSamples(congestedAccount, [
    500_000n, 1_200_000n, 2_000_000n, 3_500_000n,
  ]);

  const criticalEst = oracle.estimateContention([congestedAccount]);
  assert.equal(criticalEst.contentionTier, 'CRITICAL');
  assert.ok(criticalEst.recommendedMicroLamportsPerCu >= 2_000_000n);
});

test('SOLARIS BimodalExecutionRouter: Plans JITO MEV bundle vs Direct TPU QUIC vs Congestion Abstain', () => {
  const jitoLeaderKey = 'JitoLeaderPubkey111111111111111111111111111';
  const agaveLeaderKey = 'AgaveLeaderPubkey2222222222222222222222222';

  const tracker = new LeaderScheduleTracker([jitoLeaderKey]);
  tracker.loadEpochSchedule(
    100,
    {
      [jitoLeaderKey]: [0, 1, 2, 3],
      [agaveLeaderKey]: [4, 5, 6, 7],
    },
    250_000
  );

  const oracle = new DynamicTipAndContentionOracle();
  oracle.updateTipFloor(10_000n, 25_000n, 60_000n, 250_000n, 'LIVE_API');
  oracle.registerAccountPrioritizationSamples('AccountA', [50_000n, 60_000n, 70_000n]);
  const router = new BimodalExecutionRouter(tracker, oracle);

  // Case 1: Slot 250,000 is a Jito leader -> JITO_BUNDLE
  const planJito = router.planRoute({
    intentId: 'INTENT_001',
    currentSlot: 250_000,
    writeLockedAccounts: ['AccountA'],
    urgency: 'STANDARD',
  });

  assert.equal(planJito.routeType, 'JITO_BUNDLE');
  assert.equal(planJito.targetSlot, 250_000);
  assert.equal(planJito.isJitoLeader, true);
  assert.ok(planJito.recommendedJitoTipLamports > 0n);

  // Case 2: Slot 250,004 is Agave, but Slot 250,005 is also Agave, urgent exit -> DIRECT_TPU_QUIC
  const planUrgentAgave = router.planRoute({
    intentId: 'INTENT_002',
    currentSlot: 250_004,
    writeLockedAccounts: ['AccountA'],
    urgency: 'EMERGENCY_EXIT',
  });

  assert.equal(planUrgentAgave.routeType, 'DIRECT_TPU_QUIC');
  assert.equal(planUrgentAgave.targetSlot, 250_004);
  assert.equal(planUrgentAgave.isJitoLeader, false);
  assert.equal(planUrgentAgave.recommendedJitoTipLamports, 0n);
  assert.ok(planUrgentAgave.recommendedPriorityMicroLamports > 0n);

  // Case 3: Extreme write-lock contention -> ABSTAIN_CONGESTION
  const criticalAccount = 'CriticalLockedAccount';
  oracle.registerAccountPrioritizationSamples(criticalAccount, [
    2_500_000n, 3_000_000n, 4_000_000n,
  ]);

  const planCongested = router.planRoute({
    intentId: 'INTENT_003',
    currentSlot: 250_000,
    writeLockedAccounts: [criticalAccount],
    urgency: 'STANDARD',
  });

  assert.equal(planCongested.routeType, 'ABSTAIN_CONGESTION');
  assert.match(planCongested.rationale, /CRITICAL/);

  // Case 4: Routing stats
  const stats = router.getStats();
  assert.equal(stats.totalRoutesGenerated, 3);
  assert.equal(stats.jitoBundleCount, 1);
  assert.equal(stats.directTpuCount, 1);
  assert.equal(stats.congestionAbstainCount, 1);
});

test('SOLARIS BimodalExecutionRouter: abstains rather than fabricating a leader route', () => {
  const router = new BimodalExecutionRouter(new LeaderScheduleTracker(), new DynamicTipAndContentionOracle());
  const plan = router.planRoute({
    intentId: 'INTENT_NO_SCHEDULE',
    currentSlot: 250_000,
    writeLockedAccounts: [],
  });
  assert.equal(plan.routeType, 'ABSTAIN_LEADER_UNAVAILABLE');
  assert.equal(plan.targetLeaderPubkey, 'UNAVAILABLE');
  assert.equal(plan.computeUnitLimit, 0);
});

test('SOLARIS BimodalExecutionRouter: abstains when fee evidence is not observed', () => {
  const leader = 'KnownLeader111111111111111111111111111111111';
  const tracker = new LeaderScheduleTracker([leader]);
  tracker.loadEpochSchedule(0, { [leader]: [0] }, 250_000);
  const plan = new BimodalExecutionRouter(tracker, new DynamicTipAndContentionOracle()).planRoute({
    intentId: 'INTENT_NO_FEE_EVIDENCE',
    currentSlot: 250_000,
    writeLockedAccounts: ['AccountA'],
  });
  assert.equal(plan.routeType, 'ABSTAIN_FEE_EVIDENCE_UNAVAILABLE');
  assert.equal(plan.recommendedJitoTipLamports, 0n);
  assert.equal(plan.recommendedPriorityMicroLamports, 0n);
});

test('SOLARIS PostGraduationAmmBridge: Enforces 30s sniper dump cooldown while allowing sell exits', () => {
  const bridge = new PostGraduationAmmBridge({
    sniperCooldownMs: 50, // fast 50ms cooldown for deterministic testing
    minRaydiumSolReserves: 5_000_000_000n,
  });

  const mint = 'GraduatedTokenMint1111111111111111111111111';

  // 1. Unregistered token is in BONDING_CURVE mode
  const initialCheck = bridge.canExecuteTrade(mint, 'BUY');
  assert.equal(initialCheck.allowed, true);
  assert.equal(initialCheck.status, 'BONDING_CURVE');

  // 2. Migration triggered -> MIGRATION_PENDING (buys blocked, sells allowed)
  bridge.registerMigration(mint, 250_000, 85_000_000_000n);
  const buyPending = bridge.canExecuteTrade(mint, 'BUY');
  assert.equal(buyPending.allowed, false);
  assert.equal(buyPending.status, 'MIGRATION_PENDING');

  const sellPending = bridge.canExecuteTrade(mint, 'SELL');
  assert.equal(sellPending.allowed, true); // Capital exit always permitted

  // 3. Raydium pool created -> enters SNIPER_COOLDOWN
  bridge.registerRaydiumPool(mint, 'RaydiumPoolAddress123', 85_000_000_000n);
  const buyCooldown = bridge.canExecuteTrade(mint, 'BUY');
  assert.equal(buyCooldown.allowed, false);
  assert.equal(buyCooldown.status, 'SNIPER_COOLDOWN');
  assert.match(buyCooldown.reason, /Sniper stabilization cooldown active/);

  // 4. Wait for cooldown to expire -> RAYDIUM_ACTIVE
  return new Promise((resolve) => {
    setTimeout(() => {
      const buyActive = bridge.canExecuteTrade(mint, 'BUY');
      assert.equal(buyActive.allowed, true);
      assert.equal(buyActive.status, 'RAYDIUM_ACTIVE');

      const state = bridge.getGraduatedState(mint);
      assert.equal(state?.status, 'RAYDIUM_ACTIVE');
      assert.equal(state?.raydiumPoolAddress, 'RaydiumPoolAddress123');

      // 5. If pool reserves drop below safety floor -> buys blocked
      bridge.registerRaydiumPool(mint, 'RaydiumPoolAddress123', 1_000_000_000n); // 1 SOL < 5 SOL floor
      const buyDrained = bridge.canExecuteTrade(mint, 'BUY');
      assert.equal(buyDrained.allowed, false);
      assert.match(buyDrained.reason, /reserves below safety floor/);

      resolve();
    }, 60);
  });
});

test('SOLARIS IngestionGapReconciler: Detects slot gaps, triggers backfill, and resolves circular buffer', async () => {
  const reconciler = new IngestionGapReconciler(100);
  const backfilledGaps = [];

  reconciler.setBackfillHandler(async (gap) => {
    backfilledGaps.push(gap);
    const perSlotStatus = Object.create(null);
    for (let slot = gap.startSlot; slot <= gap.endSlot; slot++) perSlotStatus[slot] = 'EMPTY';
    return Object.freeze({
      certificateId: `fixture-${gap.gapId}`, gapId: gap.gapId,
      startSlot: gap.startSlot, endSlot: gap.endSlot,
      providerId: gap.providerId ?? 'fixture-provider',
      classification: gap.classification ?? 'UNKNOWN', lane: gap.lane ?? 'CHAIN_BLOCK',
      recoveredEventIds: Object.freeze([]), perSlotStatus: Object.freeze(perSlotStatus),
      stateRoot: 'a'.repeat(64), coverageRoot: 'b'.repeat(64),
      isVerified: true, certifiedAtMs: Date.now(),
    });
  });

  // Continuous slots: no gap
  assert.equal(reconciler.registerSlot(250_001), null);
  assert.equal(reconciler.registerSlot(250_002), null);
  assert.equal(reconciler.registerSlot(250_003), null);
  assert.equal(reconciler.hasUnresolvedGaps(), false);

  // Discontinuity: jumps from 250,003 to 250,008 (gap of 4 slots: 250,004 - 250,007)
  const gap = reconciler.registerSlot(250_008);
  assert.ok(gap);
  assert.equal(gap.startSlot, 250_004);
  assert.equal(gap.endSlot, 250_007);
  assert.equal(gap.missingSlotCount, 4);

  // Allow backfill promise tick to resolve
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(backfilledGaps.length, 1);
  assert.equal(backfilledGaps[0].missingSlotCount, 4);

  const report = reconciler.getReport();
  assert.equal(report.gapsDetected, 1);
  assert.equal(report.gapsResolved, 1);
  assert.equal(report.totalSlotsBackfilled, 4);
  assert.equal(report.latestContinuousSlot, 250_008);
});

test('SOLARIS End-to-End System Integration: CommandGateway and ProjectionService telemetry', () => {
  // 1. CommandGateway route planning
  const route = globalCommandGateway.planRoute({
    intentId: 'CMD_TEST_ROUTE',
    currentSlot: 250_000,
    writeLockedAccounts: ['AccountX'],
    urgency: 'STANDARD',
  });

  assert.ok(route);
  assert.equal(route.routeType, 'ABSTAIN_LEADER_UNAVAILABLE');
  assert.ok(route.targetSlot >= 250_000);

  // 2. CommandGateway telemetry snapshot
  const snapshot = globalCommandGateway.getSolarisSnapshot();
  assert.equal(snapshot.currentSlot, 250_000);
  assert.equal(snapshot.leaderScheduleStatus, 'UNAVAILABLE');
  assert.equal(snapshot.activeLeaderPubkey, undefined);
  assert.equal(snapshot.activeLeaderIsJito, undefined);
  assert.equal(snapshot.tipFloor, undefined);
  assert.ok(['NOMINAL', 'ELEVATED', 'HIGH', 'CRITICAL'].includes(snapshot.contentionTier));

  // 3. ProjectionService strip view model
  const strip = globalProjectionService.getSystemStrip();
  // Simulator estimates are not live infrastructure evidence.
  assert.equal(strip.activeLeaderPubkey, undefined);
  assert.equal(strip.isJitoLeader, undefined);
  assert.equal(strip.contentionTier, undefined);
  assert.equal(strip.tipFloorP75, undefined);

  // 4. Market entry validation integration with PostGraduationAmmBridge
  const market = new Market();
  const mockMintKey = { toBase58: () => 'GRAD_TOKEN_X' };
  const completedCurveSnapshot = {
    mint: mockMintKey,
    tokenProgram: mockMintKey,
    supply: 1_000_000_000_000_000n,
    slot: 250_000,
    at: Date.now(),
    entrySafe: true,
    curve: {
      complete: true,
      realQuoteReserves: 85_000_000_000n,
      virtualQuoteReserves: 30_000_000_000n,
      virtualTokenReserves: 1_073_000_000_000_000n,
      isMayhemMode: false,
      isHolderReward: false,
    },
  };

  // Attempting entry on complete curve must trigger migration in the AMM bridge
  assert.throws(() => {
    market.validateEntry(completedCurveSnapshot);
  }, /unsupported curve mode/);

  // Verify that market's AMM bridge registered the migration
  const gradState = market.ammBridge.getGraduatedState('GRAD_TOKEN_X');
  assert.ok(gradState);
  assert.equal(gradState.status, 'MIGRATION_PENDING');
  assert.equal(gradState.migrationTriggeredAtSlot, 250_000);

  // Register Raydium pool and verify sniper cooldown gating
  market.ammBridge.registerRaydiumPool('GRAD_TOKEN_X', 'RAY_POOL_X', 85_000_000_000n);
  const tradeCheck = market.ammBridge.canExecuteTrade('GRAD_TOKEN_X', 'BUY');
  assert.equal(tradeCheck.allowed, false);
  assert.equal(tradeCheck.status, 'SNIPER_COOLDOWN');
  assert.match(tradeCheck.reason, /Sniper stabilization cooldown active/);
});
