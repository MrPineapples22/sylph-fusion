/**
 * SYLPH FUSION — INFORMATION FRONTIER & EARLIEST DECISION TIME
 * Studies: EARLIEST-INFORMATION-TIME-X, INFORMATION-VELOCITY-X (Section IX)
 *
 * Core formulation:
 * T^*_{10X} = inf { t : I(X_{<= t}; Y_{10X}) >= I_{min} }
 * Before T^*: ABSTAIN_INFORMATION_INSUFFICIENT.
 * Evaluates whether enough mutual information has accumulated to support trading.
 */
export class InformationFrontierEngine {
    static evaluate(elapsedSeconds, observationsCount, featureCount, targetMultiple = 10.0) {
        // I_min for 10x is higher due to rarity (base rate 0.397%)
        const minRequiredNats = targetMultiple >= 10.0 ? 0.45 : targetMultiple >= 2.0 ? 0.25 : 0.15;
        // Information accumulation model: logarithmic with observation count and time
        // saturated by feature noise
        const timeFactor = 1.0 - Math.exp(-elapsedSeconds / 45.0);
        const sampleFactor = 1.0 - Math.exp(-observationsCount / 8.0);
        const mutualInformationNats = Number((0.65 * timeFactor * sampleFactor).toFixed(4));
        // Information velocity dI/dt
        const informationVelocity = Number(((0.65 / 45.0) * Math.exp(-elapsedSeconds / 45.0) * sampleFactor).toFixed(5));
        // Information acceleration d^2I/dt^2
        const informationAcceleration = Number((-1.0 * (informationVelocity / 45.0)).toFixed(6));
        // T^* computation: solving for when I(t) >= minRequiredNats
        let earliestDecisionTimeSeconds = 30.0;
        if (sampleFactor > 0.5) {
            const ratio = minRequiredNats / (0.65 * sampleFactor);
            if (ratio < 1.0) {
                earliestDecisionTimeSeconds = Math.max(5.0, -45.0 * Math.log(1.0 - ratio));
            }
            else {
                earliestDecisionTimeSeconds = 180.0; // Needs significant time
            }
        }
        const isSufficient = mutualInformationNats >= minRequiredNats && elapsedSeconds >= earliestDecisionTimeSeconds;
        const reason = !isSufficient
            ? `ABSTAIN_INFORMATION_INSUFFICIENT: I(t)=${mutualInformationNats} nats < I_min=${minRequiredNats} nats or elapsed=${elapsedSeconds.toFixed(1)}s < T*=${earliestDecisionTimeSeconds.toFixed(1)}s`
            : undefined;
        return {
            mutualInformationNats,
            minRequiredNats,
            informationVelocity,
            informationAcceleration,
            earliestDecisionTimeSeconds,
            currentElapsedSeconds: elapsedSeconds,
            isSufficient,
            reason,
        };
    }
}
//# sourceMappingURL=information-frontier.js.map