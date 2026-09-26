import { createHash } from 'node:crypto';
const nonNegative = (name, value) => {
    if (value < 0n)
        throw new Error(`${name}_MUST_BE_NON_NEGATIVE`);
};
const finitePositive = (name, value) => {
    if (!Number.isFinite(value) || value <= 0)
        throw new Error(`${name}_MUST_BE_FINITE_AND_POSITIVE`);
};
const canonicalize = (value) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
export function totalEconomicCost(costs) {
    for (const [name, value] of Object.entries(costs))
        nonNegative(name, value);
    return costs.networkFeeLamports + costs.priorityFeeLamports + costs.jitoTipLamports +
        costs.routeFeeLamports + costs.failedTransactionCostLamports + costs.estimatedMevLamports +
        costs.estimatedSlippageLamports;
}
/** Reject impossible temporal traces rather than turning them into favorable economics. */
export function assertExecutionTimeline(timestamps) {
    if (!Number.isSafeInteger(timestamps.decidedAtMs) || timestamps.decidedAtMs <= 0)
        throw new Error('INVALID_DECISION_TIME');
    const values = [timestamps.quotedAtMs, timestamps.signedAtMs, timestamps.submittedAtMs, timestamps.landedAtMs, timestamps.confirmedAtMs, timestamps.finalizedAtMs];
    let previous = timestamps.decidedAtMs;
    for (const value of values) {
        if (value === undefined)
            continue;
        if (!Number.isSafeInteger(value) || value < previous)
            throw new Error('NON_MONOTONIC_EXECUTION_TIMELINE');
        previous = value;
    }
}
export function createEconomicDecisionCertificate(input) {
    if (!input.decisionId || !input.mint)
        throw new Error('DECISION_ID_AND_MINT_REQUIRED');
    finitePositive('DECISION_PRICE', input.prices.decisionPriceUsd);
    for (const [name, price] of Object.entries(input.prices))
        if (price !== undefined)
            finitePositive(name, price);
    nonNegative('QUANTITY', input.quantityAtomic);
    nonNegative('UNCERTAINTY', input.uncertaintyLamports ?? 0n);
    assertExecutionTimeline(input.timestamps);
    const totalCostLamports = totalEconomicCost(input.costs);
    const netPnlLamports = input.grossPnlLamports - totalCostLamports;
    const finalized = input.prices.finalizedPriceUsd;
    const decisionToFinalizedSlippageBps = finalized === undefined
        ? undefined
        : Math.round(((finalized - input.prices.decisionPriceUsd) / input.prices.decisionPriceUsd) * 10_000);
    const decisionToFinalizedLatencyMs = input.timestamps.finalizedAtMs === undefined
        ? undefined
        : input.timestamps.finalizedAtMs - input.timestamps.decidedAtMs;
    const netPnlPerSecondLamports = input.expectedHoldSeconds && input.expectedHoldSeconds > 0
        ? (netPnlLamports / BigInt(Math.ceil(input.expectedHoldSeconds))).toString()
        : undefined;
    const payload = {
        schemaVersion: '1.0.0', decisionId: input.decisionId, mint: input.mint,
        evidenceClass: input.evidenceClass, prices: input.prices, timestamps: input.timestamps,
        quantityAtomic: input.quantityAtomic.toString(), grossPnlLamports: input.grossPnlLamports.toString(),
        totalCostLamports: totalCostLamports.toString(), netPnlLamports: netPnlLamports.toString(),
        decisionToFinalizedSlippageBps, decisionToFinalizedLatencyMs, netPnlPerSecondLamports,
        uncertaintyLamports: (input.uncertaintyLamports ?? 0n).toString(),
    };
    return { ...payload, integrityHash: createHash('sha256').update(canonicalize(payload)).digest('hex') };
}
export function verifyEconomicDecisionCertificate(certificate) {
    const { integrityHash, ...payload } = certificate;
    return integrityHash === createHash('sha256').update(canonicalize(payload)).digest('hex');
}
/** A conservative comparison unit for paper/shadow opportunity ranking. */
export function certaintyEquivalentNetPnlLamports(params) {
    const uncertaintyPenalty = params.uncertaintyPenalty ?? 1n;
    const tailPenalty = params.tailPenalty ?? 1n;
    // Expected net PnL may legitimately be negative.  Risk amounts and penalty
    // multipliers are magnitudes and must never be allowed to offset losses.
    nonNegative('UNCERTAINTY', params.uncertaintyLamports);
    nonNegative('EXPECTED_SHORTFALL', params.expectedShortfallLamports);
    nonNegative('UNCERTAINTY_PENALTY', uncertaintyPenalty);
    nonNegative('TAIL_PENALTY', tailPenalty);
    return params.expectedNetPnlLamports - params.uncertaintyLamports * uncertaintyPenalty - params.expectedShortfallLamports * tailPenalty;
}
//# sourceMappingURL=economic-ledger.js.map