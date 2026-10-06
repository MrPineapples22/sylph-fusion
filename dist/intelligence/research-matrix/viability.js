/**
 * SYLPH FUSION — VIABILITY KERNEL & CAPITAL DEFICIT SURFACE
 * Specifications: Master Blueprint Sections 10 & 11
 *
 * Implements:
 * 1. Viability Kernel:
 *    - ViabilityMargin
 *    - DistanceToViabilityBoundary
 *    - MinimumSlack across constraints (capital, liquidity, inventory, time, authenticity, exitability)
 *    - SafeHorizonSeconds
 *    - RescueDistance
 *
 * 2. Capital Deficit Surface:
 *    - K_min(m): Credible independent capital necessary to support continuation to multiple m
 *    - K_available(m): Observed inflow capital
 *    - CD(m) = K_available(m) - K_min(m)
 *    - ReachableMultiple = max m such that CD(m) >= 0.
 *
 * Invariant: A token leaving the extreme-return viability kernel must NOT continue receiving
 * an extreme-runner thesis merely because momentum remains positive.
 */
export class ViabilityKernelX {
    static TARGET_MULTIPLES = [2, 3, 5, 10, 20, 50, 100];
    /**
     * Evaluates point-in-time viability kernel bounds and capital deficit surface.
     */
    evaluateViability(state) {
        const ageSec = Math.max(1, state.market.tokenAgeSeconds.value ?? 1);
        const reservesSol = state.market.realQuoteReservesSol.value ?? 1.0;
        const renewalRate = Math.max(0.001, state.flow.capitalRenewalRateSolPerSec.value ?? 0.05);
        const sellLiability = state.inventory.sellLiabilitySol.value ?? 5.0;
        const washProb = state.authenticity.washTradingProbability.value ?? 0.1;
        const independentActors = state.authenticity.independentActorRatio.value ?? 0.5;
        // 1. Capital Deficit Surface calculation
        // K_min(m) increases with m^1.5 due to bonding curve convexity and holder profit-taking pressure
        const capitalDeficitSurface = [];
        let maxReachableMultiple = 1.0;
        for (const m of ViabilityKernelX.TARGET_MULTIPLES) {
            // Theoretical independent capital needed to push curve from current reserves to m*P
            const kMinSol = Number((reservesSol * (Math.sqrt(m) - 1.0) * 1.8 + sellLiability * 0.4).toFixed(3));
            // Available capital based on authentic renewal rate and observation runway
            const estimatedRunwaySec = Math.max(30, 300 - ageSec);
            const kAvailableSol = Number((renewalRate * estimatedRunwaySec * independentActors * (1.0 - washProb)).toFixed(3));
            const capitalDeficitSol = Number((kAvailableSol - kMinSol).toFixed(3));
            const isViable = capitalDeficitSol >= 0;
            if (isViable && m > maxReachableMultiple) {
                maxReachableMultiple = m;
            }
            capitalDeficitSurface.push({
                multiple: m,
                kMinSol,
                kAvailableSol,
                capitalDeficitSol,
                isViable,
            });
        }
        // 2. Multi-constraint Slack Scores (0..1)
        const capitalSlack = Math.max(0, Math.min(1, capitalDeficitSurface[0].capitalDeficitSol / 10.0 + 0.5));
        const liquiditySlack = Math.max(0, Math.min(1, reservesSol / 5.0));
        const inventorySlack = Math.max(0, Math.min(1, 1.0 - (sellLiability / (reservesSol * 2.0 + 1e-6))));
        const timeSlack = Math.max(0, Math.min(1, (180 - ageSec) / 180)); // 3-minute max hold empirical boundary
        const authenticitySlack = Math.max(0, Math.min(1, (1.0 - washProb) * independentActors));
        const exitabilitySlack = Math.max(0, Math.min(1, reservesSol > 1.5 ? 0.8 : 0.2));
        const slacks = [
            { name: 'CAPITAL', slack: capitalSlack },
            { name: 'LIQUIDITY', slack: liquiditySlack },
            { name: 'INVENTORY', slack: inventorySlack },
            { name: 'TIME', slack: timeSlack },
            { name: 'AUTHENTICITY', slack: authenticitySlack },
            { name: 'EXITABILITY', slack: exitabilitySlack },
        ];
        slacks.sort((a, b) => a.slack - b.slack);
        const limiting = slacks[0];
        const minimumSlackScore = Number(limiting.slack.toFixed(4));
        // Distance to boundary & viability margin
        const distanceToViabilityBoundary = minimumSlackScore;
        const viabilityMarginBps = Math.round((minimumSlackScore - 0.20) * 10_000); // 0.20 safety floor
        const inViabilityKernel = minimumSlackScore >= 0.20 && maxReachableMultiple >= 2.0;
        // Safe horizon (time in seconds before active constraints breach viability)
        const safeHorizonSeconds = Math.max(5, Math.round(timeSlack * 180));
        // Rescue distance (capital/inflow multiple required to bring state back into kernel if degraded)
        const rescueDistance = inViabilityKernel ? 0.0 : Number(Math.max(0.1, 0.20 - minimumSlackScore).toFixed(4));
        const thesisVetoed = !inViabilityKernel;
        const explanation = inViabilityKernel
            ? `Inside Viability Kernel: Max reachable multiple ${maxReachableMultiple}x. Limiting constraint: ${limiting.name} (slack: ${minimumSlackScore}).`
            : `VIABILITY_KERNEL_BREACH: Token departed viable manifold. Bottleneck: ${limiting.name} (slack: ${minimumSlackScore} < 0.20 floor). Extreme runner thesis revoked.`;
        return {
            inViabilityKernel,
            viabilityMarginBps,
            distanceToViabilityBoundary,
            minimumSlackScore,
            safeHorizonSeconds,
            rescueDistance,
            capitalDeficitSurface,
            maxReachableMultiple,
            limitingConstraint: limiting.name,
            thesisVetoed,
            explanation,
        };
    }
}
//# sourceMappingURL=viability.js.map