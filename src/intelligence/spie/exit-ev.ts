/**
 * Deterministic, cost-aware comparison for an already-open paper position.
 * This is deliberately an advisory component: it produces no order, permit,
 * signature, or state transition.  A policy/risk layer must still authorize
 * any resulting reduce-only command.
 */
export type ExitEvAction = 'HOLD' | 'REDUCE' | 'CLOSE';

export interface ExitEvInput {
  readonly positionValueUsd: number;
  readonly reduceFraction: number;
  readonly probabilityUpside: number;
  readonly upsideBps: number;
  readonly probabilityReversal: number;
  readonly reversalBps: number;
  readonly probabilityRug: number;
  readonly rugLossBps: number;
  readonly holdCostBps: number;
  readonly exitCostBps: number;
  readonly uncertaintyBps: number;
}

export interface ExitEvEvaluation {
  readonly evHoldBps: number;
  readonly evReduceBps: number;
  readonly evCloseBps: number;
  readonly selectedAction: ExitEvAction;
  readonly reason: string;
}

const probability = (value: number): number => Math.max(0, Math.min(1, value));
const finiteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

/** Uses only conditional estimates known at decision time; all values are bps. */
export function evaluateExitEv(input: ExitEvInput): ExitEvEvaluation | null {
  const numeric = [input.positionValueUsd, input.reduceFraction, input.probabilityUpside, input.upsideBps,
    input.probabilityReversal, input.reversalBps, input.probabilityRug, input.rugLossBps,
    input.holdCostBps, input.exitCostBps, input.uncertaintyBps];
  if (!numeric.every(finiteNonNegative) || input.positionValueUsd <= 0 || input.reduceFraction > 1) return null;

  const upside = probability(input.probabilityUpside) * input.upsideBps;
  const downside = probability(input.probabilityReversal) * input.reversalBps;
  const tail = probability(input.probabilityRug) * input.rugLossBps;
  // Uncertainty is a conservative hold penalty, never a fabricated alpha term.
  const evHoldBps = Math.round(upside - downside - tail - input.holdCostBps - input.uncertaintyBps);
  const evCloseBps = -Math.round(input.exitCostBps);
  // Selling a fraction realizes known execution friction; the remainder retains
  // its conditional value. This makes partial exits testable rather than magic.
  const evReduceBps = (input.reduceFraction > 0 && input.reduceFraction < 1)
    ? Math.round((1 - input.reduceFraction) * evHoldBps - input.reduceFraction * input.exitCostBps)
    : -Infinity;
  const choices: Array<[ExitEvAction, number]> = [['HOLD', evHoldBps], ['REDUCE', evReduceBps], ['CLOSE', evCloseBps]];
  const [selectedAction] = choices.reduce((best, candidate) => candidate[1] > best[1] ? candidate : best);
  return { evHoldBps, evReduceBps, evCloseBps, selectedAction,
    reason: `cost-aware EV: hold=${evHoldBps}bps reduce=${evReduceBps}bps close=${evCloseBps}bps` };
}
