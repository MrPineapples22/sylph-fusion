import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 32: Master Intelligence Orchestrator Bellman Dynamic Stopping Evaluation', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const posHealthy = {
    positionId: 'pos_healthy_001',
    mint: 'HealthyRunnerToken11111111111111111111111',
    poolAddress: 'pool_healthy_001',
    entryPriceUsd: 0.001,
    currentMarkPriceUsd: 0.0035, // 3.5x
    currentMultiple: 3.5,
    totalInitialTokens: 10_000,
    remainingTokens: 10_000,
    principalInvestedUsd: 10.0,
    entryFeesPaidUsd: 0.1,
    realizedProceedsUsd: 0,
    entrySlot: 100_000n,
    entryTimestampMs: 3_000_000,
    runnerState: 'RUNNER_CANDIDATE',
  };

  const researchHealthy = {
    qUp: 0.30, // Strong forward runner committor (30%)
    qFail: 0.05, // Negligible failure committor (5%)
    dtfScore: 0.10,
    sellPressureRatio: 0.15,
    capitalRenewalScore: 0.85,
    exitReachability: 0.80,
    creatorDumpRisk: false,
    authenticityIntact: true,
    isEmergencyStopTriggered: false,
  };

  const currentMarkUsd = posHealthy.remainingTokens * posHealthy.currentMarkPriceUsd; // $35.00
  const liquidationHealthy = {
    currentMarkUsd,
    base: {
      scenarioName: 'BASE',
      points: [
        { percentage: 50, tokensSold: 5000, netProceedsUsd: 17.0, effectivePriceUsd: 0.0034, impactBps: 200, feeUsd: 0.1 },
        { percentage: 100, tokensSold: 10000, netProceedsUsd: 33.5, effectivePriceUsd: 0.00335, impactBps: 450, feeUsd: 0.2 },
      ],
      maxCapacityUsd: 33.5,
    },
    stressed25: { scenarioName: 'STRESSED_25', points: [], maxCapacityUsd: 30.0 },
    stressed50: { scenarioName: 'STRESSED_50', points: [], maxCapacityUsd: 25.0 },
    stressedExitCapacityUsd: 32.0,
    liquidityHaircutUsd: 3.0,
    ownImpactUsd: 1.5,
    projectedFeesUsd: 0.2,
    computedAtMs: 3_060_000,
    slot: 100_150n,
    surfaceDigest: 'digest_healthy_001',
  };

  // 1. Evaluate Bellman stopping on healthy runner
  const stoppingHealthy = engine.evaluateBellmanOptimalStopping({
    pos: posHealthy,
    research: researchHealthy,
    liquidation: liquidationHealthy,
  });

  assert.equal(stoppingHealthy.optimalAction, 'CONTINUE', 'Healthy runner must have optimal action CONTINUE');
  assert.ok(stoppingHealthy.continuationValueUsd > stoppingHealthy.immediateLiquidationValueUsd, 'Continuation value must dominate liquidation');
  assert.ok(stoppingHealthy.netContinuationAdvantageUsd > 0, 'Net continuation advantage must be positive');

  // 2. Evaluate Bellman stopping on collapsing runner (high qFail)
  const researchCollapsing = {
    ...researchHealthy,
    qUp: 0.01,
    qFail: 0.75, // Critical failure committor
    dtfScore: 0.80,
  };

  const stoppingCollapsing = engine.evaluateBellmanOptimalStopping({
    pos: posHealthy,
    research: researchCollapsing,
    liquidation: liquidationHealthy,
  });

  assert.equal(stoppingCollapsing.optimalAction, 'LIQUIDATE', 'Collapsing runner must have optimal action LIQUIDATE');
  assert.ok(stoppingCollapsing.netContinuationAdvantageUsd < 0, 'Continuation deficit must be negative');
});

