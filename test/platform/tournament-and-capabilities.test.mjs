import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CapabilityRegistry,
  MainnetRealityTournament,
} from '../../dist/platform/pipeline/index.js';

test('CAPABILITY REGISTRY: all Prompts 47-51 extension capabilities are registered with strict boundaries', () => {
  const registry = new CapabilityRegistry();
  const allCaps = registry.allCapabilities();

  assert.ok(allCaps.length >= 10, 'Expected at least 10 default capabilities');

  const requiredIds = [
    'solana-bank-state-fingerprint',
    'token-2022-semantics-inspector',
    'leader-relative-execution-clock',
    'local-auction-mapper',
    'priority-fee-jito-tip-optimizer',
    'cross-transport-same-intent-ledger',
    'preflight-divergence-detector',
    'real-slippage-observatory',
    'capital-time-accounting',
    'transfer-hook-dependency-graph',
    'cpi-semantic-firewall',
    'economic-workload-deduplicator',
    'mainnet-reality-tournament-engine',
  ];

  for (const id of requiredIds) {
    const cap = registry.getCapability(id);
    assert.ok(cap, `Capability '${id}' must be registered`);
    assert.ok(cap.inputs.length > 0, `Capability '${id}' must declare inputs`);
    assert.ok(cap.outputs.length > 0, `Capability '${id}' must declare outputs`);
    assert.ok(cap.dependencies.length > 0, `Capability '${id}' must declare dependencies`);
    assert.ok(cap.failureMode.length > 0, `Capability '${id}' must declare failure mode`);

    // Invariant: no experimental capability may claim execution authority
    assert.notEqual(cap.authority, 'AUTHORIZE');
    assert.notEqual(cap.authority, 'SIGN');
    assert.notEqual(cap.authority, 'SETTLE');
  }
});

test('TOURNAMENT: benchmarks competing RPC providers against ground-truth outcomes', () => {
  const tournament = new MainnetRealityTournament();

  // Record ground truths across 3 slots
  tournament.recordGroundTruth({
    slot: 1000n,
    finalizedAt: '2026-10-03T20:00:00.400Z',
    groundTruthValue: { balance: 1000000000n },
    landed: true,
  });
  tournament.recordGroundTruth({
    slot: 1001n,
    finalizedAt: '2026-10-03T20:00:00.800Z',
    groundTruthValue: { balance: 1050000000n },
    landed: true,
  });
  tournament.recordGroundTruth({
    slot: 1002n,
    finalizedAt: '2026-10-03T20:00:01.200Z',
    groundTruthValue: { balance: 1050000000n },
    landed: false,
  });

  // RPC 1: Fast, 100% coverage, 0 disagreements
  tournament.recordObservation({
    competitorId: 'rpc-helius-direct',
    kind: 'RPC_PROVIDER',
    slot: 1000n,
    observedAt: '2026-10-03T20:00:00.420Z',
    latencyMs: 20,
    reportedValue: { balance: 1000000000n },
  });
  tournament.recordObservation({
    competitorId: 'rpc-helius-direct',
    kind: 'RPC_PROVIDER',
    slot: 1001n,
    observedAt: '2026-10-03T20:00:00.825Z',
    latencyMs: 25,
    reportedValue: { balance: 1050000000n },
  });
  tournament.recordObservation({
    competitorId: 'rpc-helius-direct',
    kind: 'RPC_PROVIDER',
    slot: 1002n,
    observedAt: '2026-10-03T20:00:01.222Z',
    latencyMs: 22,
    reportedValue: { balance: 1050000000n },
  });

  // RPC 2: Slower, missed slot 1002, 1 semantic disagreement on slot 1001
  tournament.recordObservation({
    competitorId: 'rpc-generic-fallback',
    kind: 'RPC_PROVIDER',
    slot: 1000n,
    observedAt: '2026-10-03T20:00:00.520Z',
    latencyMs: 120,
    reportedValue: { balance: 1000000000n },
  });
  tournament.recordObservation({
    competitorId: 'rpc-generic-fallback',
    kind: 'RPC_PROVIDER',
    slot: 1001n,
    observedAt: '2026-10-03T20:00:00.950Z',
    latencyMs: 150,
    reportedValue: { balance: 999999999n }, // Disagreement
  });

  const report = tournament.evaluateTournament(
    'tourn_rpc_001',
    'RPC_PROVIDER',
    '2026-10-03T20:01:00.000Z'
  );

  assert.equal(report.winnerCompetitorId, 'rpc-helius-direct');
  assert.equal(report.competitorCount, 2);
  assert.equal(report.scorecards[0].competitorId, 'rpc-helius-direct');
  assert.equal(report.scorecards[0].rank, 1);
  assert.equal(report.scorecards[0].coveragePct, 100);
  assert.equal(report.scorecards[0].disagreementCount, 0);

  assert.equal(report.scorecards[1].competitorId, 'rpc-generic-fallback');
  assert.equal(report.scorecards[1].rank, 2);
  assert.ok(report.scorecards[1].coveragePct < 100);
  assert.equal(report.scorecards[1].disagreementCount, 1);
  assert.ok(report.scorecards[0].compositeScore > report.scorecards[1].compositeScore);
  assert.equal(typeof report.reportHash, 'string');
  assert.equal(report.reportHash.length, 64);
});

