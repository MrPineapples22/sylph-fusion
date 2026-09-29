import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLineageDigest,
  createJournalEnvelope,
  computeCapitalBackedMultiplier,
  ManipulationFirewall,
  LiquidityRealityEngine,
  RealizedEVEngine,
  MultiplierCertificateAuthority,
} from '../../dist/intelligence/science/nexus-mx.js';

test('NEXUS-MX: computeLineageDigest deterministically binds lifecycle keys', () => {
  const lineage1 = {
    tokenEpisodeId: 'ep_123',
    eventJournalOffset: 42,
    canonicalSnapshotId: 'snap_001',
    featureSnapshotId: 'feat_001',
    modelGeneration: 'gen2_v1',
    configurationEpoch: 1,
    riskEpoch: 2,
    executionGeneration: 3,
  };
  const lineage2 = {
    canonicalSnapshotId: 'snap_001',
    configurationEpoch: 1,
    eventJournalOffset: 42,
    executionGeneration: 3,
    featureSnapshotId: 'feat_001',
    modelGeneration: 'gen2_v1',
    riskEpoch: 2,
    tokenEpisodeId: 'ep_123',
  };
  const digest1 = computeLineageDigest(lineage1);
  const digest2 = computeLineageDigest(lineage2);
  assert.equal(digest1, digest2);
  assert.equal(digest1.length, 64);
});

test('Event Journal Envelope: createJournalEnvelope computes valid SHA-256 payload hash', () => {
  const payload = { mint: 'TestMint11111111111111111111111111111111', priceSol: 0.0001 };
  const envelope = createJournalEnvelope('pump_portal_ws', '1.0', payload, {
    slot: 250000,
    mint: 'TestMint11111111111111111111111111111111',
  });
  assert.ok(envelope.journalId.startsWith('jnl_'));
  assert.equal(envelope.source, 'pump_portal_ws');
  assert.equal(envelope.payloadHash.length, 64);
  assert.equal(envelope.slot, 250000);
});

test('Invariant 1.1: PriceMultiplier != CapitalBackedMultiplier', () => {
  // Chart shows 10x jump (0.001 SOL vs 0.0001 SOL entry), but organic inflow is only 0.5 SOL on 30 SOL pool
  const res = computeCapitalBackedMultiplier(0.0001, 0.5, 30.0, 0.0010);
  assert.equal(res.displayedPriceMultiple, 10.0);
  // Organic inflow only supports ~1.03x capital-backed multiple
  assert.ok(res.capitalBackedMultiple < 1.10);
  assert.notEqual(res.displayedPriceMultiple, res.capitalBackedMultiple);
});

test('Manipulation Firewall: LPI-X flags artificial price inflation with zero inflow', () => {
  // 5x price jump with 0.05 SOL net organic quote inflow
  const lpi = ManipulationFirewall.evaluateLpiHazard(5.0, 0.05, 50.0);
  assert.ok(lpi.lpiHazard > 0.60);
  assert.equal(lpi.mechanicalPriceMove, true);

  // Organic 2x move with 15 SOL real quote inflow
  const organicLpi = ManipulationFirewall.evaluateLpiHazard(2.0, 15.0, 30.0);
  assert.equal(organicLpi.lpiHazard, 0);
  assert.equal(organicLpi.mechanicalPriceMove, false);
});

test('Liquidity Reality: Realizable exit curves discount displayed peak for large sizes', () => {
  const curve = LiquidityRealityEngine.computeRealizableExitCurve(10.0, 20_000, 2);
  assert.equal(curve.displayedMultiple, 10.0);
  assert.ok(curve.realizableMultipleAt100Usd > curve.realizableMultipleAt1000Usd);
  assert.ok(curve.realizableMultipleAt1000Usd > curve.realizableMultipleAt5000Usd);
  assert.ok(curve.exitabilityScore >= 1.0);
});

test('Realized-EV Engine: Viability rejects sub-hurdle or high-friction setups', () => {
  const multipliers = {
    p2x: 0.30,
    p3x: 0.15,
    p5x: 0.08,
    p10x: 0.03,
    p20x: 0.01,
    p50x: 0.002,
    p100x: 0.0005,
    expectedTimeToTouchSec: { touch2x: 45, touch5x: 180, touch10x: 600 },
  };
  const risks = {
    collapseHazardRate: 0.35,
    rugHazardRate: 0.10,
    liquidityDrainHazardRate: 0.05,
    manipulationHazardRate: 0.15,
    migrationStallHazardRate: 0.05,
    compositeFailureHazard: 0.50,
  };
  const capturability = {
    totalLatencyBudgetMs: 450,
    expectedSlippageBps: 200,
    expectedPriceImpactBps: 150,
    jitoTipEfficiency: 0.90,
    pFill: 0.92,
    pExit: 0.90,
    capturableUpsideRatio: 0.70,
  };

  const ev = RealizedEVEngine.calculateEV(multipliers, risks, capturability);
  // High failure hazard (50%) and rug hazard should result in non-viable or negative EV
  assert.equal(ev.isViable, false);
});

