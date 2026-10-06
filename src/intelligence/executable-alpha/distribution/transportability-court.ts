/**
 * SYLPH FUSION — TRANSPORTABILITY COURT
 * Study Family 4: Distribution Shift (Section XI)
 * Studies: POST-MIGRATION-SELECTION-X, MIGRATION-CAUSAL-EFFECT-X, REGIME-TRANSPORTABILITY-X, FIXED-REFERENCE-SHIFT-X
 *
 * Adjudicates whether historical or simulated models can be legally transported
 * to prospective live candidate populations.
 */

import { createHash } from 'node:crypto';
import type { DistributionValidityCertificate } from '../types.js';
import { RegimeTransportEngine, type MarketRegimeType } from './regime-transport.js';
import { MigrationSelectionEngine } from './migration-selection.js';
import { FixedReferenceShiftEngine } from './fixed-reference-shift.js';

export interface TransportabilityCourtRuling {
  readonly admissible: boolean;
  readonly certificate: DistributionValidityCertificate;
  readonly migrationSurvivorshipHaircut: number;
  readonly referenceCurrencyStability: number;
  readonly evidenceRoot: string;
  readonly judicialRationale: string;
}

export class TransportabilityCourt {
  public static judge(params: {
    sourceRegime: MarketRegimeType;
    targetRegime: MarketRegimeType;
    covariateShift?: number;
    conceptShift?: number;
    calibrationShift?: number;
    isPostMigrationSample?: boolean;
    solUsdVolatilityRatio?: number;
  }): TransportabilityCourtRuling {
    if (typeof params.isPostMigrationSample !== 'undefined' && typeof params.isPostMigrationSample !== 'boolean') {
      throw new Error('MIGRATION_STATUS_MUST_BE_BOOLEAN');
    }
    const {
      sourceRegime,
      targetRegime,
      covariateShift = 0.12,
      conceptShift = 0.08,
      calibrationShift = 0.04,
      isPostMigrationSample = false,
      solUsdVolatilityRatio = 1.05,
    } = params;
    if (!Number.isFinite(solUsdVolatilityRatio) || solUsdVolatilityRatio <= 0) {
      throw new Error('SOL_USD_VOLATILITY_RATIO_MUST_BE_FINITE_POSITIVE');
    }

    // 1. Base regime transport evaluation
    const cert = RegimeTransportEngine.evaluateTransportability(
      sourceRegime,
      targetRegime,
      covariateShift,
      conceptShift,
      calibrationShift
    );

    // 2. Migration survivorship calculation
    const migrationAnalysis = MigrationSelectionEngine.evaluateCandidate(isPostMigrationSample, 100);
    const migrationHaircut = migrationAnalysis.survivorshipBiasPenalty;

    // 3. Fixed reference shift (SOL vs USD denomination)
    const refAnalysis = FixedReferenceShiftEngine.calculateReturn(1.0, 1.0, 'SOL', 150, 150 * solUsdVolatilityRatio);
    if (!refAnalysis.isValidBaseline) throw new Error('REFERENCE_SHIFT_BASELINE_INVALID');
    // Provisional policy threshold and multiplier; these are not calibrated from a verified point-in-time dataset.
    const currencyStability = refAnalysis.currencyDivergenceBps < 1500 ? 1.0 : 0.65;

    // Ruling logic
    const blockers = [...cert.blockers];
    if (isPostMigrationSample && targetRegime === 'NEW_LAUNCH') {
      blockers.push('MIGRATION_SELECTION_VIOLATION: Conditioned on post-migration survival');
    }
    if (currencyStability < 0.80) {
      blockers.push('REFERENCE_SHIFT_UNSTABLE: High SOL/USD divergence distorts return denomination');
    }

    const admissible = blockers.length === 0;

    const evidenceRoot = createHash('sha256')
      .update([
        cert.certificateDigest,
        sourceRegime,
        targetRegime,
        covariateShift.toFixed(8),
        conceptShift.toFixed(8),
        calibrationShift.toFixed(8),
        isPostMigrationSample ? 'POST_MIGRATION' : 'UNCONDITIONED',
        solUsdVolatilityRatio.toFixed(8),
        refAnalysis.currencyDivergenceBps.toString(),
        'CURRENCY_THRESHOLD_BPS=1500',
        'CURRENCY_STABILITY_BELOW_THRESHOLD=0.65',
        migrationHaircut.toFixed(4),
        currencyStability.toFixed(4),
        admissible ? 'ADMISSIBLE' : 'DISMISSED',
      ].join('::'))
      .digest('hex');

    const rationale = admissible
      ? `Model transport admissible from ${sourceRegime} to ${targetRegime} with covariate shift ${covariateShift.toFixed(2)}`
      : `Transport dismissed due to: ${blockers.join('; ')}`;

    return {
      admissible,
      certificate: {
        ...cert,
        blockers,
        transportable: admissible,
      },
      migrationSurvivorshipHaircut: migrationHaircut,
      referenceCurrencyStability: currencyStability,
      evidenceRoot,
      judicialRationale: rationale,
    };
  }
}
