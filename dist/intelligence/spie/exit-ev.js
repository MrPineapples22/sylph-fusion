const probability = (value) => Math.max(0, Math.min(1, value));
const finiteNonNegative = (value) => Number.isFinite(value) && value >= 0;
/** Uses only conditional estimates known at decision time; all values are bps. */
export function evaluateExitEv(input) {
    const numeric = [input.positionValueUsd, input.reduceFraction, input.probabilityUpside, input.upsideBps,
        input.probabilityReversal, input.reversalBps, input.probabilityRug, input.rugLossBps,
        input.holdCostBps, input.exitCostBps, input.uncertaintyBps];
    if (!numeric.every(finiteNonNegative) || input.positionValueUsd <= 0 || input.reduceFraction > 1)
        return null;
    const upside = probability(input.probabilityUpside) * input.upsideBps;
    const downside = probability(input.probabilityReversal) * input.reversalBps;
    const tail = probability(input.probabilityRug) * input.rugLossBps;
    // Uncertainty is a conservative hold penalty, never a fabricated alpha term.
    const evHoldBps = Math.round(upside - downside - tail - input.holdCostBps - input.uncertaintyBps);
    const evCloseBps = -Math.round(input.exitCostBps);
    // Selling a fraction realizes known execution friction; the remainder retains
    // its conditional value. This makes partial exits testable rather than magic.
    const evReduceBps = Math.round((1 - input.reduceFraction) * evHoldBps - input.reduceFraction * input.exitCostBps);
    const choices = [['HOLD', evHoldBps], ['REDUCE', evReduceBps], ['CLOSE', evCloseBps]];
    const [selectedAction] = choices.reduce((best, candidate) => candidate[1] > best[1] ? candidate : best);
    return { evHoldBps, evReduceBps, evCloseBps, selectedAction,
        reason: `cost-aware EV: hold=${evHoldBps}bps reduce=${evReduceBps}bps close=${evCloseBps}bps` };
}
//# sourceMappingURL=exit-ev.js.map