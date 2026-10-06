/**
 * SYLPH FUSION — EXECUTABLE PAPER SIMULATOR
 * Specification: Master Blueprint Section LXXXIV (Executable Paper Simulator)
 *
 * Implements realistic, microstructure-aware simulated execution.
 * PAPER mode must stop using unrealistic ideal fills.
 *
 * Invariants:
 * 1. Fills must respect real AMM constant-product or bonding curve reserves.
 * 2. Never fill beyond pool capacity.
 * 3. Never simulate execution when route does not exist.
 * 4. Model blockhash expiry, tip contention, transport drops, and adverse selection.
 * 5. Accurately model inability to exit (SIMULATED_UNEXITABLE).
 */
export class ExecutablePaperSimulator {
    static LAMPORTS_PER_SOL = 1000000000n;
    static MAX_BLOCKHASH_AGE_MS = 60_000; // ~150 slots
    static BASE_NETWORK_FEE_LAMPORTS = 5000n;
    /**
     * Simulates order execution against realistic market depth, contention, and network conditions.
     */
    simulateExecution(input) {
        const latencyMs = input.simulatedLatencyMs;
        const executionTimestamp = input.currentTimestamp + latencyMs;
        const landedSlot = input.currentSlot + BigInt(Math.max(1, Math.floor(latencyMs / 400)));
        // 1. Blockhash Expiry Check
        if (input.blockhashAgeMs + latencyMs > ExecutablePaperSimulator.MAX_BLOCKHASH_AGE_MS) {
            return {
                outcome: 'SIMULATED_EXPIRED',
                fillPriceSol: 0,
                tokenDeltaRaw: 0n,
                solDeltaLamports: 0n,
                priceImpactBps: 0,
                actualSlippageBps: 0,
                priorityFeePaidLamports: 0n,
                jitoTipPaidLamports: 0n,
                networkFeePaidLamports: ExecutablePaperSimulator.BASE_NETWORK_FEE_LAMPORTS,
                landedSlot,
                latencyMs,
                reason: 'BLOCKHASH_EXPIRED',
            };
        }
        // 2. Transport & Contention Dropping Check
        if (input.transportCondition === 'DROPPING' || input.transportCondition === 'REORGANIZING') {
            return {
                outcome: 'SIMULATED_NOLAND',
                fillPriceSol: 0,
                tokenDeltaRaw: 0n,
                solDeltaLamports: 0n,
                priceImpactBps: 0,
                actualSlippageBps: 0,
                priorityFeePaidLamports: input.priorityFeeLamports,
                jitoTipPaidLamports: 0n, // Tips only land if bundled
                networkFeePaidLamports: ExecutablePaperSimulator.BASE_NETWORK_FEE_LAMPORTS,
                landedSlot,
                latencyMs,
                reason: `TRANSPORT_FAULT_${input.transportCondition}`,
            };
        }
        // 3. Competitive Bundle Contention Check
        if (input.competitorState?.maxCompetitorTipLamports) {
            if (input.jitoTipLamports < input.competitorState.maxCompetitorTipLamports) {
                // Competitor out-bid the tip in block building
                return {
                    outcome: 'SIMULATED_NOLAND',
                    fillPriceSol: 0,
                    tokenDeltaRaw: 0n,
                    solDeltaLamports: 0n,
                    priceImpactBps: 0,
                    actualSlippageBps: 0,
                    priorityFeePaidLamports: input.priorityFeeLamports,
                    jitoTipPaidLamports: 0n,
                    networkFeePaidLamports: ExecutablePaperSimulator.BASE_NETWORK_FEE_LAMPORTS,
                    landedSlot,
                    latencyMs,
                    reason: 'OUTBID_BY_COMPETITOR_TIP',
                };
            }
        }
        // 4. Reserve & Liquidity Modeling
        let virtualQuote = input.bondingCurve?.virtualQuoteReserves ?? input.reserves.quote;
        let virtualToken = input.bondingCurve?.virtualTokenReserves ?? input.reserves.base;
        // Check for unexitability / zero reserves
        if (virtualQuote <= 0n || virtualToken <= 0n) {
            return {
                outcome: 'SIMULATED_UNEXITABLE',
                fillPriceSol: 0,
                tokenDeltaRaw: 0n,
                solDeltaLamports: 0n,
                priceImpactBps: 10_000,
                actualSlippageBps: 10_000,
                priorityFeePaidLamports: input.priorityFeeLamports,
                jitoTipPaidLamports: 0n,
                networkFeePaidLamports: ExecutablePaperSimulator.BASE_NETWORK_FEE_LAMPORTS,
                landedSlot,
                latencyMs,
                reason: 'ZERO_LIQUIDITY_UNEXITABLE',
            };
        }
        // Spot Price (Sol per raw token unit)
        const initialPriceSol = Number(virtualQuote) / Number(virtualToken);
        if (input.side === 'BUY') {
            const solIn = input.positionSizeLamports;
            if (solIn <= 0n) {
                return {
                    outcome: 'NOT_ATTEMPTED',
                    fillPriceSol: 0,
                    tokenDeltaRaw: 0n,
                    solDeltaLamports: 0n,
                    priceImpactBps: 0,
                    actualSlippageBps: 0,
                    priorityFeePaidLamports: 0n,
                    jitoTipPaidLamports: 0n,
                    networkFeePaidLamports: 0n,
                    landedSlot,
                    latencyMs,
                    reason: 'ZERO_BUY_AMOUNT',
                };
            }
            // Constant product: (Q + dQ) * (T - dT) = Q * T
            // dT = T - (Q * T) / (Q + dQ) = (T * dQ) / (Q + dQ)
            const k = virtualQuote * virtualToken;
            const newQuote = virtualQuote + solIn;
            const newToken = k / newQuote;
            const tokensOut = virtualToken - newToken;
            if (tokensOut <= 0n) {
                return {
                    outcome: 'SIMULATED_REJECTED',
                    fillPriceSol: 0,
                    tokenDeltaRaw: 0n,
                    solDeltaLamports: 0n,
                    priceImpactBps: 0,
                    actualSlippageBps: 0,
                    priorityFeePaidLamports: input.priorityFeeLamports,
                    jitoTipPaidLamports: 0n,
                    networkFeePaidLamports: ExecutablePaperSimulator.BASE_NETWORK_FEE_LAMPORTS,
                    landedSlot,
                    latencyMs,
                    reason: 'INSUFFICIENT_POOL_OUTPUT',
                };
            }
            const executionPriceSol = Number(solIn) / Number(tokensOut);
            const priceImpactBps = Math.round(((executionPriceSol - initialPriceSol) / initialPriceSol) * 10_000);
            // Latency price drift: in fast runners, price drifts during execution
            const latencyDriftBps = Math.min(500, Math.floor(latencyMs / 50));
            const totalSlippageBps = priceImpactBps + latencyDriftBps;
            if (totalSlippageBps > input.maxSlippageBps) {
                return {
                    outcome: 'SIMULATED_REJECTED',
                    fillPriceSol: 0,
                    tokenDeltaRaw: 0n,
                    solDeltaLamports: 0n,
                    priceImpactBps,
                    actualSlippageBps: totalSlippageBps,
                    priorityFeePaidLamports: input.priorityFeeLamports,
                    jitoTipPaidLamports: 0n,
                    networkFeePaidLamports: ExecutablePaperSimulator.BASE_NETWORK_FEE_LAMPORTS,
                    landedSlot,
                    latencyMs,
                    reason: `SLIPPAGE_TOLERANCE_EXCEEDED (actual: ${totalSlippageBps} bps > max: ${input.maxSlippageBps} bps)`,
                };
            }
            const totalFeeLamports = ExecutablePaperSimulator.BASE_NETWORK_FEE_LAMPORTS + input.priorityFeeLamports + input.jitoTipLamports;
            return {
                outcome: 'SIMULATED_FILLED',
                fillPriceSol: executionPriceSol,
                tokenDeltaRaw: tokensOut,
                solDeltaLamports: -(solIn + totalFeeLamports),
                priceImpactBps,
                actualSlippageBps: totalSlippageBps,
                priorityFeePaidLamports: input.priorityFeeLamports,
                jitoTipPaidLamports: input.jitoTipLamports,
                networkFeePaidLamports: ExecutablePaperSimulator.BASE_NETWORK_FEE_LAMPORTS,
                landedSlot,
                latencyMs,
            };
        }
        else {
            // SELL simulation
            const tokensIn = input.tokenQuantityRaw ?? 0n;
            if (tokensIn <= 0n) {
                return {
                    outcome: 'NOT_ATTEMPTED',
                    fillPriceSol: 0,
                    tokenDeltaRaw: 0n,
                    solDeltaLamports: 0n,
                    priceImpactBps: 0,
                    actualSlippageBps: 0,
                    priorityFeePaidLamports: 0n,
                    jitoTipPaidLamports: 0n,
                    networkFeePaidLamports: 0n,
                    landedSlot,
                    latencyMs,
                    reason: 'ZERO_SELL_AMOUNT',
                };
            }
            // Constant product: (T + dT) * (Q - dQ) = Q * T
            // dQ = Q - (Q * T) / (T + dT) = (Q * dT) / (T + dT)
            const k = virtualQuote * virtualToken;
            const newToken = virtualToken + tokensIn;
            const newQuote = k / newToken;
            const solOut = virtualQuote - newQuote;
            if (solOut <= 0n || solOut > virtualQuote) {
                return {
                    outcome: 'SIMULATED_UNEXITABLE',
                    fillPriceSol: 0,
                    tokenDeltaRaw: 0n,
                    solDeltaLamports: 0n,
                    priceImpactBps: 10_000,
                    actualSlippageBps: 10_000,
                    priorityFeePaidLamports: input.priorityFeeLamports,
                    jitoTipPaidLamports: 0n,
                    networkFeePaidLamports: ExecutablePaperSimulator.BASE_NETWORK_FEE_LAMPORTS,
                    landedSlot,
                    latencyMs,
                    reason: 'INSUFFICIENT_POOL_QUOTE_RESERVES',
                };
            }
            const executionPriceSol = Number(solOut) / Number(tokensIn);
            const priceImpactBps = Math.round(((initialPriceSol - executionPriceSol) / initialPriceSol) * 10_000);
            if (priceImpactBps > 8_000) {
                // More than 80% loss to exit liquidity -> unexitability hazard
                return {
                    outcome: 'SIMULATED_UNEXITABLE',
                    fillPriceSol: executionPriceSol,
                    tokenDeltaRaw: -tokensIn,
                    solDeltaLamports: solOut,
                    priceImpactBps,
                    actualSlippageBps: priceImpactBps,
                    priorityFeePaidLamports: input.priorityFeeLamports,
                    jitoTipPaidLamports: input.jitoTipLamports,
                    networkFeePaidLamports: ExecutablePaperSimulator.BASE_NETWORK_FEE_LAMPORTS,
                    landedSlot,
                    latencyMs,
                    reason: 'CATASTROPHIC_EXIT_IMPACT_UNEXITABLE',
                };
            }
            const totalFeeLamports = ExecutablePaperSimulator.BASE_NETWORK_FEE_LAMPORTS + input.priorityFeeLamports + input.jitoTipLamports;
            return {
                outcome: 'SIMULATED_FILLED',
                fillPriceSol: executionPriceSol,
                tokenDeltaRaw: -tokensIn,
                solDeltaLamports: solOut > totalFeeLamports ? solOut - totalFeeLamports : 0n,
                priceImpactBps,
                actualSlippageBps: priceImpactBps,
                priorityFeePaidLamports: input.priorityFeeLamports,
                jitoTipPaidLamports: input.jitoTipLamports,
                networkFeePaidLamports: ExecutablePaperSimulator.BASE_NETWORK_FEE_LAMPORTS,
                landedSlot,
                latencyMs,
            };
        }
    }
}
//# sourceMappingURL=executable-paper-simulator.js.map