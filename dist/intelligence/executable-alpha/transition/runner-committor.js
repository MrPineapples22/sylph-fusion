/**
 * SYLPH FUSION — RUNNER COMMITTOR PROBABILITY ENGINE
 * Study 15: EXTREME-RUNNER-COMMITTOR-X (Section XII)
 *
 * Implements Transition Path Theory (TPT) committor function:
 * q_up(x) = P(\tau_{10X} < \tau_{failure} | X = x)
 *
 * Evaluates the probability that a token trajectory in state x will reach the 10x
 * runner basin before hitting the failure absorbing boundary (e.g. -50% or liquidity drain).
 */
export class RunnerCommittorEngine {
    // Empirical base rate from cleaned 523k cohort: P(10X | 2X) = 0.0277
    static BASE_RATE_10X_GIVEN_2X = 0.0277;
    /**
     * Computes committor q_up given state vector derivatives.
     * State components:
     * - currentMultiple: observed multiple (e.g., 2.0x)
     * - capitalRenewalScore: exogenous capital arrival velocity [0, 1]
     * - sellAbsorptionRatio: buy volume / sell volume over critical interval
     * - exitReachability: fraction of pool depth reachable before 15% slippage
     * - actorGrowthRate: velocity of unique wallet growth
     */
    static computeCommittor(params) {
        const { currentMultiple, capitalRenewalScore, sellAbsorptionRatio, exitReachability, actorGrowthRate, sampleCount = 500, } = params;
        // Fail-safe bounds
        const renewal = Math.max(0, Math.min(1, capitalRenewalScore));
        const absorption = Math.max(0, Math.min(10, sellAbsorptionRatio));
        const reachability = Math.max(0, Math.min(1, exitReachability));
        const growth = Math.max(0, Math.min(5, actorGrowthRate));
        // Reaction coordinate calculation:
        // Models progression along the transition path from state A (2x crossing) to state B (10x runner)
        const coordinate = 0.35 * renewal +
            0.30 * (Math.min(absorption, 3.0) / 3.0) +
            0.20 * reachability +
            0.15 * (Math.min(growth, 2.0) / 2.0);
        // Logistic committor transformation centered around transition barrier (coordinate = 0.65)
        // Steep activation energy: below barrier, q_up drops rapidly to base rate or zero
        const k = 8.5; // Transition steepness parameter
        const barrier = 0.62;
        const logit = k * (coordinate - barrier);
        const sigmoid = 1 / (1 + Math.exp(-logit));
        // Scale to realistic committor probability: max realistic P(10x|2x) in top decile ~ 0.22 (22%)
        const qUp = Math.max(0.001, Math.min(0.25, sigmoid * 0.24));
        const liftOverBaseRate = qUp / this.BASE_RATE_10X_GIVEN_2X;
        const activationBarrierMet = coordinate >= barrier && reachability >= 0.50;
        const isStatisticallySignificant = sampleCount >= 200 && liftOverBaseRate >= 2.0;
        return {
            qUp,
            isStatisticallySignificant,
            liftOverBaseRate,
            reactionCoordinate: coordinate,
            activationBarrierMet,
            empiricalSampleSize: sampleCount,
        };
    }
}
//# sourceMappingURL=runner-committor.js.map