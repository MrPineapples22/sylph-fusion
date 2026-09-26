import { CapacityEngine } from './capacity-engine.js';
export class TradeConsensusEngine {
    capacityEngine = new CapacityEngine();
    evaluateConsensus(input) {
        const entryBlockers = [];
        // Consensus has no Token Safety Authority. A security gateway block can
        // prohibit entry, but cannot create a protected VETO or proof.
        const securityBlocked = input.securityResult.verdict === 'BLOCK';
        if (securityBlocked)
            entryBlockers.push(`security_block: ${input.securityResult.reason}`);
        const securityDim = {
            passed: input.securityResult.verdict === 'ALLOW' || input.securityResult.verdict === 'LIMIT',
            score: 100 - input.securityResult.riskScore,
            blocksEntry: securityBlocked,
            reason: input.securityResult.reason,
        };
        const riskBlocked = input.riskAuth.disposition === 'REJECT';
        if (riskBlocked)
            entryBlockers.push(`risk_reject: ${input.riskAuth.rejectionReason}`);
        const riskDim = {
            passed: input.riskAuth.disposition !== 'REJECT',
            score: input.riskAuth.disposition === 'APPROVE' ? 90 : input.riskAuth.disposition === 'REDUCE' ? 60 : 0,
            blocksEntry: riskBlocked,
            reason: input.riskAuth.rejectionReason ?? 'Approved by risk engine',
        };
        // 3. Alpha & Momentum Dimensions
        const alphaDim = {
            passed: input.alphaScore >= 50,
            score: input.alphaScore,
            blocksEntry: false,
            reason: input.alphaScore >= 50 ? 'Strong predictive signal' : 'Weak alpha score',
        };
        const momentumDim = {
            passed: input.momentumScore >= 45,
            score: input.momentumScore,
            blocksEntry: false,
            reason: input.momentumScore >= 45 ? 'Positive momentum velocity' : 'Negative/neutral momentum',
        };
        // 4. Wallet Integrity Dimension
        const walletDim = {
            passed: input.walletIntegrityScore >= 50,
            score: input.walletIntegrityScore,
            blocksEntry: input.walletIntegrityScore < 20,
            reason: input.walletIntegrityScore >= 50 ? 'Clean wallet graph' : 'Cluster/funder flags detected',
        };
        if (walletDim.blocksEntry)
            entryBlockers.push('wallet_integrity_severe_failure');
        // 5. Liquidity & Execution Dimensions
        const liqPassed = input.poolLiquidityLamports >= 1000000000n;
        const liquidityDim = {
            passed: liqPassed,
            score: liqPassed ? 85 : 30,
            blocksEntry: !liqPassed,
            reason: liqPassed ? 'Liquidity depth adequate' : 'Insufficient pool liquidity',
        };
        if (liquidityDim.blocksEntry)
            entryBlockers.push('shallow_liquidity');
        const execDim = {
            passed: input.executionQualityScore >= 50,
            score: input.executionQualityScore,
            blocksEntry: false,
            reason: `Execution score: ${input.executionQualityScore}/100`,
        };
        // 6. Regime & Portfolio Fit Dimensions
        const regimeDim = {
            passed: input.regimeScore >= 40,
            score: input.regimeScore,
            blocksEntry: false,
            reason: `Regime score: ${input.regimeScore}/100`,
        };
        const portfolioDim = {
            passed: input.portfolioFitScore >= 50,
            score: input.portfolioFitScore,
            blocksEntry: false,
            reason: `Portfolio fit: ${input.portfolioFitScore}/100`,
        };
        // 7. Calculate Signal Disagreement (Variance between predictive signals)
        const signals = [input.alphaScore, input.momentumScore, input.regimeScore];
        const mean = signals.reduce((a, b) => a + b, 0) / signals.length;
        const variance = signals.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / signals.length;
        const disagreementScore = Math.min(100, Math.round(Math.sqrt(variance) * 2.5));
        // 8. Capacity & Adversarial Stress Simulation
        let authorizedCap = input.riskAuth.authorizedAmountLamports;
        if (input.securityResult.allowedMaxPositionSizeLamports !== null) {
            if (authorizedCap > input.securityResult.allowedMaxPositionSizeLamports) {
                authorizedCap = input.securityResult.allowedMaxPositionSizeLamports;
            }
        }
        const maxCapacityLamports = this.capacityEngine.calculateMaxAuthorizedPosition(input.capacityConstraints, authorizedCap);
        const stressReport = this.capacityEngine.runAdversarialSimulation(maxCapacityLamports, input.poolLiquidityLamports);
        if (stressReport.catastrophicFailureDetected) {
            entryBlockers.push('adversarial_simulation_catastrophic_failure');
        }
        const { edgeAfterCapacityBps, degradationBps, viable } = this.capacityEngine.calculateEdgeAfterCapacity(input.expectedEdgeBps, maxCapacityLamports, input.poolLiquidityLamports);
        if (!viable) {
            entryBlockers.push(`negative_or_insufficient_edge_after_capacity_${edgeAfterCapacityBps}bps`);
        }
        // Domain-local blocks cannot be overridden by alpha, but they remain
        // domain-local operational decisions rather than token guilt.
        const overallAccepted = entryBlockers.length === 0 && disagreementScore < 50;
        return {
            candidateId: input.candidateId,
            mint: input.mint,
            overallAccepted,
            disagreementScore,
            dimensions: {
                alpha: alphaDim,
                momentum: momentumDim,
                walletIntegrity: walletDim,
                security: securityDim,
                liquidity: liquidityDim,
                executionQuality: execDim,
                marketRegime: regimeDim,
                portfolioFit: portfolioDim,
                risk: riskDim,
            },
            entryBlockers,
            maxCapacityLamports: overallAccepted ? maxCapacityLamports : 0n,
            expectedEdgeBps: input.expectedEdgeBps,
            expectedExecutionDegradationBps: degradationBps,
            edgeAfterCapacityBps,
            adversarialSurvivabilityScore: stressReport.overallSurvivabilityScore,
            timestamp: Date.now(),
        };
    }
}
//# sourceMappingURL=consensus-engine.js.map