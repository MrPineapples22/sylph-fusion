import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionIntelligenceEngine } from '../../dist/intelligence/execution/opportunity-contract.js';

const opportunity = {
  mint: 'synthetic_opportunity', positionSizeSol: 1, targetPct: 20, stopPct: 5,
  horizonSec: 100, pTargetFirst: 0.9, pStopFirst: 0.05, pNeither: 0.05,
  expectedGrossEdgePct: 10, poolLiquiditySol: 99,
  priorityFeeLamports: 100_000n, jitoTipLamports: 0n, quoteAgeMs: 0,
};

function assertMissingEvidence(report) {
  assert.equal(report.evidenceState, 'PROVISIONAL');
  assert.equal(report.evidenceStatus, 'MISSING');
  assert.equal(report.validationSource, null);
  assert.equal(report.authority, 'ESTIMATE_ONLY');
  assert.equal(report.reason, 'NO_TRUSTED_VALIDATION_EVIDENCE');
}

function assertUnknownCertificate(certificate) {
  assertMissingEvidence(certificate);
  for (const metric of [
    'predictionQuality', 'calibrationBrier', 'sampleSufficiency', 'modelAgreementScore',
    'historicalSimilarity', 'executionQualityScore', 'edgeHalfLifeMs',
    'liquidityCapacitySol', 'dataHealthConfidence',
  ]) assert.equal(certificate[metric], null, `${metric} must remain unknown`);
  for (const status of [
    'oodStatus', 'walkForwardStatus', 'purgedValidationStatus', 'shadowStatus', 'manipulationRobustness',
  ]) assert.equal(certificate[status], 'UNKNOWN', `${status} cannot imply successful validation`);
}

test('a minimal certificate keeps missing evidence explicit through serialization', () => {
  const certificate = new ExecutionIntelligenceEngine().generateEdgeCertificate({
    mint: opportunity.mint, netExecutableEdgeBps: 900,
  });
  assertUnknownCertificate(certificate);
  assert.equal(certificate.netExecutableEdgeBps, 900);
  assertUnknownCertificate(JSON.parse(JSON.stringify(certificate)));
});

test('large samples and excellent caller scores cannot manufacture validation evidence', () => {
  const engine = new ExecutionIntelligenceEngine();
  for (const sampleCount of [0, 50, 51, 65, 1_000_000]) {
    const certificate = engine.generateEdgeCertificate({
      mint: opportunity.mint, netExecutableEdgeBps: 100_000,
      sampleCount, brierScore: 0, modelAgreement: 1, dataConfidence: 1,
    });
    assertUnknownCertificate(certificate);
  }
});

test('direct callers cannot assign a verified or supported state or forge provenance', () => {
  const engine = new ExecutionIntelligenceEngine();
  for (const evidenceState of ['VERIFIED', 'SUPPORTED', 'PROVISIONAL', 'DISCOVERY', 'DEGRADED', 'RETIRED']) {
    const certificate = engine.generateEdgeCertificate({
      mint: opportunity.mint, netExecutableEdgeBps: 100_000,
      sampleCount: 1_000_000, brierScore: 0, modelAgreement: 1, dataConfidence: 1,
      evidenceState, evidenceStatus: 'VERIFIED', validationSource: 'caller_claim',
      authority: 'EXECUTION', walkForwardStatus: 'PASS',
    });
    assertUnknownCertificate(certificate);
  }
});

test('opportunity retains useful heuristic economics without presenting confidence or validation', () => {
  const contract = new ExecutionIntelligenceEngine().evaluateOpportunity(opportunity);
  assertMissingEvidence(contract);
  assertUnknownCertificate(contract.certificate);
  assert.equal(contract.estimateMethod, 'OPPORTUNITY_HEURISTIC_V1');
  assert.equal(contract.priceImpactPct, 1);
  assert.equal(contract.slippagePct, 1.8);
  assert.equal(contract.priorityFeeSol, 0.0001);
  assert.equal(contract.latencyDecayPct, 0.16);
  assert.equal(contract.expectedExecutableEdgePct, 5.98);
  assert.equal(contract.certificate.netExecutableEdgeBps, 598);
  assert.equal(contract.expectedShortfallPct, 7.8);
  assert.equal(contract.opportunityHalfLifeMs, 10_000);
  assert.equal(contract.expectedLandingTimeMs, 400);
  assert.equal(contract.halfLifeProfile.halfLifeMs, 10_000);
  assert.equal(contract.isExpiredBeforeLanding, false);
  for (const metric of ['executionConfidence', 'modelConfidence', 'dataConfidence', 'oodScore']) {
    assert.equal(contract[metric], null, `${metric} must remain unknown`);
  }
  assert.equal(contract.regime, 'UNKNOWN');
  assert.equal(contract.pTargetFirst, opportunity.pTargetFirst);
});

test('high edge, liquidity and confident input probabilities never promote evidence state', () => {
  const engine = new ExecutionIntelligenceEngine();
  for (const expectedGrossEdgePct of [-10, 2, 10, 1_000]) {
    const contract = engine.evaluateOpportunity({
      ...opportunity, expectedGrossEdgePct, poolLiquiditySol: 1_000_000,
      pTargetFirst: 1, pStopFirst: 0, pNeither: 0, oodScore: 0, regime: 'NORMAL',
      evidenceState: 'VERIFIED', sampleCount: 1_000_000, brierScore: 0,
      dataConfidence: 1, modelAgreement: 1,
    });
    assertMissingEvidence(contract);
    assertUnknownCertificate(contract.certificate);
    assert.equal(contract.modelConfidence, null);
    assert.equal(contract.oodScore, 0, 'caller context remains available without validating its meaning');
    assert.equal(contract.regime, 'NORMAL');
  }
});
