import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfitabilityEvidenceAuditor } from '../../scripts/audit-profitability-evidence-sequence.mjs';

test('SECTION 67: Rejects strategy promotion when only paper PnL is present', () => {
  const auditor = new ProfitabilityEvidenceAuditor();

  const report = auditor.auditStrategyPromotionEvidence({
    strategyId: 'strat_paper_only_test',
    hasPointInTimeDataset: false,
    allAttemptDatasetSampleCount: 0,
    hasFullCostDeduction: false,
    walkForwardFoldsCount: 0,
    holdoutEvaluationClean: false,
    failureConditionedCalibrationPassed: false,
    shadowObservationHours: 0,
    canaryReconciledClean: false,
    lowerConfidenceBound95Bps: -20,
    capacityAnalysisMaxLamports: 0n,
  });

  assert.equal(report.isEligibleForCapitalPromotion, false);
  assert.equal(report.completedStagesCount, 0);
  assert.equal(report.rejections.length, 10);
  assert.ok(report.rejections.some((r) => r.includes('STAGE_1_FAILED')));
  assert.ok(report.rejections.some((r) => r.includes('STAGE_9_FAILED')));
});

test('SECTION 67: Rejects strategy with positive mean return but non-positive 95% LCB', () => {
  const auditor = new ProfitabilityEvidenceAuditor();

  const report = auditor.auditStrategyPromotionEvidence({
    strategyId: 'strat_lucky_variance',
    hasPointInTimeDataset: true,
    allAttemptDatasetSampleCount: 100,
    hasFullCostDeduction: true,
    walkForwardFoldsCount: 4,
    holdoutEvaluationClean: true,
    failureConditionedCalibrationPassed: true,
    shadowObservationHours: 36,
    canaryReconciledClean: true,
    lowerConfidenceBound95Bps: -5, // Mean may be positive, but 95% LCB <= 0 (lucky noise)
    capacityAnalysisMaxLamports: 10_000_000_000n,
  });

  assert.equal(report.isEligibleForCapitalPromotion, false);
  assert.equal(report.completedStagesCount, 9);
  assert.ok(report.rejections.some((r) => r.includes('STAGE_9_FAILED: 95% LCB <= 0')));
});

test('SECTION 67: Approves strategy satisfying all 10 evidence stages in sequence', () => {
  const auditor = new ProfitabilityEvidenceAuditor();

  const report = auditor.auditStrategyPromotionEvidence({
    strategyId: 'strat_fully_proven_01',
    hasPointInTimeDataset: true,
    allAttemptDatasetSampleCount: 250,
    hasFullCostDeduction: true,
    walkForwardFoldsCount: 6,
    holdoutEvaluationClean: true,
    failureConditionedCalibrationPassed: true,
    shadowObservationHours: 72,
    canaryReconciledClean: true,
    lowerConfidenceBound95Bps: 45, // Statistically significant positive return
    capacityAnalysisMaxLamports: 100_000_000_000n, // 100 SOL capacity bound
  });

  assert.equal(report.isEligibleForCapitalPromotion, true);
  assert.equal(report.completedStagesCount, 10);
  assert.equal(report.rejections.length, 0);
  assert.equal(typeof report.auditDigest, 'string');
  assert.equal(report.auditDigest.length, 64);
});
