import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AccountContentionGraph,
  SchedulerCostEstimator,
  ExecutionPathTournamentV2,
} from '../../dist/platform/execution/account-topology.js';

test('AccountContentionGraph: maps writable locks and detects gravity wells', () => {
  const accounts = [
    { pubkey: 'UserWallet11111111111111111111111111111111', isWritable: true, isSigner: true },
    { pubkey: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', isWritable: false, isSigner: false }, // Pump program (readonly)
    { pubkey: 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', isWritable: true, isSigner: false },  // Pump fee account (gravity well)
    { pubkey: 'CandidateBondingCurveAccount11111111111111', isWritable: true, isSigner: false, estimatedContentionTier: 'HIGH' },
  ];

  const topology = AccountContentionGraph.analyzeTopology(accounts);

  assert.equal(topology.totalAccounts, 4);
  assert.equal(topology.writableAccountCount, 3);
  assert.equal(topology.readonlyAccountCount, 1);
  assert.ok(topology.contentionGravityScore > 5.0);
  assert.equal(topology.gravityWells.length, 1);
  assert.match(topology.gravityWells[0], /PUMP_FUN_FEE_ACCOUNT/);
  assert.ok(topology.lockDragMultiplier > 1.5);
});

test('SchedulerCostEstimator: identifies aerodynamic transactions vs high-drag padded transactions', () => {
  const leanTopology = AccountContentionGraph.analyzeTopology([
    { pubkey: 'User11111111111111111111111111111111111111', isWritable: true, isSigner: true },
    { pubkey: 'Pool11111111111111111111111111111111111111', isWritable: true, isSigner: false },
  ]);

  const leanCost = SchedulerCostEstimator.estimateCost(45_000, 40_000, leanTopology);
  assert.equal(leanCost.isAerodynamic, true);
  assert.ok(leanCost.landingDragScore < 0.45);
  assert.equal(leanCost.cuPaddingRatio, 1.13);

  const paddedTopology = AccountContentionGraph.analyzeTopology([
    { pubkey: 'User11111111111111111111111111111111111111', isWritable: true, isSigner: true },
    { pubkey: 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', isWritable: true, isSigner: false }, // Gravity well
    ...Array(12).fill(0).map((_, i) => ({ pubkey: `WritableAccount${i}11111111111111111111111111`, isWritable: true, isSigner: false })),
  ]);

  const heavyCost = SchedulerCostEstimator.estimateCost(400_000, 50_000, paddedTopology); // 8x padding!
  assert.equal(heavyCost.isAerodynamic, false);
  assert.ok(heavyCost.cuPaddingRatio >= 2.5);
  assert.ok(heavyCost.recommendations.some(r => r.includes('Excessive CU padding')));
  assert.ok(heavyCost.schedulerCostScore > leanCost.schedulerCostScore * 5);
});

test('ExecutionPathTournamentV2: crowns optimal path balancing net output and scheduler drag', () => {
  const directPath = {
    pathId: 'path_direct_pump',
    venue: 'PUMP_DIRECT',
    expectedOutputLamports: 10_000_000n,
    priorityFeeLamports: 50_000n,
    jitoTipLamports: 100_000n,
    accounts: [
      { pubkey: 'User11111111111111111111111111111111111111', isWritable: true, isSigner: true },
      { pubkey: 'Curve1111111111111111111111111111111111111', isWritable: true, isSigner: false },
    ],
    requestedComputeUnits: 50_000,
    estimatedActualCu: 42_000,
    historicalLandingRate: 0.94,
  };

  const complexRouterPath = {
    pathId: 'path_jupiter_multihop',
    venue: 'JUPITER_ROUTER_V2',
    expectedOutputLamports: 10_050_000n, // +0.5% more output, but 4x the locks and CU!
    priorityFeeLamports: 100_000n,
    jitoTipLamports: 100_000n,
    accounts: [
      { pubkey: 'User11111111111111111111111111111111111111', isWritable: true, isSigner: true },
      { pubkey: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', isWritable: false, isSigner: false },
      { pubkey: 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', isWritable: true, isSigner: false },
      ...Array(8).fill(0).map((_, i) => ({ pubkey: `HopAccount${i}11111111111111111111111111111`, isWritable: true, isSigner: false })),
    ],
    requestedComputeUnits: 300_000,
    estimatedActualCu: 180_000,
    historicalLandingRate: 0.72,
  };

  const result = ExecutionPathTournamentV2.conductTournament([directPath, complexRouterPath]);

  assert.equal(result.totalCandidates, 2);
  assert.equal(result.winner.pathId, 'path_direct_pump');
  assert.equal(result.winner.isWinner, true);
  assert.ok(result.winner.aerodynamicsScore > result.rankings[1].aerodynamicsScore);
  assert.match(result.rationale, /Winner: PUMP_DIRECT/);
});
