/**
 * SYLPH FUSION — WINNER SEPARATION & DECISION SLACK ENGINE
 * Specifications: Master Blueprint Sections XXI, XXII, XXIII, XXIV, XXV
 *
 * Implements:
 * 1. Winner Separation Time (WST): Time when future extreme winner first diverges from matched failures
 * 2. Minimum Sufficient Evidence Time (MSET): Earliest time evidence yields positive robust executable EV
 * 3. Crowding Horizon (CH): Time window before crowding destroys attainable edge
 * 4. Decision Slack: T_edgeGone - MSET (how much computation fits before entry)
 * 5. Value of Speed: EntryPriceAdvantage(t) - InformationDeficit(t)
 */
export class WinnerSeparationEngine {
    static SEPARATION_THRESHOLD_THETA = 0.25;
    /**
     * Evaluates winner separation time against 50-200 matched control tokens.
     */
    static analyzeSeparation(params) {
        const edgeGoneMs = params.edgeDecayMs ?? 60_000; // default 60s edge horizon
        let wstMs = null;
        let msetMs = null;
        let optimalDecisionWindowMs = 2_000;
        let maxSpeedValue = -Infinity;
        const evaluatedSlices = [];
        for (const slice of params.slices) {
            const separation = slice.pWinner - slice.pControlMean;
            // Information deficit decreases as elapsed time / entropy increases
            const informationDeficitBps = Math.max(0, Math.round((1 - slice.entropyConfidence) * 1000));
            // Price advantage decreases as price moves away from birth
            const priceAdvantageBps = Math.max(0, 1000 - slice.entryPriceBpsVsBirth);
            const valueOfSpeed = priceAdvantageBps - informationDeficitBps;
            if (valueOfSpeed > maxSpeedValue && slice.executableEvSol > 0) {
                maxSpeedValue = valueOfSpeed;
                optimalDecisionWindowMs = slice.elapsedMs;
            }
            if (wstMs === null && separation >= this.SEPARATION_THRESHOLD_THETA) {
                wstMs = slice.elapsedMs;
            }
            if (msetMs === null && slice.executableEvSol > 0.05 && separation > 0.15) {
                msetMs = slice.elapsedMs;
            }
            evaluatedSlices.push({
                elapsedMs: slice.elapsedMs,
                elapsedSlots: slice.elapsedSlots,
                pMoonshotGivenSignal: slice.pWinner,
                pMoonshotGivenControls: slice.pControlMean,
                separationScore: Number(separation.toFixed(4)),
                expectedExecutableEvSol: slice.executableEvSol,
                priceAdvantageBps,
                informationDeficitBps,
            });
        }
        const tRecognizable = wstMs ?? 10_000;
        const crowdingHorizonMs = Math.max(0, edgeGoneMs - tRecognizable);
        const decisionSlackMs = Math.max(0, edgeGoneMs - (msetMs ?? tRecognizable));
        return {
            winnerMint: params.winnerMint,
            matchedControlCount: params.matchedControls.length,
            wstMs,
            msetMs,
            edgeGoneMs,
            crowdingHorizonMs,
            decisionSlackMs,
            optimalDecisionWindowMs,
            timeSlices: evaluatedSlices,
        };
    }
}
//# sourceMappingURL=winner-separation.js.map