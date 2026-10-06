/**
 * SYLPH FUSION — TRANSITION PATH THEORY (TPT) ENGINE
 * Study 17: TRANSITION-PATH-X (Section XII)
 *
 * Models state transitions from uncommitted launch (State A) to extreme runner basin (State B).
 * Computes reactive trajectory density, probability flux, and mean first passage times.
 */
export class TransitionPathEngine {
    static analyzePath(params) {
        const { qUp, qFail, effectiveDrift, diffusionVariance, distanceToTargetMultiple } = params;
        // Reactivity probability: P(trajectory is reactive from A to B) = qUp * (1 - qFail)
        const reactiveProb = Math.max(0, Math.min(1, qUp * (1.0 - qFail)));
        // Approximate Kramers-Moyal first passage time in continuous space:
        // \tau = \Delta x / \mu + \sigma^2 / (2 \mu^2)
        const drift = Math.max(0.01, effectiveDrift);
        const variance = Math.max(0.001, diffusionVariance);
        const mfptSeconds = Math.max(1.0, (distanceToTargetMultiple / drift) + (variance / (2 * drift * drift)));
        const pathViability = reactiveProb > 0.05 ? reactiveProb / (reactiveProb + qFail) : 0.0;
        let pathDescription = 'DIFFUSIVE_SUB_CRITICAL: Insufficient forward flux';
        if (pathViability > 0.60 && effectiveDrift > 0.10) {
            pathDescription = 'SUPER_CRITICAL_DIRECT_BALLISTIC: High direct forward probability current';
        }
        else if (pathViability > 0.30) {
            pathDescription = 'METASTABLE_STOCHASTIC_TUNNELING: Subject to stochastic barriers';
        }
        return {
            stateA: 'CROSSING_2X',
            stateB: 'RUNNER_10X',
            meanFirstPassageTimeSeconds: mfptSeconds,
            reactiveTrajectoryProbability: reactiveProb,
            dominantPathDescription: pathDescription,
            pathViabilityRatio: pathViability,
        };
    }
}
//# sourceMappingURL=transition-path.js.map