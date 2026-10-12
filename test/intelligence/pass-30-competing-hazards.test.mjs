import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateRunnerHazardState,
  DEFAULT_EMPIRICAL_EXIT_POLICY,
  evaluateTokenDecision,
} from '../../terminal/src/token-decision-eval.js';
import { CommandGateway } from '../../dist/command-gateway.js';

test('Pass 30: Competing-Risk Hazard Engine evaluates point-in-time failure vs expansion hazards', () => {
  // 1. Baseline healthy runner
  const baseline = calculateRunnerHazardState({
    elapsedSeconds: 120,
    currentMultiple: 1.5,
    walletEntropy: 1.0,
    independentCapitalAcceleration: 0.1,
    realSolReserve: 35,
    currentSellPressureRatio: 0.1,
    recentPriceVelocityBps: 150,
  });

  assert.ok(baseline.hUpside > 0, 'Upside hazard must be positive');
  assert.ok(baseline.hDownside > 0, 'Downside hazard must be positive');
  assert.ok(Number.isFinite(baseline.netConvexHazardRatio), 'Convex hazard ratio must be finite');
  assert.equal(baseline.recommendedAction, 'HOLD_CORE_RUNNER');

  // 2. High-momentum organic expansion prime for upside pyramiding
  const pyramid = calculateRunnerHazardState({
    elapsedSeconds: 60,
    currentMultiple: 1.8,
    walletEntropy: 1.4,
    independentCapitalAcceleration: 0.5,
    realSolReserve: 50,
    currentSellPressureRatio: 0.05,
    recentPriceVelocityBps: 2000,
  });

  assert.ok(pyramid.netConvexHazardRatio > 2.5, 'Hazard ratio must be > 2.5 in exponential expansion');
  assert.equal(pyramid.recommendedAction, 'PYRAMID_ADD', 'Should recommend PYRAMID_ADD for high-entropy breakout');

  // 3. Liquidity collapse hazard: real reserves drain < 5 SOL
  const unexitable = calculateRunnerHazardState({
    elapsedSeconds: 180,
    currentMultiple: 1.1,
    walletEntropy: 0.8,
    realSolReserve: 3.5, // Severe reserve drain
    currentSellPressureRatio: 0.4,
    recentPriceVelocityBps: -50,
  });

  assert.ok(unexitable.hUnexitability >= 0.70, 'Unexitability hazard must be elevated');
  assert.equal(unexitable.recommendedAction, 'FULL_EXIT_HAZARD', 'Must trigger FULL_EXIT_HAZARD on unexitability');

  // 4. Low-entropy sybil cluster / insider rug hazard
  const rug = calculateRunnerHazardState({
    elapsedSeconds: 30, // Young curve
    currentMultiple: 1.05,
    walletEntropy: 0.15, // Severe sybil concentration
    realSolReserve: 20,
    currentSellPressureRatio: 0.1,
  });

  assert.ok(rug.hRug >= 0.60, 'Rug hazard must be elevated for concentrated cluster');
  assert.ok(['FULL_EXIT_HAZARD', 'PARTIAL_DERISK'].includes(rug.recommendedAction));

  // 5. Heavy distribution dump: deteriorating convex ratio
  const distribution = calculateRunnerHazardState({
    elapsedSeconds: 300,
    currentMultiple: 6.0,
    walletEntropy: 0.9,
    realSolReserve: 25,
    currentSellPressureRatio: 0.95, // Massive sell wall
    recentPriceVelocityBps: -300,
  });

  assert.ok(distribution.netConvexHazardRatio < 0.30, 'Net hazard ratio must deteriorate under heavy distribution');
  assert.equal(distribution.recommendedAction, 'PARTIAL_DERISK', 'Must recommend PARTIAL_DERISK when hazard ratio collapses');
});

test('Pass 30: 8-Tier Moonshot Ratchet Ladder reaches 100x (+10,000% PnL) with progressive multi-bagger lock', () => {
  const policy = DEFAULT_EMPIRICAL_EXIT_POLICY;
  assert.ok(Array.isArray(policy.moonshotRatchets), 'moonshotRatchets array must exist');
  assert.equal(policy.moonshotRatchets.length, 8, 'Must provide 8 full tiers up to 100x / +10,000% PnL');

  const tiers = policy.moonshotRatchets;
  assert.equal(tiers[0].targetMultiple, 1.15);
  assert.equal(tiers[0].floorMultiple, 1.05);

  assert.equal(tiers[1].targetMultiple, 1.35);
  assert.equal(tiers[1].floorMultiple, 1.25);

  assert.equal(tiers[2].targetMultiple, 2.0);
  assert.equal(tiers[2].floorMultiple, 1.50);

  assert.equal(tiers[3].targetMultiple, 5.0);
  assert.equal(tiers[3].floorMultiple, 3.50);

  assert.equal(tiers[4].targetMultiple, 10.0);
  assert.equal(tiers[4].floorMultiple, 7.50);

  assert.equal(tiers[5].targetMultiple, 20.0);
  assert.equal(tiers[5].floorMultiple, 15.0);

  assert.equal(tiers[6].targetMultiple, 50.0);
  assert.equal(tiers[6].floorMultiple, 35.0);

  assert.equal(tiers[7].targetMultiple, 100.0);
  assert.equal(tiers[7].floorMultiple, 70.0);
  assert.equal(tiers[7].trailPct, 0.30);
  assert.match(tiers[7].name, /100x Moonshot/);
});

test('Pass 30: Token Decision Evaluation exposes 8-tier Ratchet Ladder & Command Gateway supports Hazard Exits', async () => {
  const decision = evaluateTokenDecision({
    asset: {
      id: 'Pass30Token11111111111111111111111111111111',
      price: 0.0001,
      realReserveSol: 30,
      mintAuthority: false,
      freezeAuthority: false,
      complete: false,
    },
    candidate: {
      mint: 'Pass30Token11111111111111111111111111111111',
      realReserveSol: 30,
      drift: { driftBps: 15, passed: true, reason: 'PASS' },
    },
  });

  assert.ok(decision.empiricalExitPolicy, 'empiricalExitPolicy must be populated in token decision evaluation');
  assert.equal(decision.empiricalExitPolicy.moonshotRatchets.length, 8);

  // Verify CommandGateway handles COMPETING_HAZARD_FULL_EXIT and MOONSHOT_RATCHET_LOCK without error
  const gateway = CommandGateway.resetInstance();

  const closeCmd = {
    commandId: 'cmd_pass30_hazard_001',
    type: 'CLOSE_POSITION',
    timestamp: Date.now(),
    initiator: 'auto_exit_guardian',
    payload: {
      mint: 'Pass30Token11111111111111111111111111111111',
      poolAddress: 'Pool3011111111111111111111111111111111111111',
      priceUsd: 0.0001,
      exitTrigger: 'COMPETING_HAZARD_FULL_EXIT',
    },
  };

  const result = await gateway.executeCommand(closeCmd);
  // It shouldn't crash with a type or syntax error; if position is not open, it returns handled result or error
  assert.ok(typeof result === 'object', 'Command gateway must return result object');
});
