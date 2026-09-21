import test from 'node:test';
import assert from 'node:assert/strict';

import { ThreeClocks } from '../../dist/intelligence/truth/three-clocks.js';
import { ContextSnapshotEngine } from '../../dist/intelligence/context/context-snapshot.js';
import { ContextGate } from '../../dist/intelligence/context/context-gate.js';
import { LatencyTraceEngine, ExecutionRaceGuard } from '../../dist/intelligence/execution/latency-trace.js';

test('ThreeClocks maintains distinct Chain, Market, and Execution clocks', () => {
  const clocks = new ThreeClocks();
  clocks.updateChainSlot(250_000, 'confirmed');

  const now = Date.now();
  const snapshot = clocks.captureSnapshot(now - 150, now);

  assert.equal(snapshot.chainClock.commitment, 'confirmed');
  assert.ok(snapshot.chainClock.currentSlot >= 250_000);
  assert.equal(snapshot.marketClock.feedAgeMs, 150);
  assert.ok(snapshot.executionClock.monotonicTimeNs > 0n);
  assert.ok(typeof snapshot.clockSkewMs === 'number');
});

test('ContextSnapshotEngine captures multi-layer macro context and derives contextual scores', () => {
  const engine = new ContextSnapshotEngine();

  // 1. Normal Macro Conditions
  const normalSnap = engine.captureSnapshot({
    slot: 250_100,
    solPriceUsd: 150,
    solReturn1hPct: 0.5,
    solReturn24hPct: 2.0,
    solVolatilityPct: 3.5,
    slotLag: 2,
    avgPriorityFee: 5_000,
    rpcHealthyCount: 3,
    medianTipLamports: 10_000,
    landingRate: 0.95,
    launchesPerMin: 5,
    activeTokens: 120,
    runnerRate: 15,
  });

  assert.equal(normalSnap.solState.isShockActive, false);
  assert.equal(normalSnap.networkState.congestionLevel, 'NORMAL');
  assert.equal(normalSnap.memeBreadth.breadthState, 'ACTIVE');

  const scoresNormal = engine.computeContextualScores(30, 80, normalSnap);
  assert.equal(scoresNormal.contextualHsi, 30);
  assert.equal(scoresNormal.contextualPumpScore, 80);

  // 2. Shock / Degraded Conditions
  const shockSnap = engine.captureSnapshot({
    slot: 250_200,
    solPriceUsd: 140,
    solReturn1hPct: -4.5, // Sharp drop > 3%
    solReturn24hPct: -6.0,
    solVolatilityPct: 15.0,
    slotLag: 30, // Lag > 25
    avgPriorityFee: 200_000,
    rpcHealthyCount: 0, // 0 healthy RPCs -> DEGRADED
    medianTipLamports: 50_000,
    landingRate: 0.40,
    launchesPerMin: 20, // SATURATED
    activeTokens: 300,
    runnerRate: 2,
  });

  assert.equal(shockSnap.solState.isShockActive, true);
  assert.equal(shockSnap.networkState.congestionLevel, 'DEGRADED');
  assert.equal(shockSnap.memeBreadth.breadthState, 'SATURATED');

  const scoresShock = engine.computeContextualScores(30, 80, shockSnap);
  assert.ok(scoresShock.contextualHsi > 30, 'Suspicion must increase in macro shock');
  assert.ok(scoresShock.contextualPumpScore < 80, 'Momentum confidence must decrease in macro shock');
});

test('ContextGate authorizes clean executions and blocks stale quotes or degraded states', () => {
  const engine = new ContextSnapshotEngine();
  const normalSnap = engine.captureSnapshot({
    slot: 250_100,
    solPriceUsd: 150,
    solReturn1hPct: 0.5,
    solReturn24hPct: 2.0,
    solVolatilityPct: 3.5,
    slotLag: 2,
    avgPriorityFee: 5_000,
    rpcHealthyCount: 3,
    medianTipLamports: 10_000,
    landingRate: 0.95,
    launchesPerMin: 5,
    activeTokens: 120,
    runnerRate: 15,
  });

  // 1. All clean -> AUTHORIZE
  const cleanAuth = ContextGate.authorize({
    snapshot: normalSnap,
    quoteAgeMs: 400,
    isRouteValid: true,
    poolLiquiditySol: 25.0,
    isKillSwitchActive: false,
    isRiskAuthorized: true,
    slippageToleranceBps: 150,
  });
  assert.equal(cleanAuth.decision, 'AUTHORIZE');
  assert.equal(cleanAuth.isPermittedToSign, true);

  // 2. Stale quote (1500ms > 1200ms) -> REQUOTE
  const staleAuth = ContextGate.authorize({
    snapshot: normalSnap,
    quoteAgeMs: 1500,
    isRouteValid: true,
    poolLiquiditySol: 25.0,
    isKillSwitchActive: false,
    isRiskAuthorized: true,
    slippageToleranceBps: 150,
  });
  assert.equal(staleAuth.decision, 'REQUOTE');
  assert.equal(staleAuth.isPermittedToSign, false);

  // 3. Emergency Kill Switch -> SAFE_MODE
  const killAuth = ContextGate.authorize({
    snapshot: normalSnap,
    quoteAgeMs: 300,
    isRouteValid: true,
    poolLiquiditySol: 25.0,
    isKillSwitchActive: true,
    isRiskAuthorized: true,
    slippageToleranceBps: 150,
  });
  assert.equal(killAuth.decision, 'SAFE_MODE');
  assert.equal(killAuth.isPermittedToSign, false);
});

test('LatencyTraceEngine and ExecutionRaceGuard prevent race conditions and calculate signal decay', () => {
  const latencyEngine = new LatencyTraceEngine();
  const raceGuard = new ExecutionRaceGuard();

  // 1. Latency Breakdown
  const now = Date.now();
  const breakdown = latencyEngine.calculateLatencyBreakdown({
    chainObservedMs: now - 300,
    localReceivedMs: now - 200,
    decisionFinishedMs: now - 120,
    quoteReceivedMs: now - 50,
    txSubmittedMs: now,
  });
  assert.equal(breakdown.signalAgeAtSubmissionMs, 300);
  assert.equal(breakdown.totalPipelineLatencyMs, 200);

  // 2. Signal Decay via half life
  // Flow half life = 2.5s (2500ms)
  const halfDecay = latencyEngine.calculateSignalDecay('FLOW', 2500, 1.0);
  assert.ok(Math.abs(halfDecay - 0.5) < 0.01, 'Signal must decay to ~0.5 after one half-life');

  // 3. Execution Race Guard
  const mint = 'TestMint1111111111111111111111111111111111111';
  const gen1 = raceGuard.allocateGeneration(mint);
  assert.equal(raceGuard.isGenerationValid(mint, gen1), true);

  // User cancels or updates order -> generation increments
  const gen2 = raceGuard.cancelInFlightOrders(mint);
  assert.notEqual(gen1, gen2);
  assert.equal(raceGuard.isGenerationValid(mint, gen1), false, 'Superseded generation must be invalid');
  assert.equal(raceGuard.isGenerationValid(mint, gen2), true);
});