test('MultiplierCertificateAuthority: Vetoes critical manipulation and grants eligible certificates', () => {
  const lineage = {
    tokenEpisodeId: 'ep_test_001',
    eventJournalOffset: 100,
    canonicalSnapshotId: 'snap_100',
    featureSnapshotId: 'feat_100',
    modelGeneration: 'gen2_v1',
    configurationEpoch: 1,
    riskEpoch: 1,
    executionGeneration: 1,
  };
  const mint = 'TargetRunnerMint111111111111111111111111111';

  const capitalFlow = {
    grossBuySol: 250, grossSellSol: 60, organicBuySol: 210, organicSellSol: 30,
    organicNetSol: 180, newCapitalSol: 150, recycledCapitalSol: 30,
    freshCapitalRatio: 0.83, creatorFundedRatio: 0.0, capitalVelocity: 1.5,
    capitalAcceleration: 0.2, capitalPersistence: 0.92,
  };
  const manipulationSafe = {
    washProbability: 0.05, atomicSelfCancelProbability: 0.02, bundlerProbability: 0.08,
    txPaddingProbability: 0.04, lpiProbability: 0.05, coordinatedDumpProbability: 0.05,
    creatorSybilProbability: 0.02, fundingClusterProbability: 0.03, volumeAuthenticity: 0.95,
    participationAuthenticity: 0.92, manipulationConfidence: 0.95,
  };
  const exitCurveGood = {
    displayedMultiple: 5.0, realizableMultipleAt100Usd: 4.8, realizableMultipleAt500Usd: 4.5,
    realizableMultipleAt1000Usd: 4.2, realizableMultipleAt5000Usd: 3.2,
    exitabilityScore: 0.85, routeRedundancyCount: 2, liquidityDecayPct: 0.0,
  };
  const multipliersHigh = {
    p2x: 0.82, p3x: 0.65, p5x: 0.48, p10x: 0.25, p20x: 0.10, p50x: 0.03, p100x: 0.01,
    expectedTimeToTouchSec: { touch2x: 30, touch5x: 120, touch10x: 300 },
  };
  const risksLow = {
    collapseHazardRate: 0.08, rugHazardRate: 0.02, liquidityDrainHazardRate: 0.02,
    manipulationHazardRate: 0.03, migrationStallHazardRate: 0.02, compositeFailureHazard: 0.15,
  };
  const uncertaintyLow = {
    epistemicUncertainty: 0.08, aleatoricUncertainty: 0.09, dataQualityUncertainty: 0.03,
    totalUncertaintyMargin: 0.12,
  };
  const capturabilityGood = {
    totalLatencyBudgetMs: 250, expectedSlippageBps: 100, expectedPriceImpactBps: 80,
    jitoTipEfficiency: 0.95, pFill: 0.96, pExit: 0.95, capturableUpsideRatio: 0.88,
  };
  const spieHigh = {
    evidenceQuality: 95, capitalBackedMomentum: 88, executableLiquidity: 90,
    entityAdjustedParticipation: 86, controllerAdjustedWalletQuality: 92,
    competingFailureHazard: 15, realizableExecutionQuality: 89, marketRegimeScore: 85,
    compositeScore: 88,
  };

  const cert = MultiplierCertificateAuthority.issueCertificate(
    lineage, mint, capitalFlow, manipulationSafe, exitCurveGood,
    multipliersHigh, risksLow, uncertaintyLow, capturabilityGood, spieHigh
  );

  assert.equal(cert.decision, 'ENTER_ELIGIBLE');
  assert.ok(cert.primaryEvidence.length >= 3);
  assert.equal(cert.certificateHash.length, 64);
  assert.ok(cert.certificateId.startsWith('cert_mx2_'));

  // Test hard veto on critical manipulation
  const manipulationToxic = { ...manipulationSafe, lpiProbability: 0.85 };
  const vetoCert = MultiplierCertificateAuthority.issueCertificate(
    lineage, mint, capitalFlow, manipulationToxic, exitCurveGood,
    multipliersHigh, risksLow, uncertaintyLow, capturabilityGood, spieHigh
  );
  assert.equal(vetoCert.decision, 'VETO_HARD');
  assert.ok(vetoCert.riskFactors.includes('CRITICAL_MANIPULATION_HAZARD'));
});
