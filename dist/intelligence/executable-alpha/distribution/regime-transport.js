/**
 * SYLPH FUSION — REGIME TRANSPORTABILITY ENGINE
 * Studies: REGIME-TRANSPORTABILITY-X, FIXED-REFERENCE-SHIFT-X (Section XI)
 *
 * Enforces strict population separation:
 * NEW_LAUNCH, BONDING_CURVE, MIGRATION_TRANSITION, POST_MIGRATION, MATURE_POOL.
 * Never pools them blindly. Evaluates covariate, concept, and calibration shift.
 */
import { createHash } from 'node:crypto';
const MARKET_REGIMES = new Set([
    'NEW_LAUNCH', 'BONDING_CURVE', 'MIGRATION_TRANSITION', 'POST_MIGRATION', 'MATURE_POOL',
]);
export class RegimeTransportEngine {
    static evaluateTransportability(sourceRegime, targetRegime, empiricalCovariateShift = 0.15, empiricalConceptShift = 0.10, calibrationShift = 0.05) {
        if (!MARKET_REGIMES.has(sourceRegime) || !MARKET_REGIMES.has(targetRegime)) {
            throw new Error('MARKET_REGIME_INVALID');
        }
        for (const [name, value] of [
            ['COVARIATE_SHIFT', empiricalCovariateShift],
            ['CONCEPT_SHIFT', empiricalConceptShift],
            ['CALIBRATION_SHIFT', calibrationShift],
        ]) {
            if (!Number.isFinite(value) || value < 0 || value > 1)
                throw new Error(`${name}_MUST_BE_FINITE_UNIT_INTERVAL`);
        }
        const blockers = [];
        // Blind pooling of NEW_LAUNCH and POST_MIGRATION is strictly forbidden
        if ((sourceRegime === 'POST_MIGRATION' && targetRegime === 'NEW_LAUNCH') ||
            (sourceRegime === 'NEW_LAUNCH' && targetRegime === 'POST_MIGRATION')) {
            blockers.push('CROSS_POPULATION_SELECTION_BIAS: Post-migration survival cannot be mapped to unconditioned launches');
        }
        if (empiricalCovariateShift > 0.40) {
            blockers.push(`COVARIATE_SHIFT_EXCESSIVE: Distance=${empiricalCovariateShift.toFixed(2)} exceeds 0.40`);
        }
        if (empiricalConceptShift > 0.35) {
            blockers.push(`CONCEPT_SHIFT_EXCESSIVE: Distance=${empiricalConceptShift.toFixed(2)} exceeds 0.35`);
        }
        if (calibrationShift > 0.25) {
            blockers.push(`CALIBRATION_SHIFT_EXCESSIVE: Error=${calibrationShift.toFixed(2)} exceeds 0.25`);
        }
        const transportable = blockers.length === 0;
        const digest = createHash('sha256')
            .update([
            sourceRegime,
            targetRegime,
            empiricalCovariateShift.toFixed(4),
            empiricalConceptShift.toFixed(4),
            calibrationShift.toFixed(4),
            transportable ? 'TRUE' : 'FALSE',
            blockers.join(','),
        ].join('::'))
            .digest('hex');
        return {
            sourceRegime,
            targetRegime,
            covariateShift: empiricalCovariateShift,
            conceptShift: empiricalConceptShift,
            calibrationShift,
            transportable,
            blockers,
            certificateDigest: digest,
        };
    }
}
//# sourceMappingURL=regime-transport.js.map