test('Pass 32: Counterfactual Shadow Exit Tournament & Hash Chaining', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const pos = {
    positionId: 'pos_tournament_001',
    mint: 'TournamentToken11111111111111111111111111',
    poolAddress: 'pool_tournament_001',
    entryPriceUsd: 0.002,
    currentMarkPriceUsd: 0.0042, // 2.1x
    currentMultiple: 2.1,
    totalInitialTokens: 5_000,
    remainingTokens: 5_000,
    principalInvestedUsd: 10.0,
    entryFeesPaidUsd: 0.1,
    realizedProceedsUsd: 0,
    entrySlot: 200_000n,
    entryTimestampMs: 4_000_000,
    runnerState: 'RUNNER_CANDIDATE',
  };

  const research = {
    qUp: 0.06,
    qFail: 0.22,
    dtfScore: 0.20,
    sellPressureRatio: 0.25,
    capitalRenewalScore: 0.75,
    exitReachability: 0.70,
    creatorDumpRisk: false,
    authenticityIntact: true,
    isEmergencyStopTriggered: false,
  };

  const liquidation = {
    currentMarkUsd: 21.0,
    base: {
      scenarioName: 'BASE',
      points: [
        { percentage: 50, tokensSold: 2500, netProceedsUsd: 10.2, effectivePriceUsd: 0.00408, impactBps: 200, feeUsd: 0.1 },
        { percentage: 100, tokensSold: 5000, netProceedsUsd: 20.0, effectivePriceUsd: 0.0040, impactBps: 500, feeUsd: 0.2 },
      ],
      maxCapacityUsd: 20.0,
    },
    stressed25: { scenarioName: 'STRESSED_25', points: [], maxCapacityUsd: 18.0 },
    stressed50: { scenarioName: 'STRESSED_50', points: [], maxCapacityUsd: 15.0 },
    stressedExitCapacityUsd: 19.5,
    liquidityHaircutUsd: 1.5,
    ownImpactUsd: 1.0,
    projectedFeesUsd: 0.2,
    computedAtMs: 4_050_000,
    slot: 200_100n,
    surfaceDigest: 'digest_tournament_001',
  };

  // Round 1
  const record1 = engine.evaluateExitTournament({
    position: pos,
    research,
    liquidation,
    slot: 200_100n,
    decisionAtMs: 4_050_000,
    evidenceRoot: 'evi_root_pass32_001',
    stateRoot: 'state_root_pass32_001',
  });

  assert.ok(record1.attemptId.startsWith('exit-pos_tournament_001-'), 'Attempt ID must be deterministic');
  assert.equal(record1.authoritativePolicyId, 'dynamic-stopping');
  assert.ok(record1.shadowActions.length >= 6, 'Must evaluate at least 6 competing shadow policies');
  assert.ok(record1.recordHash && record1.recordHash.length === 64, 'Record hash must be 64-char SHA-256');

  // Verify specific shadow policies
  const policyIds = record1.shadowActions.map(a => a.policyId);
  assert.ok(policyIds.includes('legacy-ladder-shadow'), 'Must include legacy-ladder-shadow');
  assert.ok(policyIds.includes('early-risk-reduction'), 'Must include early-risk-reduction');
  assert.ok(policyIds.includes('principal-recovery-2x'), 'Must include principal-recovery-2x');
  assert.ok(policyIds.includes('committor-runner'), 'Must include committor-runner');
  assert.ok(policyIds.includes('liquidity-runner'), 'Must include liquidity-runner');

  // Round 2 with hash chaining
  const record2 = engine.evaluateExitTournament({
    position: pos,
    research,
    liquidation,
    slot: 200_101n,
    decisionAtMs: 4_050_400,
    evidenceRoot: 'evi_root_pass32_002',
    stateRoot: 'state_root_pass32_002',
    previousRecordHash: record1.recordHash,
  });

  assert.equal(record2.previousRecordHash, record1.recordHash, 'Record 2 must chain previous record hash');
  assert.notEqual(record2.recordHash, record1.recordHash, 'Hashes must differ across sequential attempts');
});

