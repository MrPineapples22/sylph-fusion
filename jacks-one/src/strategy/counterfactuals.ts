import type { OracleResult, HoldEvaluation } from '../engine_a/oracle.ts';
import { rationalToDecimalString, rationalToNumber } from '../core/rational.ts';

export interface CounterfactualExplanation {
  readonly selectedMask: number;
  readonly selectedHeldCards: string[];
  readonly selectedEV: string;
  readonly runnerUpMask: number;
  readonly runnerUpHeldCards: string[];
  readonly runnerUpEV: string;
  readonly evGapDecimal: number;
  readonly explanationSummary: string;
  readonly keyReasons: string[];
}

export function generateCounterfactualExplanation(result: OracleResult): CounterfactualExplanation {
  const sel = result.selectedHold;
  const runnerUp = result.allHolds[1];

  const selCards = sel.heldCards.map((c) => c.symbol);
  const runnerCards = runnerUp.heldCards.map((c) => c.symbol);

  const selEVStr = rationalToDecimalString(sel.exactEV, 4);
  const runnerEVStr = rationalToDecimalString(runnerUp.exactEV, 4);
  const evGapNum = rationalToNumber(result.evGap);

  const keyReasons: string[] = [];

  if (sel.heldCount === 4 && runnerUp.heldCount === 5) {
    keyReasons.push(`Breaking a made hand (${runnerCards.join(' ')}) is optimal because the 4-card draw offers significantly higher upside.`);
  }

  if (sel.heldCount === 2 && runnerUp.heldCount === 4) {
    keyReasons.push(`Retaining the pair (${selCards.join(' ')}) yields guaranteed value vs the unmade draw.`);
  }

  if (sel.heldCount === 0) {
    keyReasons.push('No paying combination, pair, or promising draw exists; drawing 5 fresh cards maximizes expected return.');
  }

  if (keyReasons.length === 0) {
    keyReasons.push(`Holding ${selCards.length > 0 ? selCards.join(' ') : 'nothing'} yields EV ${selEVStr} vs next best EV ${runnerEVStr}.`);
  }

  const explanationSummary = `Optimal hold is [${selCards.join(' ')}] with EV ${selEVStr}. Second best is [${runnerCards.join(' ')}] with EV ${runnerEVStr} (EV gap: +${evGapNum.toFixed(4)}).`;

  return {
    selectedMask: sel.mask,
    selectedHeldCards: selCards,
    selectedEV: selEVStr,
    runnerUpMask: runnerUp.mask,
    runnerUpHeldCards: runnerCards,
    runnerUpEV: runnerEVStr,
    evGapDecimal: evGapNum,
    explanationSummary,
    keyReasons,
  };
}
