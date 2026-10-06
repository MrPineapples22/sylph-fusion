/**
 * SYLPH FUSION — LIQUIDITY REGENERATION ENGINE
 * Study 30: LIQUIDITY-REGENERATION-X (Section XIV)
 *
 * Measures the replenishment speed of pool liquidity following a large exit shock.
 * Evaluates whether market makers, copy-traders, or secondary liquidity replenish
 * the pool depth, or if the shock causes permanent liquidity evaporation.
 */
export class LiquidityRegenerationEngine {
    static measureRegeneration(params) {
        const { shockSizeUsd, depthImmediatelyAfterUsd, depthAt30sUsd, depthAt60sUsd, } = params;
        const recoveredAt60s = Math.max(0, depthAt60sUsd - depthImmediatelyAfterUsd);
        const regenerationRateUsdPerSec = recoveredAt60s / 60.0;
        const recoveryFraction = shockSizeUsd > 0 ? recoveredAt60s / shockSizeUsd : 0;
        // Hysteresis: permanent deficit left behind
        const preShockTarget = depthImmediatelyAfterUsd + shockSizeUsd;
        const hysteresisDeficitUsd = Math.max(0, preShockTarget - depthAt60sUsd);
        // Half life of recovery
        const recoveryFractionSafe = Math.max(0.01, Math.min(0.99, recoveryFraction));
        const recoveryHalfLifeSeconds = recoveryFractionSafe > 0.05
            ? Math.max(5.0, (0.5 / recoveryFractionSafe) * 60.0)
            : 999.0;
        const fullRecoveryProbability = Math.max(0, Math.min(1, recoveryFraction * 0.85));
        const isRegenerationRobust = recoveryFraction >= 0.50 && recoveryHalfLifeSeconds < 45.0;
        return {
            regenerationRateUsdPerSec,
            recoveryHalfLifeSeconds,
            fullRecoveryProbability,
            isRegenerationRobust,
            hysteresisDeficitUsd,
        };
    }
}
//# sourceMappingURL=liquidity-regeneration.js.map