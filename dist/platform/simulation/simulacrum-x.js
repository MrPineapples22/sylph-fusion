/** Constant-product research scenarios only. Not a protocol quote, RPC simulation,
 * landing prediction, execution certificate, or authorization. Production Pump
 * economics remain in Market's SDK-backed quote path. All costs are assumptions.
 */
import { createHash } from 'node:crypto';
function amount(name, value, positive = false) {
    if (typeof value !== 'bigint' || value < (positive ? 1n : 0n) || value > 18446744073709551615n)
        throw new Error(`${name} must be a ${positive ? 'positive' : 'nonnegative'} u64 bigint`);
}
function integer(name, value, max = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < 0 || value > max)
        throw new Error(`${name} is invalid`);
}
function hash(value) {
    return createHash('sha256').update(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v)).digest('hex');
}
export class SimulacrumXEngine {
    simulateExecution(context, params, nowMs) {
        if (context.model !== 'CONSTANT_PRODUCT_SCENARIO')
            throw new Error('Unsupported research model');
        integer('observedAtMs', nowMs);
        integer('maxPriceImpactBps', params.maxPriceImpactBps, 10_000);
        if (typeof params.economicIntentId !== 'string' || !params.economicIntentId.trim())
            throw new Error('economicIntentId required');
        if (params.side !== 'BUY' && params.side !== 'SELL')
            throw new Error('Invalid side');
        if ((params.side === 'BUY' && 'inputTokenRaw' in params) || (params.side === 'SELL' && 'inputLamports' in params))
            throw new Error('Conflicting input denomination');
        amount('solReserveLamports', context.solReserveLamports, true);
        amount('tokenReserveRaw', context.tokenReserveRaw, true);
        amount('walletSolLamports', context.walletSolLamports);
        amount('walletTokenRaw', context.walletTokenRaw);
        amount('assumedNetworkCostLamports', params.assumedNetworkCostLamports);
        amount('assumedRouteCostLamports', params.assumedRouteCostLamports);
        amount('assumedAdverseCostLamports', params.assumedAdverseCostLamports);
        const input = params.side === 'BUY' ? params.inputLamports : params.inputTokenRaw;
        amount('input', input, true);
        const inputReserve = params.side === 'BUY' ? context.solReserveLamports : context.tokenReserveRaw;
        const outputReserve = params.side === 'BUY' ? context.tokenReserveRaw : context.solReserveLamports;
        const output = outputReserve * input / (inputReserve + input);
        const costs = params.assumedNetworkCostLamports + params.assumedRouteCostLamports + params.assumedAdverseCostLamports;
        const solCashDeltaLamports = params.side === 'BUY' ? -(input + costs) : output - costs;
        // Snapshot known fields explicitly; ignore unrelated caller properties and retain no mutable aliases.
        const assumptions = Object.freeze({ model: context.model, solReserveLamports: context.solReserveLamports,
            tokenReserveRaw: context.tokenReserveRaw, walletSolLamports: context.walletSolLamports, walletTokenRaw: context.walletTokenRaw,
            economicIntentId: params.economicIntentId, side: params.side,
            ...(params.side === 'BUY' ? { inputLamports: input } : { inputTokenRaw: input }),
            assumedNetworkCostLamports: params.assumedNetworkCostLamports, assumedRouteCostLamports: params.assumedRouteCostLamports,
            assumedAdverseCostLamports: params.assumedAdverseCostLamports, maxPriceImpactBps: params.maxPriceImpactBps });
        const payload = { evidenceClass: 'RESEARCH_ONLY_SYNTHETIC', isSimulationCertificate: false,
            modelVersion: 'SIMULACRUM-RESEARCH-2', economicIntentId: params.economicIntentId, side: params.side,
            observedAtMs: nowMs, assumptions, outputLamports: params.side === 'SELL' ? output : 0n,
            outputTokenRaw: params.side === 'BUY' ? output : 0n, tokenDeltaRaw: params.side === 'BUY' ? output : -input,
            solCashDeltaLamports, assumedTotalCostsLamports: costs,
            priceImpactBps: Number((input * 10000n + inputReserve + input - 1n) / (inputReserve + input)),
            priceImpactLimitExceeded: input * 10000n > BigInt(params.maxPriceImpactBps) * (inputReserve + input),
            // Conservative upfront cost funding, including modeled adverse cost, even on SELL.
            walletFeasibleUnderAssumptions: context.walletSolLamports >= costs + (params.side === 'BUY' ? input : 0n)
                && (params.side === 'BUY' || context.walletTokenRaw >= input) };
        return Object.freeze({ ...payload, scenarioHash: hash(payload) });
    }
    /** Compare signed SOL cash deltas in one denomination, never BUY principal to exit proceeds.
     * A fixed threshold is a research policy, not a statistical or execution-quality certificate. */
    evaluateResiduals(estimate, observedSolCashDeltaLamports, thresholdBps = 1500) {
        integer('thresholdBps', thresholdBps, 10_000);
        if (typeof observedSolCashDeltaLamports !== 'bigint')
            throw new Error('Observed cash delta must be bigint');
        const predicted = estimate.solCashDeltaLamports;
        if (typeof predicted !== 'bigint')
            throw new Error('Predicted cash delta must be bigint');
        const abs = (x) => x < 0n ? -x : x;
        const residualErrorLamports = abs(predicted - observedSolCashDeltaLamports);
        const baseline = abs(predicted);
        return Object.freeze({ residualErrorLamports, errorRatioBps: baseline === 0n ? null : residualErrorLamports * 10000n / baseline,
            status: baseline === 0n ? 'ZERO_BASELINE_UNDEFINED' : residualErrorLamports * 10000n > baseline * BigInt(thresholdBps)
                ? 'POLICY_THRESHOLD_EXCEEDED' : 'WITHIN_POLICY_THRESHOLD', thresholdBps });
    }
}
//# sourceMappingURL=simulacrum-x.js.map