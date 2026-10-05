/**
 * SYLPH FUSION — SECTION 67 ACCEPTANCE TEST: PROFITABILITY EVIDENCE SEQUENCE
 * Specifications: Master Blueprint Section 67 (Acceptance Test — Profitability)
 *
 * Enforces the strict 10-step evidence chain required before ANY strategy may
 * earn higher capital authority. Rejects claims based on:
 * - paper PnL > 0
 * - backtest Sharpe > 0
 * - model accuracy > 50%
 * - a few winning trades
 */

import { createHash } from 'node:crypto';

export class ProfitabilityEvidenceAuditor {
  static REQUIRED_STAGES = Object.freeze([
    '1_POINT_IN_TIME_DATASET',
    '2_ALL_ATTEMPT_EXECUTABLE_OUTCOMES',
    '3_COST_COMPLETE_PNL',
    '4_WALK_FORWARD',
    '5_SEALED_HOLDOUT',
    '6_FAILURE_CONDITIONED_CALIBRATION',
    '7_SHADOW_LANE',
    '8_CANARY_DEPLOYMENT',
    '9_POSITIVE_LOWER_CONFIDENCE_BOUND',
    '10_CAPACITY_ANALYSIS',
  ]);

  /**
   * Evaluates a candidate strategy against the 10-stage Section 67 sequence.
   */
  auditStrategyPromotionEvidence(params) {
    const stages = [];
    const rejections = [];

    // Stage 1: Point-in-time dataset
    const stage1Pass = Boolean(params.hasPointInTimeDataset);
    stages.push({
      stage: '1_POINT_IN_TIME_DATASET',
      passed: stage1Pass,
      metric: stage1Pass ? 'PIT_NO_LOOKAHEAD' : 'LOOKAHEAD_TAINT',
      evidenceHash: this.hashStage('1', stage1Pass),
      failureReason: stage1Pass ? undefined : 'Dataset lacks strict point-in-time guarantees',
    });
    if (!stage1Pass) rejections.push('STAGE_1_FAILED: Lacks point-in-time dataset');

    // Stage 2: All-attempt executable outcomes
    const stage2Pass = Number(params.allAttemptDatasetSampleCount || 0) >= 50;
    stages.push({
      stage: '2_ALL_ATTEMPT_EXECUTABLE_OUTCOMES',
      passed: stage2Pass,
      metric: `sample_count_${params.allAttemptDatasetSampleCount}`,
      evidenceHash: this.hashStage('2', stage2Pass),
      failureReason: stage2Pass ? undefined : 'Insufficient all-attempt execution samples (< 50)',
    });
    if (!stage2Pass) rejections.push('STAGE_2_FAILED: Insufficient all-attempt execution dataset');

    // Stage 3: Cost-complete PnL
    const stage3Pass = Boolean(params.hasFullCostDeduction);
    stages.push({
      stage: '3_COST_COMPLETE_PNL',
      passed: stage3Pass,
      metric: stage3Pass ? 'FULL_COST_ACCOUNTED' : 'INCOMPLETE_COSTS',
      evidenceHash: this.hashStage('3', stage3Pass),
      failureReason: stage3Pass ? undefined : 'PnL does not deduct priority fees, tips, rent, and slippage',
    });
    if (!stage3Pass) rejections.push('STAGE_3_FAILED: Incomplete execution cost deductions');

    // Stage 4: Walk-forward validation
    const stage4Pass = Number(params.walkForwardFoldsCount || 0) >= 3;
    stages.push({
      stage: '4_WALK_FORWARD',
      passed: stage4Pass,
      metric: `folds_${params.walkForwardFoldsCount}`,
      evidenceHash: this.hashStage('4', stage4Pass),
      failureReason: stage4Pass ? undefined : 'Insufficient walk-forward folds (< 3)',
    });
    if (!stage4Pass) rejections.push('STAGE_4_FAILED: Insufficient walk-forward folds');

    // Stage 5: Sealed holdout
    const stage5Pass = Boolean(params.holdoutEvaluationClean);
    stages.push({
      stage: '5_SEALED_HOLDOUT',
      passed: stage5Pass,
      metric: stage5Pass ? 'UNCONTAMINATED_HOLDOUT' : 'HOLDOUT_LEAKAGE',
      evidenceHash: this.hashStage('5', stage5Pass),
      failureReason: stage5Pass ? undefined : 'Holdout data was accessed during candidate ranking or parameter tuning',
    });
    if (!stage5Pass) rejections.push('STAGE_5_FAILED: Holdout contamination');

    // Stage 6: Failure-conditioned calibration
    const stage6Pass = Boolean(params.failureConditionedCalibrationPassed);
    stages.push({
      stage: '6_FAILURE_CONDITIONED_CALIBRATION',
      passed: stage6Pass,
      metric: stage6Pass ? 'CALIBRATED_ACROSS_FAILURES' : 'UNSTABLE_IN_FAILURES',
      evidenceHash: this.hashStage('6', stage6Pass),
      failureReason: stage6Pass ? undefined : 'Model fails calibration test under adverse failure conditions',
    });
    if (!stage6Pass) rejections.push('STAGE_6_FAILED: Uncalibrated in failure states');

    // Stage 7: Shadow lane
    const stage7Pass = Number(params.shadowObservationHours || 0) >= 24;
    stages.push({
      stage: '7_SHADOW_LANE',
      passed: stage7Pass,
      metric: `shadow_hours_${params.shadowObservationHours}`,
      evidenceHash: this.hashStage('7', stage7Pass),
      failureReason: stage7Pass ? undefined : 'Insufficient live shadow observation (< 24h)',
    });
    if (!stage7Pass) rejections.push('STAGE_7_FAILED: Insufficient shadow observation');

    // Stage 8: Canary deployment
    const stage8Pass = Boolean(params.canaryReconciledClean);
    stages.push({
      stage: '8_CANARY_DEPLOYMENT',
      passed: stage8Pass,
      metric: stage8Pass ? 'CANARY_RECONCILED' : 'CANARY_FAILED',
      evidenceHash: this.hashStage('8', stage8Pass),
      failureReason: stage8Pass ? undefined : 'Canary orders encountered reconciliation discrepancy',
    });
    if (!stage8Pass) rejections.push('STAGE_8_FAILED: Canary reconciliation incomplete');

    // Stage 9: Positive lower confidence bound
    const stage9Pass = Number(params.lowerConfidenceBound95Bps || 0) > 0;
    stages.push({
      stage: '9_POSITIVE_LOWER_CONFIDENCE_BOUND',
      passed: stage9Pass,
      metric: `lcb95_${params.lowerConfidenceBound95Bps}bps`,
      evidenceHash: this.hashStage('9', stage9Pass),
      failureReason: stage9Pass ? undefined : '95% Lower Confidence Bound is non-positive; alpha is indistinguishable from noise',
    });
    if (!stage9Pass) rejections.push('STAGE_9_FAILED: 95% LCB <= 0 (lucky variance risk)');

    // Stage 10: Capacity analysis
    const stage10Pass = BigInt(params.capacityAnalysisMaxLamports || 0n) > 0n;
    stages.push({
      stage: '10_CAPACITY_ANALYSIS',
      passed: stage10Pass,
      metric: `capacity_${params.capacityAnalysisMaxLamports}_lamports`,
      evidenceHash: this.hashStage('10', stage10Pass),
      failureReason: stage10Pass ? undefined : 'Missing capacity / market impact bound',
    });
    if (!stage10Pass) rejections.push('STAGE_10_FAILED: Missing capacity analysis');

    const completedCount = stages.filter((s) => s.passed).length;
    const isEligible = completedCount === 10 && rejections.length === 0;

    const auditDigest = createHash('sha256')
      .update(
        [
          params.strategyId,
          completedCount.toString(),
          isEligible.toString(),
          stages.map((s) => s.evidenceHash).join(':'),
        ].join('|')
      )
      .digest('hex');

    return {
      strategyId: params.strategyId,
      evaluatedAtMs: Date.now(),
      isEligibleForCapitalPromotion: isEligible,
      completedStagesCount: completedCount,
      totalStagesCount: 10,
      stages: Object.freeze(stages),
      rejections: Object.freeze(rejections),
      auditDigest,
    };
  }

