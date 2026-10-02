import type { OutcomeTruthRecord } from './outcome-truth.js';
export interface CounterfactualComparison {
  readonly schemaVersion: '2.0.0';
  readonly mint: string;
  readonly evaluatedAtMs: number;
  readonly decisionTaken: 'ENTER' | 'REJECT' | 'WAIT';
  readonly actualOutcome: OutcomeTruthRecord;
  readonly counterfactualReturns: { readonly enterNowPct: number | null; readonly wait5sPct: number | null; readonly wait15sPct: number | null };
  readonly unavailableReasons: { readonly enterNowPct: string | null; readonly wait5sPct: string | null; readonly wait15sPct: string | null };
  readonly filterAssessment: {
    readonly status: 'ELIGIBLE' | 'INELIGIBLE';
    readonly isTruePositive: boolean; readonly isTrueNegative: boolean;
    readonly isFalsePositive: boolean; readonly isFalseNegative: boolean;
    readonly filterValueScore: number | null;
  };
}
/** Descriptive price comparisons, not executable counterfactual fills. */
export class CounterfactualEngine {
  public evaluateDecision(mint: string, decisionTaken: 'ENTER' | 'REJECT' | 'WAIT', outcome: OutcomeTruthRecord): CounterfactualComparison {
    if (outcome.schemaVersion !== '2.0.0' || outcome.labelVersion !== 'outcome_label_v2_bounded_observation') throw new Error('UNSUPPORTED_OUTCOME_VERSION');
    const price = (h: '5s' | '15s' | '1m') => outcome.checkpoints[h]?.status === 'OBSERVED' ? outcome.checkpoints[h].recordedPriceUsd : undefined;
    const end = price('1m');
    const compare = (start: number | undefined): [number | null, string | null] => {
      if (start === undefined || end === undefined) return [null, 'MISSING_CHECKPOINT'];
      if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end) || end < 0) return [null, 'INVALID_PRICE'];
      const result = ((end - start) / start) * 100;
      return Number.isFinite(result) ? [result, null] : [null, 'RETURN_OVERFLOW'];
    };
    const now = compare(outcome.entryPriceUsd), wait5 = compare(price('5s')), wait15 = compare(price('15s'));
    const eligible = outcome.labelStatus === 'RESOLVED' && outcome.primaryLabel !== null;
    const bad = eligible && ['RUG', 'HARD_DUMP', 'FAILED'].includes(outcome.primaryLabel!);
    const runner = eligible && ['RUNNER', 'MAJOR_RUNNER'].includes(outcome.primaryLabel!);
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
