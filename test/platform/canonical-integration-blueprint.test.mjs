/**
 * SYLPH FUSION — CANONICAL INTEGRATION BLUEPRINT TEST SUITE
 * Covers Waves 8, 9, 10, 11 (Science, Strategy Ecology, Control Root, Assurance, and Release Certification)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';

// Wave 8 imports
import { AllAttemptExecutionDataset } from '../../dist/platform/calibration/all-attempt-dataset.js';
import { FailureConditionedCalibrator } from '../../dist/intelligence/science/failure-conditioned-calibrator.js';
import { CohortMaturityEngine } from '../../dist/platform/cohort/cohort-maturity.js';
import { CompetingRiskOutcomeModel } from '../../dist/platform/calibration/competing-risk-model.js';

// Wave 9 imports
import { LabelForgeV2 } from '../../dist/intelligence/science/labelforge-v2.js';
import { AssuranceRevocationRegistry } from '../../dist/platform/assurance/revocation-registry.js';
import { AutonomousRDGovernorX } from '../../dist/intelligence/research-governor/rd-governor.js';
import { createUntestedHypothesis } from '../../dist/intelligence/research-governor/research-claim.js';
import { computePromotionPayloadDigest } from '../../dist/intelligence/research-governor/promotion-evidence-bundle.js';
import { StrategyEcologyRegistry } from '../../dist/intelligence/signal-ecology/mechanism-fingerprint.js';
import { ResidualLedger } from '../../dist/intelligence/science/residual-ledger.js';

// Wave 10 imports
import { ControlRootManager } from '../../dist/platform/control/control-root.js';
import { OperatorCommandGateway } from '../../dist/platform/control/operator-command.js';
import { AssuranceMonitorEngine } from '../../dist/platform/assurance/assurance-monitors.js';
import { EmergencyPartitionManager } from '../../dist/intelligence/capital/emergency-partition.js';
import { TwinRedTeamEngine } from '../../dist/intelligence/reality-gap/twin-red-team.js';
import { LiquidityDependencyGraph } from '../../dist/intelligence/liquidity/liquidity-dependency-graph.js';

// Wave 11 imports
import { ReleaseRootManager } from '../../dist/platform/assurance/release-root.js';

test('Wave 8: All-Attempt Dataset & Conditional Slippage (fail closed on 0 samples)', () => {
  const dataset = new AllAttemptExecutionDataset();

  assert.throws(
    () => dataset.estimateConditionalSlippage('ROUTE_RAYDIUM', 10),
    /CALIBRATION_UNAVAILABLE/
  );

  // Populate 10 attempts
  for (let i = 0; i < 10; i++) {
    dataset.recordAttempt({
      economicFactId: `fact_${i}`,
      economicIntentId: `intent_${i}`,
      executionGenerationId: `gen_${i}`,
      strategyId: 'strat_test',
      decisionId: `dec_${i}`,
      decisionAt: Date.now() - 5000,
      requestedInputLamports: 1_000_000_000n,
      actualOutputRaw: 1_020_000_000n,
      route: 'ROUTE_RAYDIUM',
      transport: 'TPU',
      writableSet: ['acc1', 'acc2'],
      baseFeeLamports: 5000n,
      priorityFeeMicroLamports: 10_000n,
      jitoTipLamports: 50_000n,
      routeFeeLamports: 0n,
      rentLamports: 0n,
      token2022FeeLamports: 0n,
      slippageBps: 15 + i * 2,
      status: 'LANDED_SUCCESS',
    });
  }

  const estimate = dataset.estimateConditionalSlippage('ROUTE_RAYDIUM', 10);
  assert.equal(estimate.sampleCount, 10);
  assert.ok(estimate.medianBps >= 15);
  assert.ok(estimate.p95Bps >= estimate.medianBps);
});

test('Wave 8: Failure-Conditioned Calibrator separates landing, success, and profit', () => {
  const calibrator = new FailureConditionedCalibrator();

  assert.throws(
    () =>
      calibrator.calibrate({
        route: 'ROUTE_PUMP',
        priorityFeeMicroLamports: 10_000n,
        congestionLevel: 'LOW',
        targetProgramId: 'PumpFun1111111111111111111111111111111111',
        marketRegime: 'TRENDING',
      }, 10),
    /CALIBRATION_UNAVAILABLE/
  );

  for (let i = 0; i < 10; i++) {
    calibrator.recordAttempt({
      economicFactId: `fact_${i}`,
      economicIntentId: `intent_${i}`,
      executionGenerationId: `gen_${i}`,
      strategyId: 'strat_test',
      decisionId: `dec_${i}`,
      decisionAt: Date.now(),
      requestedInputLamports: 1_000_000_000n,
      actualOutputRaw: i < 5 ? 1_050_000_000n : 900_000_000n,
      route: 'ROUTE_PUMP',
      transport: 'TPU',
      writableSet: [],
      baseFeeLamports: 5000n,
      priorityFeeMicroLamports: 10_000n,
      jitoTipLamports: 0n,
      routeFeeLamports: 0n,
      rentLamports: 0n,
      token2022FeeLamports: 0n,
      status: i < 8 ? 'LANDED_SUCCESS' : 'BUILD_FAILED',
    });
  }

  const result = calibrator.calibrate({
    route: 'ROUTE_PUMP',
    priorityFeeMicroLamports: 10_000n,
    congestionLevel: 'LOW',
    targetProgramId: 'PumpFun1111111111111111111111111111111111',
    marketRegime: 'TRENDING',
  }, 10);

  assert.equal(result.sampleCount, 10);
  assert.equal(result.pLanding, 0.8); // 8 landed out of 10
  assert.ok(result.compositeSuccessProbability <= result.pLanding);
});

test('Wave 8: Cohort Maturity Engine checks diversity and sample count without favorable defaults', () => {
  const observations = [
    {
      observationId: 'obs_1',
      timestamp: 1000,
      regime: 'REGIME_A',
      creatorId: 'creator_1',
      walletClusterId: 'cluster_1',
      route: 'ROUTE_A',
    },
  ];

  const report = CohortMaturityEngine.assessMaturity('cohort_01', observations);
  assert.equal(report.isMature, false);
  assert.ok(report.disqualificationReasons.some((r) => r.includes('INSUFFICIENT_RAW_SAMPLES')));
});

test('Wave 9: LabelForge V2 enforces strict bitemporal causality and revocation inheritance', () => {
  const revocation = new AssuranceRevocationRegistry();

  // 1. Future leakage test
  assert.throws(() => {
    LabelForgeV2.certifyLabel({
      tokenMint: 'Mint111111111111111111111111111111111111111',
      creatorIdentity: 'Creator11111111111111111111111111111111111',
      funderClusterId: 'cluster_1',
      economicFactId: 'fact_001',
      executionGenerationId: 'gen_001',
      timeline: {
        occurredAt: 1000,
        observedAt: 1010,
        availableAt: 1050, // Leakage: available > knownAt
        knownAt: 1020,
        decisionAt: 1030,
        targetTime: 2000,
        settledAt: 2500,
        labelMaturedAt: 3000,
        finalizedAt: 2400,
      },
      knowledgeCutRoot: 'cut_root',
      terminalityCertificateId: 'term_cert_01',
      settlementCertificateId: 'settle_cert_01',
      profitCertificateId: 'profit_cert_01',
      finalLabelValue: 1,
      labelFinality: 'ECONOMIC_FINAL',
      realizedNetProceedsLamports: 100_000n,
      totalFrictionLamports: 5000n,
      implementationShortfallBps: 20,
      revocationRegistry: revocation,
    });
  }, /FUTURE_LEAKAGE/);

  // 2. Valid label
  const validLabel = LabelForgeV2.certifyLabel({
    tokenMint: 'Mint111111111111111111111111111111111111111',
    creatorIdentity: 'Creator11111111111111111111111111111111111',
    funderClusterId: 'cluster_1',
    economicFactId: 'fact_001',
    executionGenerationId: 'gen_001',
    timeline: {
      occurredAt: 1000,
      observedAt: 1010,
      availableAt: 1015,
      knownAt: 1020,
      decisionAt: 1030,
      targetTime: 2000,
      settledAt: 2500,
      labelMaturedAt: 3000,
      finalizedAt: 2400,
    },
    knowledgeCutRoot: 'cut_root',
    terminalityCertificateId: 'term_cert_01',
    settlementCertificateId: 'settle_cert_01',
    profitCertificateId: 'profit_cert_01',
    finalLabelValue: 1,
    labelFinality: 'ECONOMIC_FINAL',
    realizedNetProceedsLamports: 100_000n,
    totalFrictionLamports: 5000n,
    implementationShortfallBps: 20,
    revocationRegistry: revocation,
  });

  assert.equal(validLabel.labelFinality, 'ECONOMIC_FINAL');

  // 3. Invalidate if ancestor terminality certificate is revoked
  revocation.revokeArtifact('term_cert_01', 'REORG_DETECTED', 'test_reporter');
  const checked = LabelForgeV2.checkRevocationStatus(validLabel, revocation);
  assert.equal(checked.labelFinality, 'REVISED_INVALID');
});

test('Wave 9: Autonomous R&D Governor X rejects illegal multi-step jump and verifies Ed25519 signatures', () => {
  const governor = new AutonomousRDGovernorX();
  const hyp = createUntestedHypothesis({
    hypothesisId: 'hyp_vol_alpha',
    proposerAgentId: 'agent_proposer',
    description: 'Volatility cluster edge',
    mechanism: 'Mean reversion on volume spike',
    falsificationCondition: 'Negative Sharpe over 100 samples',
  });

  governor.registerHypothesis(hyp);

  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const baseBundle = {
    bundleId: 'bundle_01',
    hypothesisId: 'hyp_vol_alpha',
    fromState: 'UNTESTED',
    targetState: 'REPLAY_TESTED',
    proposerAgentId: 'agent_proposer',
    independentVerifierAgentId: 'agent_verifier',
    codeHash: 'hash_code_123',
    featureSchema: 'schema_v1',
    datasetRoot: 'data_root_abc',
    knowledgeCutRoot: 'cut_root_xyz',
    trainingWindow: { startMs: 1000, endMs: 2000 },
    validationWindow: { startMs: 2001, endMs: 3000 },
    sealedHoldoutRoot: 'sealed_holdout_root_123',
    outOfSampleSampleSize: 150,
    metricDefinitions: ['sharpe', 'drawdown'],
    falsificationTestPassed: true,
    counterfactualSharpe: 1.75,
    releaseRoot: 'release_root_001',
    verifierPublicKeyPem: publicKey,
  };

  const digestHex = computePromotionPayloadDigest({ ...baseBundle, verifierSignatureHex: '' });
  const sigBuffer = sign(null, Buffer.from(digestHex, 'hex'), privateKey);
  const validBundle = {
    ...baseBundle,
    verifierSignatureHex: sigBuffer.toString('hex'),
  };

  // Illegal multi-step jump: UNTESTED -> GRADUATED
  const illegalJump = governor.promoteHypothesis('hyp_vol_alpha', 'GRADUATED', {
    ...validBundle,
    targetState: 'GRADUATED',
  });
  assert.equal(illegalJump.promoted, false);
  assert.ok(illegalJump.reason?.includes('ILLEGAL_STATE_ADVANCEMENT'));

  // Legal step: UNTESTED -> REPLAY_TESTED
  const legalStep = governor.promoteHypothesis('hyp_vol_alpha', 'REPLAY_TESTED', validBundle);
  assert.equal(legalStep.promoted, true);
  assert.equal(governor.getHypothesis('hyp_vol_alpha')?.state, 'REPLAY_TESTED');
});

test('Wave 9: Strategy Ecology detects semantic duplicate and assigns falsification hurdle', () => {
  const registry = new StrategyEcologyRegistry();

  registry.registerStrategy({
    strategyId: 'original_momentum',
    inputs: ['vol_1m', 'rsi_5m'],
    featureTransformations: ['norm_zscore', 'ema_smooth'],
    hypothesis: 'Momentum persists in trending regime',
    decisionRule: 'if rsi > 70 buy',
    riskRule: 'stop at 50 bps',
    capitalRule: 'kelly 0.25',
    executionRoute: 'ROUTE_RAYDIUM',
    exitRule: 'trailing stop 25 bps',
    targetRegime: 'TRENDING_BULL',
  });

  // Candidate with renamed strategy ID but identical features/rules
  const evaluation = registry.evaluateCandidate({
    strategyId: 'renamed_momentum',
    inputs: ['vol_1m', 'rsi_5m'],
    featureTransformations: ['norm_zscore', 'ema_smooth'],
    hypothesis: 'Momentum persists in trending regime',
    decisionRule: 'if rsi > 70 buy',
    riskRule: 'stop at 50 bps',
    capitalRule: 'kelly 0.25',
    executionRoute: 'ROUTE_RAYDIUM',
    exitRule: 'trailing stop 25 bps',
    targetRegime: 'TRENDING_BULL',
  });

  assert.equal(evaluation.isSemanticDuplicate, true);
  assert.equal(evaluation.similarityScore, 1.0);
  assert.equal(evaluation.requiredOosSampleHurdle, 200);
});

test('Wave 10: Control Root and Supervisor Governance enforces controller lease and stale proposal rejection', () => {
  const manager = new ControlRootManager({
    controlEpoch: 10n,
    fenceEpoch: 5n,
    activeControllerId: 'ctrl_01',
    controllerLeaseExpiresAt: Date.now() + 100_000,
    configRoot: 'config_01',
    policyRoot: 'policy_01',
    releaseRoot: 'release_01',
    revocationEpoch: 1n,
  });

  // Valid proposal
  const validProposal = manager.validateProposal({
    controlEpoch: 10n,
    fenceEpoch: 5n,
    configRoot: 'config_01',
    policyRoot: 'policy_01',
    releaseRoot: 'release_01',
    revocationEpoch: 1n,
  });
  assert.equal(validProposal.isValid, true);

  // Proposal built against old epoch 9n
  const staleProposal = manager.validateProposal({
    controlEpoch: 9n,
    fenceEpoch: 5n,
    configRoot: 'config_01',
    policyRoot: 'policy_01',
    releaseRoot: 'release_01',
    revocationEpoch: 1n,
  });
  assert.equal(staleProposal.isValid, false);
  assert.ok(staleProposal.reason?.includes('STALE_PROPOSAL'));
});

test('Wave 10: Assurance Monitor Engine degrades health on monitor silence without optimistic defaults', () => {
  const engine = new AssuranceMonitorEngine();
  engine.registerMonitor('provider_truth_monitor', { maxSilenceMs: 1000, isCritical: true });

  // Record heartbeat 2 seconds ago (exceeds 1000ms max silence)
  engine.recordHeartbeat({
    monitorId: 'provider_truth_monitor',
    lastObservedAt: Date.now() - 2000,
    reportedStatus: 'PASS',
    metricValue: 1.0,
    evidenceDigest: 'hb_digest',
  });

  const report = engine.evaluateAssurance('cfg_root', 'cfg_root');
  assert.equal(report.overallHealth, 'CRITICAL_SUSPEND');
  assert.ok(report.blindMonitors.includes('provider_truth_monitor'));
});

test('Wave 10: Emergency Partition Manager protects risk-reducing exits (A2)', () => {
  const manager = new EmergencyPartitionManager({
    emergencyFeeReserveLamports: 50_000_000n, // 0.05 SOL
    emergencyJitoTipLamports: 10_000_000n,
    reservedExitRpcBandwidthRequestsPerSec: 50,
    minimumExitComputeUnits: 200_000,
    totalCapitalLamports: 1_000_000_000n,
  });

  // Total cash: 70_000_000 lamports. Emergency buffer = 60_000_000. Usable for A4 entry = 10_000_000.
  const availableCash = 70_000_000n;

  // New entry (A4_EXPAND) requests 20_000_000 lamports -> MUST BE REJECTED to protect emergency buffer
  const entryRequest = manager.evaluateAllocation(availableCash, {
    intentId: 'intent_entry',
    actionLattice: 'A4_EXPAND',
    requestedCashLamports: 20_000_000n,
    requestedFeeLamports: 10_000n,
  });
  assert.equal(entryRequest.isApproved, false);
  assert.ok(entryRequest.reason?.includes('EMERGENCY_PARTITION_ENCROACHMENT'));

  // Risk reduction exit (A2_REDUCE) requests 50_000_000 lamports -> MUST BE APPROVED
  const exitRequest = manager.evaluateAllocation(availableCash, {
    intentId: 'intent_exit',
    actionLattice: 'A2_REDUCE',
    requestedCashLamports: 50_000_000n,
    requestedFeeLamports: 10_000n,
  });
  assert.equal(exitRequest.isApproved, true);
});

test('Wave 10: Twin Red Team discovers false confidence exploits and penalizes twin trust', () => {
  const engine = new TwinRedTeamEngine();

  const report = engine.evaluateScenario(
    {
      scenarioId: 'scen_01',
      predictedNetReturnBps: 150,
      predictedSurvivalProbability: 0.99,
      predictedExitCostBps: 20,
      twinAssessedSafe: true,
    },
    {
      scenarioId: 'scen_01',
      actualNetReturnBps: -10_000,
      actualSurvival: false,
      actualExitCostBps: 500,
      liquidityCollapsed: true,
      routeFractured: true,
    }
  );

  assert.equal(report.exploitDiscovered, true);
  assert.equal(report.severity, 'CATASTROPHIC');
  assert.equal(engine.getEffectiveTrustLevel(), 'QUARANTINED');
});

test('Wave 11: Release Root Manager binds all release components deterministically', () => {
  const components = {
    gitCommitSha: 'd9522b5e34663d55920e8489fda948a02db08586',
    packageLockHash: 'lock_hash_123',
    cargoLockHash: 'cargo_hash_456',
    typeScriptVersion: '5.9.3',
    rustToolchainVersion: 'rustc 1.90.0',
    configSchemaRoot: 'schema_root_789',
    policyRoot: 'policy_root_abc',
    canonicalEncodingVersion: 'V1',
    formalSpecEvidenceRoot: 'spec_root_tla',
    testVerificationEvidenceRoot: 'test_evidence_xyz',
  };

  const releaseRoot = ReleaseRootManager.computeReleaseRoot(components);
  assert.ok(releaseRoot.releaseRootHash.length === 64);
  assert.equal(ReleaseRootManager.verifyReleaseRoot(releaseRoot), true);
});

test('Wave 10: Operator Command Gateway executes signed commands and carries over in-flight facts', () => {
  const control = new ControlRootManager({
    controlEpoch: 1n,
    fenceEpoch: 1n,
    activeControllerId: 'ctrl_01',
    controllerLeaseExpiresAt: Date.now() + 60_000,
    configRoot: 'cfg_1',
    policyRoot: 'pol_1',
    releaseRoot: 'rel_1',
    revocationEpoch: 1n,
  });

  const gateway = new OperatorCommandGateway(control);

  // Generate Ed25519 keypair for operator
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const cmdBase = {
    commandId: 'cmd_emergency_01',
    commandType: 'EMERGENCY_STOP',
    issuer: 'ops_admin',
    issuedAt: Date.now(),
    expectedControlEpoch: 1n,
    expectedStateRoot: 'state_root_init',
    reason: 'Upstream validator anomaly detected',
    signerPublicKeyPem: publicKey,
  };

  const digestHex = OperatorCommandGateway.computeCommandDigest(cmdBase);
  const signatureHex = sign(null, Buffer.from(digestHex, 'hex'), privateKey).toString('hex');

  const envelope = {
    ...cmdBase,
    signatureHex,
  };

  const res = gateway.executeCommand(envelope, 'state_root_init');
  assert.equal(res.success, true);
  assert.ok(res.receipt);
  assert.equal(res.receipt.commandType, 'EMERGENCY_STOP');

  // Verify in-flight facts carryover
  gateway.recordInFlightFact({
    economicFactId: 'fact_pending_01',
    executionGenerationId: 'gen_01',
    state: 'SUBMITTED',
    initiatedAt: Date.now() - 5000,
    lastReconciledAt: Date.now() - 5000,
    requiresReconciliation: false,
  });

  const carried = gateway.carryoverInFlightFacts('ctrl_02');
  assert.equal(carried.length, 1);
  assert.equal(carried[0].economicFactId, 'fact_pending_01');
  assert.equal(carried[0].requiresReconciliation, true);
});

test('Wave 10: Liquidity Dependency Graph detects bottlenecks in simultaneous liquidation', () => {
  const graph = new LiquidityDependencyGraph();

  // Add shared pool with 10 SOL available liquidity
  graph.addNode({
    nodeId: 'pool_shared_sol_usdc',
    nodeType: 'POOL',
    availableLiquidityLamports: 10_000_000_000n,
    maxThroughputPerSlotLamports: 5_000_000_000n,
  });

  // Position 1 requires 4 SOL
  graph.addEdge({
    fromPositionId: 'pos_1',
    toDependencyNodeId: 'pool_shared_sol_usdc',
    requiredLiquidityLamports: 4_000_000_000n,
  });

  // Position 2 requires 4 SOL (aggregate 8 SOL = 80% utilization > 60% threshold -> bottleneck)
  graph.addEdge({
    fromPositionId: 'pos_2',
    toDependencyNodeId: 'pool_shared_sol_usdc',
    requiredLiquidityLamports: 4_000_000_000n,
  });

  const stress = graph.stressSimultaneousExit();
  assert.equal(stress.isFeasible, false);
  assert.ok(stress.sharedBottlenecks.includes('pool_shared_sol_usdc'));
  assert.equal(stress.maxContestedNodeUtilization, 0.8);
});

test('Wave 8 & 9: Competing Risk Model and Residual Ledger evaluation', () => {
  const model = new CompetingRiskOutcomeModel();
  assert.throws(() => model.evaluate('cohort_01', 5), /CALIBRATION_UNAVAILABLE/);

  for (let i = 0; i < 10; i++) {
    model.recordIncident({
      candidateId: `cand_${i}`,
      firstObservedAt: 1000,
      terminalHazard: i < 6 ? 'CREATOR_DUMP' : 'TARGET_2X_HIT',
      elapsedMs: 3000 + i * 100,
      realizedReturnBps: i < 6 ? -5000 : 10000,
    });
  }

  const risk = model.evaluate('cohort_01', 10);
  assert.equal(risk.dominantHazard, 'CREATOR_DUMP');
  assert.equal(risk.cumulativeIncidence['CREATOR_DUMP'], 0.6);

  // Residual Ledger
  const ledger = new ResidualLedger();
  for (let i = 0; i < 25; i++) {
    ledger.recordObservation({
      observationId: `obs_${i}`,
      economicFactId: `fact_${i}`,
      strategyId: 'strat_1',
      predictedValue: 50,
      calibratedPrediction: 45,
      actualMaturedOutcome: 35, // persistent negative residual: 35 - 45 = -10
      regime: 'VOLATILE_REGIME',
      actorGraphRoot: 'root_g',
      marketGrammarRoot: 'root_m',
      executionState: 'SETTLED',
      timestamp: Date.now(),
    });
  }

  const clusters = ledger.clusterSystematicResiduals(20);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].isSystematicBias, true);
  assert.ok(clusters[0].candidateHypothesisMechanism?.includes('over-prediction'));
});
