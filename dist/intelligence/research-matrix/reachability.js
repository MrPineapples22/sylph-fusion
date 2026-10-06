/**
 * SYLPH FUSION — REACHABILITY & BACKWARD-REACHABILITY ENGINE
 * Specifications: Master Blueprint Sections 8 & 9 (Reachability vs Information)
 *
 * Implements:
 * 1. 2x2 Decision State:
 *    - HIGH INFORMATION / HIGH REACHABILITY -> Legitimate Candidate
 *    - HIGH INFORMATION / LOW REACHABILITY -> Good Prediction, Bad Trade (REJECT)
 *    - LOW INFORMATION / HIGH REACHABILITY -> Unknowable Potential (ABSTAIN)
 *    - LOW INFORMATION / LOW REACHABILITY -> REJECT
 *
 * 2. Backward Reachability R^-1_mX:
 *    Separates:
 *    - P_target: Nominal model probability
 *    - R_target: Economically reachable probability
 *    - C_target(q): Capturable probability at trade size q
 *    Enforces invariant: C_target(q) <= R_target <= P_target
 *    Tracks FeasibilityGap = P_target - R_target and CaptureGap = R_target - C_target(q).
 */
export class ReachabilityEngineX {
    /**
     * Evaluates forward & backward reachability across target multiples for a given position size q.
     */
    evaluateReachability(state, positionSizeSol = 0.5) {
        const isInfoSufficient = state.information.informationSufficiency.value === true;
        const realReserves = state.market.realQuoteReservesSol.value ?? 1.0;
        const liquidityDepth = state.market.executableDepthSol.value ?? realReserves;
        const independentActors = state.authenticity.independentActorRatio.value ?? 0.5;
        const washProb = state.authenticity.washTradingProbability.value ?? 0.1;
        const sellLiability = state.inventory.sellLiabilitySol.value ?? 5.0;
        // Economic absorption ratio: reserves relative to position size and sell overhang
        const absorptionRatio = Math.max(0.01, realReserves / (positionSizeSol * 3.0 + sellLiability * 0.5));
        const authenticityFactor = Math.max(0.1, (1.0 - washProb) * independentActors);
        const targets = ['RUNNER_2X', 'RUNNER_5X', 'RUNNER_10X', 'RUNNER_20X', 'RUNNER_100X'];
        const targetAnalyses = [];
        const explanations = [];
        let overallHighReach = false;
        let dominantTarget = 'RUNNER_2X';
        for (const target of targets) {
            const multiplier = target === 'RUNNER_2X' ? 2 : target === 'RUNNER_5X' ? 5 : target === 'RUNNER_10X' ? 10 : target === 'RUNNER_20X' ? 20 : 100;
            // 1. Nominal model probability (prior base rate on Pump.fun for reaching multiplier)
            // (Empirically from 523k tokens: 2x ~ 14.3%, 5x ~ 1.54%, 10x ~ 0.40%, 100x ~ 0.014%)
            const baseNominal = multiplier === 2 ? 0.143 : multiplier === 5 ? 0.0154 : multiplier === 10 ? 0.004 : multiplier === 20 ? 0.001 : 0.00014;
            const momentumBonus = Math.min(2.0, Math.max(0.2, (state.flow.buySellRatio.value ?? 1.0) * 0.5));
            const nominalProbability = Math.min(0.85, baseNominal * momentumBonus);
            // 2. Reachable probability R_target: Accounts for required independent capital
            // R <= P always
            const capitalDecay = Math.exp(-multiplier / Math.max(1, absorptionRatio * 5.0));
            const reachableProbability = Math.min(nominalProbability, nominalProbability * capitalDecay * authenticityFactor);
            // 3. Capturable probability C_target(q) at size q: Accounts for market depth impact at exit
            // Exit price impact = (q / depth) * 100%
            const exitImpact = positionSizeSol / Math.max(0.1, liquidityDepth);
            const exitFeasibility = Math.max(0, 1.0 - exitImpact * 2.5);
            const capturableProbability = Math.min(reachableProbability, reachableProbability * exitFeasibility);
            const feasibilityGap = Math.max(0, nominalProbability - reachableProbability);
            const captureGap = Math.max(0, reachableProbability - capturableProbability);
            const isEconomicallyReachable = reachableProbability > 0.005 && feasibilityGap < 0.25;
            const exitReachable = capturableProbability > 0.002 && exitFeasibility > 0.4;
            if (isEconomicallyReachable && multiplier <= 5) {
                overallHighReach = true;
                dominantTarget = target;
            }
            targetAnalyses.push({
                target,
                nominalProbability: Number(nominalProbability.toFixed(5)),
                reachableProbability: Number(reachableProbability.toFixed(5)),
                capturableProbability: Number(capturableProbability.toFixed(5)),
                feasibilityGap: Number(feasibilityGap.toFixed(5)),
                captureGap: Number(captureGap.toFixed(5)),
                isEconomicallyReachable,
                exitReachable,
            });
            if (!exitReachable && nominalProbability > 0.05) {
                explanations.push(`${target}: ONE_WAY_RUNNER detected. Nominal probability exists but position size ${positionSizeSol} SOL cannot exit safely into ${liquidityDepth.toFixed(2)} SOL depth.`);
            }
        }
        // 2x2 Quadrant mapping
        let quadrant;
        let recommendedAction;
        if (isInfoSufficient && overallHighReach) {
            quadrant = 'HIGH_INFO_HIGH_REACH';
            recommendedAction = 'QUALIFIED_CANDIDATE';
            explanations.push('High Information & High Reachability: Legitimate trading opportunity.');
        }
        else if (isInfoSufficient && !overallHighReach) {
            quadrant = 'HIGH_INFO_LOW_REACH';
            recommendedAction = 'GOOD_PREDICTION_BAD_TRADE';
            explanations.push('High Information & Low Reachability: Statistically predictable but economically trapped. REJECT.');
        }
        else if (!isInfoSufficient && overallHighReach) {
            quadrant = 'LOW_INFO_HIGH_REACH';
            recommendedAction = 'ABSTAIN_UNKNOWABLE';
            explanations.push('Low Information & High Reachability: Large potential but currently unknowable. ABSTAIN.');
        }
        else {
            quadrant = 'LOW_INFO_LOW_REACH';
            recommendedAction = 'REJECT_UNFEASIBLE';
            explanations.push('Low Information & Low Reachability: Structurally invalid. REJECT.');
        }
        return {
            quadrant,
            recommendedAction,
            targetAnalyses,
            dominantTarget,
            explanations,
        };
    }
}
//# sourceMappingURL=reachability.js.map