/**
 * SYLPH FUSION — MIGRATION SELECTION & CAUSAL EFFECT ENGINE
 * Studies: POST-MIGRATION-SELECTION-X, MIGRATION-CAUSAL-EFFECT-X (Section XI)
 *
 * Empirical finding from the 1.57M token audit:
 * Post-migration tokens show higher peak rates (41.76% reach >= 2x vs 14.32% overall).
 * HOWEVER: This is conditioning on survival through the bonding curve, not a causal
 * improvement. Buying arbitrary new launches cannot assume post-migration odds!
 * 72.29% of migrated tokens still ended below starting price.
 */
export class MigrationSelectionEngine {
    static evaluateCandidate(isMigrated, curveProgressPct) {
        if (typeof isMigrated !== 'boolean')
            throw new Error('MIGRATION_STATUS_MUST_BE_BOOLEAN');
        if (!Number.isFinite(curveProgressPct) || curveProgressPct < 0 || curveProgressPct > 100) {
            throw new Error('CURVE_PROGRESS_MUST_BE_FINITE_PERCENT');
        }
        if (!isMigrated) {
            return {
                isMigrated: false,
                baseline2xRate: 0.1432,
                givebackRate: 0.8036,
                causalEffectValid: true,
                survivorshipBiasPenalty: 0.0,
                reason: 'Unconditioned launch population: base rate 14.32% 2x, 80.36% failure',
                evidenceStatus: 'UNVERIFIED_REFERENCE_PRIOR',
                curveProgressPct,
            };
        }
        // Candidate has graduated to Raydium/DEX
        return {
            isMigrated: true,
            baseline2xRate: 0.4176,
            givebackRate: 0.7229,
            causalEffectValid: false, // Cannot be projected backward onto unbonded launches
            survivorshipBiasPenalty: 0.35, // Discounted for conditioning on curve survival
            reason: 'Post-migration selected population: conditioning on curve survival creates upward selection bias; 72.29% giveback rate retained',
            evidenceStatus: 'UNVERIFIED_REFERENCE_PRIOR',
            curveProgressPct,
        };
    }
}
//# sourceMappingURL=migration-selection.js.map