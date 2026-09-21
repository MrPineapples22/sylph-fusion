import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IncidentFlightRecorder,
} from '../../dist/platform/recovery/flight-recorder.js';

import {
  WalletRelationshipGraph,
} from '../../dist/platform/security/wallet-graph.js';

import {
  SystemicMarketSafetyEngine,
} from '../../dist/platform/sentinel/market-safety.js';

import {
  AIRiskSentinel,
} from '../../dist/platform/sentinel/risk-sentinel.js';

test('IncidentFlightRecorder: Captures, contains, diagnoses, and resolves incidents', () => {
  const recorder = new IncidentFlightRecorder();

  const incident = recorder.captureIncident(
    'RPC_DROPPED_TRANSACTION',
    'P1_HIGH',
    'RPC endpoint dropped broadcast transaction during surge',
    {
      vaultId: 'vault_123',
      strategyId: 'strat_alpha',
      marketState: { solPrice: 185 },
      riskState: { exposure: 0.15 },
      ledgerStateHash: 'hash_abc_123',
      stackTrace: 'Error: timeout at sendRawTransaction',
    }
  );

  assert.equal(incident.status, 'DETECTED');
  assert.equal(incident.lossType, 'RPC_DROPPED_TRANSACTION');
  assert.equal(incident.severity, 'P1_HIGH');

  // Contain
  recorder.containIncident(incident.incidentId);
  const contained = recorder.getIncident(incident.incidentId);
  assert.equal(contained?.status, 'CONTAINED');
  assert.ok(contained?.containedAt);

  // Diagnose
  recorder.diagnoseIncident(incident.incidentId);
  const diagnosed = recorder.getIncident(incident.incidentId);
  assert.equal(diagnosed?.status, 'DIAGNOSED');

  // Resolve
  recorder.resolveIncident(incident.incidentId);
  const resolved = recorder.getIncident(incident.incidentId);
  assert.equal(resolved?.status, 'RESOLVED');
  assert.ok(resolved?.resolvedAt);

  const all = recorder.getAllIncidents();
  assert.equal(all.length, 1);
});

test('WalletRelationshipGraph: Tracks creators, funders, buyers, and flags serial cluster risks', () => {
  const graph = new WalletRelationshipGraph();
  const creator = 'CreatorKey11111111111111111111111111111111';
  const funder = 'FunderKey111111111111111111111111111111111';
  const mint1 = 'MintOne111111111111111111111111111111111111';

  graph.registerToken(mint1, creator, funder);
  graph.recordBuyer(mint1, 'BuyerA111111111111111111111111111111111111');
  graph.recordBuyer(mint1, 'BuyerB111111111111111111111111111111111111');

  // Assess clean cluster risk
  const clusterClean = graph.assessClusterRisk(mint1, creator);
  assert.equal(clusterClean.historicalIncidentCount, 0);

  // Record an incident on the funder and re-assess
  graph.recordIncident(funder);
  const clusterWithIncident = graph.assessClusterRisk(mint1, creator);
  assert.equal(clusterWithIncident.historicalIncidentCount, 1);
  assert.ok(clusterWithIncident.suspiciousConnectionScore >= 50);
});

test('SystemicMarketSafetyEngine: Transitions states and scales risk factors', () => {
  const engine = new SystemicMarketSafetyEngine();
  assert.equal(engine.getState(), 'GREEN');
  assert.equal(engine.getGlobalRiskScaleFactor(), 1.0);

  // Evaluate under degraded conditions (RPC errors exceed yellow threshold)
  const yellowState = engine.evaluate({
    rpcFailureRateBps: 400, // 4% errors > 300 bps yellow
    dexLiquidityDropBps: 500,
    recentRugCount: 0,
    reconciliationClean: true,
  });

  assert.equal(yellowState, 'YELLOW');
  assert.equal(engine.getGlobalRiskScaleFactor(), 0.8);

  // Catastrophic failure: Unclean reconciliation immediately triggers RED
  const redState = engine.evaluate({
    rpcFailureRateBps: 50,
    dexLiquidityDropBps: 100,
    recentRugCount: 0,
    reconciliationClean: false, // Unclean reconciliation
  });

  assert.equal(redState, 'RED');
  assert.equal(engine.getGlobalRiskScaleFactor(), 0.0);
});

test('AIRiskSentinel: Analyzes trade telemetry anomalies and flags behavior drift', () => {
  const sentinel = new AIRiskSentinel();
  const strategyId = 'strat_momentum';

  sentinel.registerStrategyProfile({
    strategyId,
    baselineAvgSlippageBps: 100,
    maxObservedTradeBurstPerMin: 3,
    targetHoldingDurationSec: 30,
    maxFailureStreakAllowed: 2,
  });

  const now = Date.now();

  // Record 4 trades within 60s (exceeding burst limit of 3)
  for (let i = 0; i < 4; i++) {
    sentinel.recordTradeTelemetry({
      timestamp: now - (i * 1000),
      strategyId,
      vaultId: 'v1',
      latencyMs: 150,
      slippageBps: 120,
      holdingDurationSec: 35,
      isSuccess: true,
    });
  }

  const findings = sentinel.analyzeAnomalies(now);
  assert.ok(findings.length > 0);
  assert.ok(findings.some(f => f.type === 'BURST_TRADING'));
});
