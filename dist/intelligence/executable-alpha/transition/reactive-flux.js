/**
 * SYLPH FUSION — REACTIVE FLUX ENGINE
 * Study 18: REACTIVE-FLUX-X (Section XII)
 *
 * Implements reactive probability flux J_{AB} from state A to state B in transition path theory.
 * J_{AB} = \int_{S} \rho(x) (\nabla q^+(x)) \cdot n(x) dx
 * Measures the net throughput rate of trajectories transitioning from normal volatility to runner basin.
 */
export class ReactiveFluxEngine {
    static computeFlux(params) {
        const { qUp, qFail, arrivalVelocityTradesPerSec, capitalFlowNetUsdPerSec, poolDepthUsd, } = params;
        // Forward flux gradient (normalized capital arrival rate * qUp)
        const forwardFlux = qUp * (Math.max(0, capitalFlowNetUsdPerSec) / Math.max(100, poolDepthUsd));
        // Backward leakage to failure sink
        const backwardSinkLeakage = qFail * 0.002 * Math.max(0.1, arrivalVelocityTradesPerSec);
        const netFluxRatePerSec = forwardFlux - backwardSinkLeakage;
        const isNetForwardPositive = netFluxRatePerSec > 0;
        let bottleneck = 'NONE';
        if (capitalFlowNetUsdPerSec <= 0) {
            bottleneck = 'NEGATIVE_NET_CAPITAL_FLOW';
        }
        else if (backwardSinkLeakage > forwardFlux) {
            bottleneck = 'FAILURE_SINK_ABSORPTION_EXCESS';
        }
        else if (poolDepthUsd < 2500) {
            bottleneck = 'SHALLOW_POOL_SLIPPAGE_BARRIER';
        }
        return {
            netFluxRatePerSec,
            isNetForwardPositive,
            probabilityLeakageToSink: backwardSinkLeakage,
            criticalBottleneckSurface: bottleneck,
        };
    }
}
//# sourceMappingURL=reactive-flux.js.map