test('TOURNAMENT: evaluates landing prediction models and computes exact Brier calibration score', () => {
  const tournament = new MainnetRealityTournament();

  tournament.recordGroundTruth({
    slot: 2000n,
    finalizedAt: '2026-10-03T20:00:00.400Z',
    groundTruthValue: {},
    landed: true,
  });
  tournament.recordGroundTruth({
    slot: 2001n,
    finalizedAt: '2026-10-03T20:00:00.800Z',
    groundTruthValue: {},
    landed: false,
  });

  // Well-calibrated model: predicted 0.9 for landed, 0.1 for failed
  tournament.recordObservation({
    competitorId: 'landing-model-calibrated',
    kind: 'LANDING_MODEL',
    slot: 2000n,
    observedAt: '2026-10-03T20:00:00.000Z',
    latencyMs: 5,
    reportedValue: {},
    predictedProbability: 0.9,
  });
  tournament.recordObservation({
    competitorId: 'landing-model-calibrated',
    kind: 'LANDING_MODEL',
    slot: 2001n,
    observedAt: '2026-10-03T20:00:00.000Z',
    latencyMs: 5,
    reportedValue: {},
    predictedProbability: 0.1,
  });

  // Poorly-calibrated model: predicted 0.2 for landed, 0.8 for failed
  tournament.recordObservation({
    competitorId: 'landing-model-uncalibrated',
    kind: 'LANDING_MODEL',
    slot: 2000n,
    observedAt: '2026-10-03T20:00:00.000Z',
    latencyMs: 5,
    reportedValue: {},
    predictedProbability: 0.2,
  });
  tournament.recordObservation({
    competitorId: 'landing-model-uncalibrated',
    kind: 'LANDING_MODEL',
    slot: 2001n,
    observedAt: '2026-10-03T20:00:00.000Z',
    latencyMs: 5,
    reportedValue: {},
    predictedProbability: 0.8,
  });

  const report = tournament.evaluateTournament(
    'tourn_landing_001',
    'LANDING_MODEL',
    '2026-10-03T20:01:00.000Z'
  );

  assert.equal(report.winnerCompetitorId, 'landing-model-calibrated');
  const winnerCard = report.scorecards[0];
  const loserCard = report.scorecards[1];

  // Brier score: lower is better!
  // Calibrated: ((0.9-1)^2 + (0.1-0)^2)/2 = (0.01 + 0.01)/2 = 0.01
  // Uncalibrated: ((0.2-1)^2 + (0.8-0)^2)/2 = (0.64 + 0.64)/2 = 0.64
  assert.ok(winnerCard.brierScore !== undefined && loserCard.brierScore !== undefined);
  assert.ok(winnerCard.brierScore < loserCard.brierScore);
  assert.equal(winnerCard.brierScore, 0.01);
  assert.equal(loserCard.brierScore, 0.64);
});

test('GOVERNANCE: tournament winner cannot claim execution authority', () => {
  const registry = new CapabilityRegistry();

  assert.throws(() => {
    registry.registerCapability({
      id: 'winning-rpc-unauthorized',
      name: 'Winning RPC Provider',
      version: '1.0.0',
      category: 'TransportCandidate',
      stage: 'RESEARCH',
      authority: 'AUTHORIZE', // PROHIBITED
      inputs: [],
      outputs: [],
      dependencies: [],
      failureMode: 'NONE',
    });
  }, /GOVERNANCE_VIOLATION/);
});