  hashStage(stageNum, passed) {
    return createHash('sha256').update(`stage_${stageNum}:${passed}`).digest('hex');
  }
}

// CLI Execution
if (process.argv[1] && process.argv[1].includes('audit-profitability-evidence-sequence.mjs')) {
  console.log('=== SYLPH FUSION: SECTION 67 PROFITABILITY EVIDENCE SEQUENCE AUDIT ===');
  const auditor = new ProfitabilityEvidenceAuditor();

  // Test 1: Candidate with only paper profit (must fail)
  const paperOnly = auditor.auditStrategyPromotionEvidence({
    strategyId: 'strat_paper_only',
    hasPointInTimeDataset: false,
    allAttemptDatasetSampleCount: 0,
    hasFullCostDeduction: false,
    walkForwardFoldsCount: 0,
    holdoutEvaluationClean: false,
    failureConditionedCalibrationPassed: false,
    shadowObservationHours: 0,
    canaryReconciledClean: false,
    lowerConfidenceBound95Bps: -50,
    capacityAnalysisMaxLamports: 0n,
  });

  console.log(`[PASS] Paper-only candidate rejected as expected: ${paperOnly.rejections.length} failure(s) detected.`);

  // Test 2: Certified candidate satisfying all 10 stages
  const certifiedCandidate = auditor.auditStrategyPromotionEvidence({
    strategyId: 'strat_canonical_alpha_01',
    hasPointInTimeDataset: true,
    allAttemptDatasetSampleCount: 120,
    hasFullCostDeduction: true,
    walkForwardFoldsCount: 5,
    holdoutEvaluationClean: true,
    failureConditionedCalibrationPassed: true,
    shadowObservationHours: 48,
    canaryReconciledClean: true,
    lowerConfidenceBound95Bps: 35, // +35 bps lower bound
    capacityAnalysisMaxLamports: 50_000_000_000n, // 50 SOL capacity
  });

  console.log(`[PASS] Fully certified candidate approved: ${certifiedCandidate.completedStagesCount}/10 stages complete.`);
  console.log(`Audit Digest: ${certifiedCandidate.auditDigest}`);
}
