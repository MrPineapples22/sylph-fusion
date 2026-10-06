/**
 * SYLPH FUSION — FAILURE COMMITTOR ENGINE
 * Study 16: FAILURE-COMMITTOR-X (Section XII)
 *
 * Implements backward failure committor function:
 * q_fail(x) = P(\tau_{failure} < \tau_{nextPositiveState} | X = x)
 *
 * Empirical Ground Truth:
 * - 80.36% of all launches end below initial price.
 * - 47.42% of tokens reaching >=2x end below initial start.
 * - 37.66% of tokens reaching >=10x later collapse below start.
 * - Median time to 50% post-peak drop: 5.13s.
 */
export const FAILURE_IMMINENT_THRESHOLD = 0.60;
export class FailureCommittorEngine {
    static computeFailureCommittor(params) {
        const { dtfScore, sellPressureRatio, creatorInventoryRatio, top3HoldersShare, liquidityDrainVelocity, } = params;
        for (const [name, value] of Object.entries({ dtfScore, sellPressureRatio, creatorInventoryRatio, top3HoldersShare, liquidityDrainVelocity })) {
            if (!Number.isFinite(value) || value < 0 || value > 1)
                throw new Error(`${name}_MUST_BE_FINITE_UNIT_INTERVAL`);
        }
        // Weighting empirical collapse vectors
        const riskScore = 0.30 * dtfScore +
            0.25 * sellPressureRatio +
            0.20 * creatorInventoryRatio +
            0.15 * top3HoldersShare +
            0.10 * Math.min(1.0, liquidityDrainVelocity * 5.0);
        // Baseline failure probability is high (0.47 for 2x tokens)
        const baseFailure = 0.4742;
        const qFail = Math.min(0.999, Math.max(0.05, baseFailure + (riskScore - 0.40) * 0.85));
        // Instantaneous hazard rate \lambda(t)
        const hazardRatePerSecond = riskScore * 0.15; // e.g., 0.05/sec -> half-life ~14s
        const expectedTimeToCollapseSeconds = Math.max(1.0, 1.0 / Math.max(0.001, hazardRatePerSecond));
        // Identify dominant failure mode
        let dominantFailureMode = 'BUYER_FATIGUE';
        if (creatorInventoryRatio > 0.15 || (creatorInventoryRatio > 0.05 && sellPressureRatio > 0.70)) {
            dominantFailureMode = 'CREATOR_DUMP';
        }
        else if (liquidityDrainVelocity > 0.02 || top3HoldersShare > 0.45) {
            dominantFailureMode = 'LIQUIDITY_EXHAUSTION';
        }
        else if (dtfScore > 0.70) {
            dominantFailureMode = 'ROTATION_EXTINCTION';
        }
        return {
            qFail,
            hazardRatePerSecond,
            expectedTimeToCollapseSeconds,
            failureImminent: qFail >= FAILURE_IMMINENT_THRESHOLD || dtfScore > 0.70,
            dominantFailureMode,
        };
    }
}
//# sourceMappingURL=failure-committor.js.map