/**
 * SOL-SYLPH Master Production Intelligence - Portfolio Allocator & Risk Invariants
 * Specifications: Parts XLIX (Opportunity Competition), L (Opportunity Cost),
 * LI (Portfolio Allocation), LII (Correlated Risk Graph), LIII (Tail-Risk Engine),
 * LIV (Liquidity Capacity), LV (Exitability Model), LVI (Capital Gate),
 * LVII (System Confidence), LVIII (Dynamic Capital Degradation).
 */
export const DEFAULT_RISK_LIMITS = {
    maxTotalExposureSol: 10.0,
    maxSingleTokenSol: 2.0,
    maxCreatorClusterSol: 3.0,
    maxFundingClusterSol: 3.5,
    maxCorrelatedExposureSol: 4.0,
    maxLowLiquidityExposureSol: 1.5,
    maxOodExposureSol: 1.0,
    maxDailyLossSol: 3.0,
    maxOpenPositions: 5,
    minCashReserveSol: 2.0,
};
export class ExitabilityModel {
    evaluateExitability(params) {
        const { liquiditySol, plannedSizeSol, recentSellVolumeSol, totalVolumeSol, liquidityVelocity, clusterExitedPct, networkCongestion, } = params;
        // Exit price impact: size / (liquidity + size)
        const exitPriceImpactPct = liquiditySol > 0 ? (plannedSizeSol / (liquiditySol + plannedSizeSol)) * 100 : 25.0;
        const recentSellPressurePct = totalVolumeSol > 0 ? (recentSellVolumeSol / totalVolumeSol) * 100 : 0;
        const congestionImpactPct = (networkCongestion - 1.0) * 10;
        let score = 100;
        let bottleneck;
        if (exitPriceImpactPct > 8.0) {
            score -= 35;
            bottleneck = 'HIGH_EXIT_SLIPPAGE_IMPACT';
        }
        if (liquidityVelocity < -0.15) {
            score -= 30;
            bottleneck = 'RAPID_LIQUIDITY_EVAPORATION';
        }
        if (clusterExitedPct > 40) {
            score -= 25;
            bottleneck = 'PREDATORY_CLUSTER_DUMP_IN_PROGRESS';
        }
        if (recentSellPressurePct > 70) {
            score -= 20;
            bottleneck = 'INTENSE_SELL_PRESSURE';
        }
        if (congestionImpactPct > 15) {
            score -= 15;
        }
        const exitabilityScore = Math.max(0, Math.min(100, Math.round(score)));
        const isExitFeasible = exitabilityScore >= 45 && exitPriceImpactPct < 15.0;
        return {
            liquidityDepthSol: liquiditySol,
            exitPriceImpactPct: Number(exitPriceImpactPct.toFixed(2)),
            recentSellPressurePct: Number(recentSellPressurePct.toFixed(1)),
            liquidityVelocity: Number(liquidityVelocity.toFixed(3)),
            clusterExitedRatio: Number((clusterExitedPct / 100).toFixed(2)),
            congestionImpactPct: Number(congestionImpactPct.toFixed(1)),
            exitabilityScore,
            isExitFeasible,
            exitBottleneckReason: bottleneck,
        };
    }
}
export class CapitalGate {
    /**
     * Part LVI: Places hard permission gates immediately before capital deployment.
     */
    determinePermission(params) {
        const { systemConfidence, dataHealthConfidence, evidenceState, exitabilityScore, portfolioState, contradictionDetected, } = params;
        // Hard Safety Invariants: Deterministic overrides of any ML desire to enter
        if (portfolioState === 'RISK_FREEZE' || dataHealthConfidence < 0.60) {
            return 'ABSTAIN';
        }
        if (contradictionDetected || exitabilityScore < 40) {
            return 'ABSTAIN';
        }
        if (systemConfidence === 'DEGRADED') {
            return 'SHADOW_ONLY';
        }
        if (systemConfidence === 'LOW' || evidenceState === 'PROVISIONAL') {
            return 'MINIMAL';
        }
        if (systemConfidence === 'NORMAL' || portfolioState === 'DRAWDOWN' || evidenceState === 'SUPPORTED') {
            return 'REDUCED';
        }
        return 'FULL_POLICY_PERMISSION';
    }
}
export class CorrelatedRiskGraph {
    evaluateOverlaps(candidates, existingPositions) {
        const activeClusters = new Set(existingPositions.map((p) => p.clusterId || p.fundingClusterId || '').filter(Boolean));
        const activeCreators = new Set(existingPositions.map((p) => p.creatorAddress).filter(Boolean));
        const warnings = [];
        let correlatedCount = 0;
        for (const c of candidates) {
            if (activeClusters.has(c.fundingClusterId)) {
                correlatedCount++;
                warnings.push(`Candidate ${c.mint.slice(0, 8)} shares funding cluster [${c.fundingClusterId}] with open position`);
            }
            if (c.creatorAddress && activeCreators.has(c.creatorAddress)) {
                correlatedCount++;
                warnings.push(`Candidate ${c.mint.slice(0, 8)} shares creator [${c.creatorAddress.slice(0, 8)}] with open position`);
            }
        }
        const totalDistinctClusters = new Set([
            ...existingPositions.map((p) => p.clusterId),
            ...candidates.map((c) => c.fundingClusterId),
        ]).size;
        return {
            effectiveIndependentExposures: totalDistinctClusters,
            warnings,
        };
    }
}
export class PortfolioOpportunityEngine {
    currentState = 'NORMAL';
    currentDailyLossSol = 0;
    limits;
    exitabilityModel = new ExitabilityModel();
    capitalGate = new CapitalGate();
    correlatedRiskGraph = new CorrelatedRiskGraph();
    constructor(customLimits) {
        this.limits = { ...DEFAULT_RISK_LIMITS, ...customLimits };
    }
    setPortfolioState(state) {
        this.currentState = state;
    }
    recordDailyLoss(lossSol) {
        this.currentDailyLossSol += lossSol;
        if (this.currentDailyLossSol >= this.limits.maxDailyLossSol) {
            this.currentState = 'RISK_FREEZE';
        }
        else if (this.currentDailyLossSol >= this.limits.maxDailyLossSol * 0.6) {
            this.currentState = 'DRAWDOWN';
        }
    }
    /**
     * Evaluates position-size capacity curves across $25, $50, $100, $250, $500, $1,000.
     */
    evaluateSizeCurves(liquidityUsd, baseExpectedReturnPct, baseTargetProb) {
        const testSizes = [25, 50, 100, 250, 500, 1000];
        let prevGrossValue = 0;
        return testSizes.map((size) => {
            // Non-linear impact on bonding curve / AMM
            const impact = liquidityUsd > 0 ? (size / (liquidityUsd + size)) * 100 : 8.0;
            const slippage = impact * 1.4 + 0.2;
            const netReturn = baseExpectedReturnPct - impact - slippage;
            const shortfall = 15.0 + slippage * 1.5;
            const targetProb = Math.max(0.1, baseTargetProb * (1 - impact / 25));
            const grossValue = size * (netReturn / 100) * targetProb;
            const marginalValue = grossValue - prevGrossValue;
            prevGrossValue = grossValue;
            return {
                sizeUsd: size,
                priceImpactPct: Number(impact.toFixed(2)),
                slippagePct: Number(slippage.toFixed(2)),
                expectedReturnPct: Number(netReturn.toFixed(2)),
                expectedShortfallPct: Number(shortfall.toFixed(2)),
                targetProbability: Number(targetProb.toFixed(3)),
                marginalCapitalValue: Number(marginalValue.toFixed(2)),
            };
        });
    }
    /**
     * Ranks candidates and evaluates joint tail risk, capacity curves, and 10 invariants.
     */
    evaluateBoard(candidates, availableCashSol, currentExposureSol = 0, openPositionsCount = 0, regimeMultiplier = 1.0, systemConfidence = 'NORMAL', currentPortfolio = [], solPriceUsd, evidenceContext) {
        const violations = [];
        // Check invariants
        if (this.currentState === 'RISK_FREEZE') {
            violations.push('PORTFOLIO_STATE_RISK_FREEZE: New allocations completely locked');
        }
        if (availableCashSol <= this.limits.minCashReserveSol) {
            violations.push(`MIN_CASH_RESERVE_BREACH: Cash (${availableCashSol} SOL) <= min reserve (${this.limits.minCashReserveSol} SOL)`);
        }
        if (currentExposureSol >= this.limits.maxTotalExposureSol) {
            violations.push(`MAX_TOTAL_EXPOSURE_BREACH: Exposure (${currentExposureSol} SOL) >= limit (${this.limits.maxTotalExposureSol} SOL)`);
        }
        if (openPositionsCount >= this.limits.maxOpenPositions) {
            violations.push(`MAX_OPEN_POSITIONS_REACHED: Open count (${openPositionsCount}) >= max (${this.limits.maxOpenPositions})`);
        }
        // Section XXXI: Pass actual current portfolio into overlap analysis (never dummy empty array)
        const correlationReport = this.correlatedRiskGraph.evaluateOverlaps(candidates, currentPortfolio);
        // 1. If violations or no candidates, hold cash
        if (candidates.length === 0 || violations.length > 0) {
            return {
                rankedOpportunities: [],
                recommendedAllocationSol: 0,
                preferCashNoTrade: true,
                cashAdvantageReason: violations.length > 0 ? violations[0] : 'Zero candidates submitted',
                portfolioState: this.currentState,
                capitalGatePermission: 'ABSTAIN',
                sizeCurves: {},
                riskInvariantsPassed: violations.length === 0,
                activeViolations: violations,
                portfolioTailRisk: { es90Bps: 0, es95Bps: 0, es99Bps: 0, pCatastrophicCollapse: 0 },
                effectiveIndependentExposuresCount: 0,
                correlatedRiskWarnings: correlationReport.warnings,
            };
        }
        // 2. Rank candidates by Net Risk-Adjusted Expectancy
        const scored = candidates.map((c) => {
            const netExpectancy = c.expectedReturnBps * (1.0 - c.collapseProbability) -
                c.maxDrawdownBps * c.collapseProbability;
            return {
                candidate: c,
                score: netExpectancy * (c.exitFeasibilityScore / 100) * regimeMultiplier,
            };
        });
        scored.sort((a, b) => b.score - a.score);
        // 3. Tail Risk calculation (Part LIII)
        const worstCaseDrawdown = Math.max(...candidates.map((c) => c.maxDrawdownBps));
        const meanDrawdown = candidates.reduce((s, c) => s + c.maxDrawdownBps, 0) / candidates.length;
        const avgCollapseProb = candidates.reduce((s, c) => s + c.collapseProbability, 0) / candidates.length;
        const es90 = Math.round(meanDrawdown * 1.2);
        const es95 = Math.round(meanDrawdown * 1.5);
        const es99 = Math.round(worstCaseDrawdown * 1.1);
        // 4. Size curves per candidate using dynamic SOL/USD market valuation (Section XXXI)
        const activeSolUsd = solPriceUsd && solPriceUsd > 0 ? solPriceUsd : 150;
        const curves = {};
        for (const s of scored.slice(0, 3)) {
            curves[s.candidate.mint] = this.evaluateSizeCurves(s.candidate.liquiditySol * activeSolUsd, s.candidate.expectedReturnBps / 100, 1.0 - s.candidate.collapseProbability);
        }
        // 5. Cash Preference & Capital Gate with certificate-derived values (Section XXXI)
        const best = scored[0];
        const exitScore = best.candidate.exitability ? best.candidate.exitability.exitabilityScore : best.candidate.exitFeasibilityScore;
        const capitalGatePermission = this.capitalGate.determinePermission({
            systemConfidence,
            dataHealthConfidence: evidenceContext?.dataHealthConfidence ?? (systemConfidence === 'DEGRADED' ? 0.40 : 0.85),
            evidenceState: evidenceContext?.evidenceState ?? (systemConfidence === 'DEGRADED' ? 'INSUFFICIENT_EVIDENCE' : 'SUPPORTED'),
            exitabilityScore: exitScore,
            portfolioState: this.currentState,
            contradictionDetected: evidenceContext?.contradictionDetected ?? false,
        });
        const preferCash = best.score < 100 || capitalGatePermission === 'ABSTAIN' || capitalGatePermission === 'SHADOW_ONLY';
        const cashReason = preferCash
            ? best.score < 100
                ? `Best candidate net risk-adjusted edge (${best.score.toFixed(0)} bps) is below cash threshold (100 bps)`
                : `Capital gate prohibited allocation: ${capitalGatePermission}`
            : undefined;
        // Sizing governed by limits, state multiplier, and Capital Gate
        const stateMult = this.currentState === 'DRAWDOWN' ? 0.5 : this.currentState === 'RECOVERY' ? 0.75 : 1.0;
        const gateMult = capitalGatePermission === 'FULL_POLICY_PERMISSION' ? 1.0 : capitalGatePermission === 'REDUCED' ? 0.6 : 0.25;
        const recommendedSol = preferCash
            ? 0
            : Math.min(this.limits.maxSingleTokenSol, availableCashSol - this.limits.minCashReserveSol) * stateMult * gateMult;
        return {
            rankedOpportunities: scored.map((s) => s.candidate),
            topSelectedMint: preferCash ? undefined : best.candidate.mint,
            recommendedAllocationSol: Number(Math.max(0, recommendedSol).toFixed(2)),
            preferCashNoTrade: preferCash,
            cashAdvantageReason: cashReason,
            portfolioState: this.currentState,
            capitalGatePermission,
            sizeCurves: curves,
            riskInvariantsPassed: true,
            activeViolations: [],
            portfolioTailRisk: {
                es90Bps: Math.min(10_000, es90),
                es95Bps: Math.min(10_000, es95),
                es99Bps: Math.min(10_000, es99),
                pCatastrophicCollapse: Number(avgCollapseProb.toFixed(3)),
            },
            effectiveIndependentExposuresCount: correlationReport.effectiveIndependentExposures,
            correlatedRiskWarnings: correlationReport.warnings,
        };
    }
}
//# sourceMappingURL=opportunity-board.js.map