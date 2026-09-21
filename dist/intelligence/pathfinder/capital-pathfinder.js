/**
 * SOL-SYLPH Master Implementation Blueprint - PATHFINDER
 * Global Opportunity Graph & Capital Path Planning
 * Specifications: Parts 12-16.
 */
export class CapitalPathfinderEngine {
    capitalState;
    constructor(initialCapitalSol = 10.0) {
        this.capitalState = {
            available_sol: initialCapitalSol * 0.7, // 70% available
            reserved_sol: initialCapitalSol * 0.1, // 10% reserved for in-flight orders
            deployed_sol: initialCapitalSol * 0.1, // 10% deployed in positions
            releasing_sol: 0.0,
            pending_sol: 0.0,
            exit_reserve_sol: initialCapitalSol * 0.05, // 5% emergency exit fee buffer
            execution_reserve_sol: initialCapitalSol * 0.05, // 5% priority fee buffer
            risk_budget_sol: initialCapitalSol * 0.25, // Max 25% single-epoch risk budget
            commitments: {},
            positions: {},
            timestamp_ms: Date.now(),
        };
    }
    getCapitalState() {
        return { ...this.capitalState };
    }
    updateCapitalState(partial) {
        this.capitalState = {
            ...this.capitalState,
            ...partial,
            timestamp_ms: Date.now(),
        };
    }
    /**
     * Part 15: Capital Trapping Risk
     * Evaluates if capital allocated to this token can be released smoothly under stress.
     */
    evaluateTrappingRisk(opportunity, poolLiquiditySol, networkCongestionFactor = 1.0) {
        const exitDepth = Math.max(0.1, poolLiquiditySol * 0.2); // ~20% of pool is viable exit depth
        const requestedRatio = opportunity.capacity_sol / Math.max(1, exitDepth);
        // Slippage grows quadratically with size relative to pool exit depth
        const estimatedSlippage = Math.min(50, requestedRatio * 8.5 * networkCongestionFactor);
        // Trapping score: high if liquidity is tiny or slippage exceeds 10%
        const trappingScore = Math.min(1.0, (estimatedSlippage / 20) * 0.6 + (1 - Math.min(1, exitDepth / 50)) * 0.4);
        const congestionHeadroom = Math.max(0.1, 1.0 - (networkCongestionFactor - 1.0) * 0.5);
        return {
            trapping_score: Number(trappingScore.toFixed(3)),
            exit_liquidity_depth_sol: Number(exitDepth.toFixed(2)),
            estimated_exit_slippage_pct: Number(estimatedSlippage.toFixed(2)),
            congestion_headroom_score: Number(congestionHeadroom.toFixed(2)),
            exit_window_urgency_sec: Math.max(15, Math.min(300, Math.floor(opportunity.remaining_life_sec * 0.6))),
        };
    }
    /**
     * Part 13 & 16: Opportunity Graph & Receding-Horizon Planning
     * Evaluates capital alternatives across available opportunities,
     * generates branching sequences, and authorizes ONLY the immediate step.
     */
    planCapitalAllocation(resolvedIntent, opportunity, poolLiquiditySol) {
        const trapping = this.evaluateTrappingRisk(opportunity, poolLiquiditySol);
        // Optionality calculation: measures how much capital and flexibility remains after this action
        const afterAvailable = Math.max(0, this.capitalState.available_sol - resolvedIntent.net_size_sol);
        const optionalityScore = Number(Math.min(1.0, (afterAvailable / Math.max(1, this.capitalState.available_sol + 0.01)) * (1 - trapping.trapping_score * 0.5)).toFixed(3));
        // Dynamic sizing based on trapping risk
        let authorizedSizeSol = resolvedIntent.net_size_sol;
        if (trapping.trapping_score > 0.7) {
            // High trapping risk: clamp sizing by 50%
            authorizedSizeSol = Math.min(authorizedSizeSol, 0.5);
        }
        else if (trapping.trapping_score > 0.4) {
            authorizedSizeSol = Math.min(authorizedSizeSol, 1.0);
        }
        // Never exceed currently available capital minus reserves
        const unreservedAvailable = Math.max(0, this.capitalState.available_sol - this.capitalState.exit_reserve_sol - this.capitalState.execution_reserve_sol);
        authorizedSizeSol = Math.min(authorizedSizeSol, unreservedAvailable);
        // Branching contingent paths for receding horizon
        const contingentPaths = [
            {
                condition: 'MOMENTUM_CONFIRMED (price expands > 15% in 30s)',
                projected_action: 'PARTIAL_TAKE_PROFIT_33% -> RELEASE_TO_RESERVE',
                probability_estimate: 0.35,
            },
            {
                condition: 'LIQUIDITY_DETERIORATION (depth falls > 20%)',
                projected_action: 'EMERGENCY_DECREASE_50% -> EXIT_RESERVE_PRESERVATION',
                probability_estimate: 0.2,
            },
            {
                condition: 'THESIS_HOLD (stable sideways accumulation)',
                projected_action: 'HOLD_POSITION -> RE_EVALUATE_HORIZON_2M',
                probability_estimate: 0.45,
            },
        ];
        return {
            plan_id: `plan_${resolvedIntent.mint.slice(0, 6)}_${Date.now()}`,
            immediate_action: {
                mint: resolvedIntent.mint,
                authorized_size_sol: Number(authorizedSizeSol.toFixed(4)),
                capital_source: 'AVAILABLE',
            },
            contingent_next_steps: contingentPaths,
            capital_trapping_risk: trapping,
            optionality_score: optionalityScore,
            timestamp_ms: Date.now(),
        };
    }
    /**
     * Commit immediate capital allocation
     */
    commitAllocation(mint, sizeSol) {
        const currentPositions = { ...this.capitalState.positions };
        currentPositions[mint] = (currentPositions[mint] ?? 0) + sizeSol;
        this.updateCapitalState({
            available_sol: Math.max(0, this.capitalState.available_sol - sizeSol),
            deployed_sol: this.capitalState.deployed_sol + sizeSol,
            positions: currentPositions,
        });
    }
    /**
     * Release capital from exit or reduction
     */
    releaseAllocation(mint, sizeSol, realizedPnlSol = 0) {
        const currentPositions = { ...this.capitalState.positions };
        const currentHolding = currentPositions[mint] ?? 0;
        const nextHolding = Math.max(0, currentHolding - sizeSol);
        if (nextHolding === 0) {
            delete currentPositions[mint];
        }
        else {
            currentPositions[mint] = nextHolding;
        }
        const returnedCapital = sizeSol + realizedPnlSol;
        this.updateCapitalState({
            available_sol: this.capitalState.available_sol + Math.max(0, returnedCapital),
            deployed_sol: Math.max(0, this.capitalState.deployed_sol - sizeSol),
            positions: currentPositions,
        });
    }
}
//# sourceMappingURL=capital-pathfinder.js.map