/** Descriptive price comparisons, not executable counterfactual fills. */
export class CounterfactualEngine {
    evaluateDecision(mint, decisionTaken, outcome) {
        if (outcome.schemaVersion !== '2.0.0' || outcome.labelVersion !== 'outcome_label_v2_bounded_observation')
            throw new Error('UNSUPPORTED_OUTCOME_VERSION');
        const price = (h) => outcome.checkpoints[h]?.status === 'OBSERVED' ? outcome.checkpoints[h].recordedPriceUsd : undefined;
        const end = price('1m');
        const compare = (start) => {
            if (start === undefined || end === undefined)
                return [null, 'MISSING_CHECKPOINT'];
            if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end) || end < 0)
                return [null, 'INVALID_PRICE'];
            const result = ((end - start) / start) * 100;
            return Number.isFinite(result) ? [result, null] : [null, 'RETURN_OVERFLOW'];
        };
        const now = compare(outcome.entryPriceUsd), wait5 = compare(price('5s')), wait15 = compare(price('15s'));
        const eligible = outcome.labelStatus === 'RESOLVED' && outcome.primaryLabel !== null;
        const bad = eligible && ['RUG', 'HARD_DUMP', 'FAILED'].includes(outcome.primaryLabel);
        const runner = eligible && ['RUNNER', 'MAJOR_RUNNER'].includes(outcome.primaryLabel);
        const tp = decisionTaken === 'ENTER' && runner, tn = decisionTaken === 'REJECT' && bad;
        const fp = decisionTaken === 'ENTER' && bad, fn = decisionTaken === 'REJECT' && runner;
        return {
            schemaVersion: '2.0.0', mint, evaluatedAtMs: outcome.evaluationCutoffMs, decisionTaken, actualOutcome: outcome,
            counterfactualReturns: { enterNowPct: now[0], wait5sPct: wait5[0], wait15sPct: wait15[0] },
            unavailableReasons: { enterNowPct: now[1], wait5sPct: wait5[1], wait15sPct: wait15[1] },
            filterAssessment: { status: eligible ? 'ELIGIBLE' : 'INELIGIBLE', isTruePositive: tp, isTrueNegative: tn,
                isFalsePositive: fp, isFalseNegative: fn, filterValueScore: eligible ? Number(tp) + Number(tn) - 1.5 * Number(fp) - 0.8 * Number(fn) : null },
        };
    }
}
//# sourceMappingURL=counterfactual.js.map