test('Pass 32: Exit Regret Ledger & Runner Dependence Metrics', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Counterfactual Regret Analysis
  const regretAnalysis = engine.computeCounterfactualExitRegret({
    positionId: 'pos_regret_001',
    realizedNetPnLUsd: 85.0, // Sold at 9.5x
    bestFeasibleExecutablePnLUsd: 100.0, // Executable peak was 11.0x
    exitTriggerPriceUsd: 0.0095,
    actualExecutedPriceUsd: 0.0093,
    tokensLiquidated: 10_000,
    maxPostExitExecutablePriceUsd: 0.011,
    counterfactualPolicyPnLs: {
      'legacy-ladder-shadow': 15.0, // Dumped prematurely at 2.0x
      'dynamic-stopping': 85.0,
      'runner-hold-10x': 92.0,
    },
  });

  assert.equal(regretAnalysis.positionId, 'pos_regret_001');
  assert.equal(regretAnalysis.realizedNetPnLUsd, 85.0);
  assert.equal(regretAnalysis.bestFeasibleExecutablePnLUsd, 100.0);
  assert.equal(regretAnalysis.runnerCaptureEfficiency, 0.85, 'RCE must be exactly 85/100 = 0.85');
  assert.ok(regretAnalysis.executionShortfallUsd > 0, 'Execution shortfall must be quantified');
  assert.ok(regretAnalysis.prematureLiquidationCostUsd > 0, 'Premature liquidation cost must be quantified');
  assert.equal(regretAnalysis.counterfactualPolicyWinner, 'runner-hold-10x', 'Winning shadow policy must be identified');

  // 2. Runner Dependence Metrics (Heavy Power-Law Skew)
  const tradePnlsSol = [55.0, 22.0, 11.0, 4.0, 1.5, 0.8, -0.5, -0.3, -0.2, 0.1]; // Top 3 account for 88 / 93.4 = 94%
  const rdMetrics = engine.calculateRunnerDependence(tradePnlsSol);

  assert.ok(rdMetrics.totalPnlSol > 90, 'Total PnL must be positive');
  assert.ok(rdMetrics.rd1 > 0.50, 'RD_1 must reflect top runner dominance');
  assert.ok(rdMetrics.rd3 > 0.85, 'RD_3 must be > 0.85 on power-law portfolio');
  assert.equal(rdMetrics.isHighlyRunnerDependent, true, 'Portfolio must be classified as highly runner dependent');
});

test('Pass 32: End-to-End Master Intelligence Engine Integration with Bellman Stopping & Tournament in processEvent', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_400_000;
  const canonicalEvent = {
    eventId: 'evt_pass32_bellman_001',
    eventType: 'TOKEN_CREATE',
    mint: 'BellmanWinnerToken111111111111111111111111',
    signature: '5bellman_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 34010,
    slot: 430_000,
    parentSlot: 429_999,
    blockhash: 'BhashBellman001',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 25.0,
      priceSol: 0.00005,
      symbol: 'BELLMAN',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const context = {
    tokenAgeSec: 20,
    rawWallets: [
      { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
      { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
      { address: 'w3', solFundedAmount: 4.5, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.5 },
      { address: 'w4', solFundedAmount: 7.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 6.0 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 200,
    liquiditySol: 80,
    txCount: 65,
  };

  const result = await engine.processEvent(canonicalEvent, context);

  // 1. Verify dynamicStopping is exposed on MasterPipelineResult
  assert.ok(result.dynamicStopping, 'dynamicStopping must be populated on MasterPipelineResult');
  assert.ok(['CONTINUE', 'PARTIAL', 'LIQUIDATE'].includes(result.dynamicStopping.optimalAction), 'optimalAction must be valid enum');
  assert.ok(Number.isFinite(result.dynamicStopping.continuationValueUsd), 'continuationValueUsd must be finite');
  assert.ok(Number.isFinite(result.dynamicStopping.immediateLiquidationValueUsd), 'immediateLiquidationValueUsd must be finite');
  assert.ok(Number.isFinite(result.dynamicStopping.netContinuationAdvantageUsd), 'netContinuationAdvantageUsd must be finite');

  // 2. Verify exitAttemptRecord is exposed on MasterPipelineResult
  assert.ok(result.exitAttemptRecord, 'exitAttemptRecord must be populated on MasterPipelineResult');
  assert.equal(result.exitAttemptRecord.authoritativePolicyId, 'dynamic-stopping');
  assert.ok(result.exitAttemptRecord.recordHash, 'recordHash must be generated');
  assert.ok(result.exitAttemptRecord.shadowActions.length >= 6, 'Shadow actions must be populated');

  // 3. Verify ViewModel surfaces Bellman stopping telemetry
  const vm = result.viewModel;
  assert.ok(vm.dynamicStopping, 'dynamicStopping must be exposed on ViewModel');
  assert.ok(vm.exitAttemptRecord, 'exitAttemptRecord must be exposed on ViewModel');
  assert.equal(vm.bellmanOptimalAction, result.dynamicStopping.optimalAction);
  assert.equal(vm.continuationAdvantageUsd, result.dynamicStopping.netContinuationAdvantageUsd);

  // 4. Verify Decision is AUTHORIZED_BUY on healthy candidate
  assert.equal(result.decision, 'AUTHORIZED_BUY');
  assert.ok(result.allocatedSol > 0);
});
