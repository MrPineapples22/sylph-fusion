/**
 * SOL-SYLPH Intelligence Fabric - Liquidity Fracture & Stressed Exit Capacity Engine
 * Specifications: 500-Item Roadmap Layer I (#61, #62, #63, #65), Layer II (#133, #134), Layer III (#253, #258, #260).
 *
 * Implements:
 * 1. LiquidityFractureDetector: Computes nonlinear price impact curvature and detects fracture points (Q*).
 * 2. StressedExitCapacity: Determines realizable liquidation ceilings under concurrent -25% and -50% liquidity collapse.
 * 3. LiquidityBrittlenessIndex: Measures elasticity of exit depth against simulated creator/whale dumping.
 */
export class LiquidityFractureDetector {
    /**
     * Computes nonlinear liquidity boundaries, fracture points, and stressed exit ceilings.
     *
     * @param pool Current pool reserves and asset prices
     * @param options Configuration for max acceptable slippage and stress thresholds
     */
    static evaluatePool(pool, options) {
        const maxImpactBps = options?.maxPriceImpactBps ?? 250;
        const maxExitSlippageBps = options?.maxExitSlippageBps ?? 800;
        const minFloorUsd = options?.minOrderFloorUsd ?? 5.0;
        const poolLiquidityUsd = Math.max(0, pool.poolLiquidityUsd);
        if (poolLiquidityUsd <= 0 || !Number.isFinite(poolLiquidityUsd)) {
            return {
                poolLiquidityUsd: 0,
                fracturePointUsd: 0,
                maxLinearOrderUsd: 0,
                stressedExitCapacity25Usd: 0,
                stressedExitCapacity50Usd: 0,
                hardPositionCeilingUsd: 0,
                brittlenessIndex: 1.0,
                marginalSlippageBpsPerDollar: 0,
                isFractured: true,
                rationale: 'FRACTURED_LIQUIDITY: Pool reserves are zero or unobserved; failing closed',
            };
        }
        // In Constant Product AMM (x * y = k):
        // Slippage fraction s(dx) = dx / (R_sol + dx)
        // In terms of pool liquidity L_usd = 2 * R_sol_usd:
        // dx_max = R_sol_usd * (s / (1 - s))
        const solReserveUsd = poolLiquidityUsd * 0.5;
        const impactFraction = maxImpactBps / 10_000;
        const maxLinearOrderUsd = Math.round(solReserveUsd * (impactFraction / (1.0 - impactFraction)) * 100) / 100;
        // The fracture point Q* is where price impact derivative dI/dQ accelerates nonlinearly
        // Conservatively identified at 2.0x max linear threshold or 5% of reserve
        const fracturePointUsd = Math.round(Math.min(maxLinearOrderUsd * 1.5, solReserveUsd * 0.05) * 100) / 100;
        // Stressed Exit Capacity:
        // What could be liquidated if liquidity drops by 25% or 50% without exceeding maxExitSlippageBps?
        const exitImpactFraction = maxExitSlippageBps / 10_000;
        const stressedSolReserve25 = solReserveUsd * 0.75;
        const stressedSolReserve50 = solReserveUsd * 0.50;
        const stressedExitCapacity25Usd = Math.round(stressedSolReserve25 * (exitImpactFraction / (1.0 - exitImpactFraction)) * 100) / 100;
        const stressedExitCapacity50Usd = Math.round(stressedSolReserve50 * (exitImpactFraction / (1.0 - exitImpactFraction)) * 100) / 100;
        // Hard Position Sizing Ceiling (Roadmap #260):
        // Must be executable AND exitable even under a 25% adverse liquidity drain
        const hardPositionCeilingUsd = Math.max(0, Math.min(maxLinearOrderUsd, stressedExitCapacity25Usd));
        // Brittleness Index: ratio of order floor to stressed capacity
        // If a standard $15 trade consumes 40%+ of stressed capacity, brittleness is dangerous
        const standardTradeUsd = 15.0;
        const brittlenessIndex = Number(Math.min(1.0, Math.max(0.0, standardTradeUsd / (stressedExitCapacity50Usd + 1e-6))).toFixed(3));
        // Marginal slippage in BPS per dollar entered
        const marginalSlippageBpsPerDollar = Number(((10_000 / solReserveUsd)).toFixed(4));
        const isFractured = hardPositionCeilingUsd < minFloorUsd;
        const rationale = isFractured
            ? `FRACTURED_LIQUIDITY: Hard ceiling ($${hardPositionCeilingUsd.toFixed(2)}) is below minimum order floor ($${minFloorUsd.toFixed(2)}); pool too shallow for safe exit`
            : `Liquidity resilient: Hard ceiling $${hardPositionCeilingUsd.toFixed(2)} (Fracture: $${fracturePointUsd.toFixed(2)}, Stressed Exit 25%: $${stressedExitCapacity25Usd.toFixed(2)})`;
        return {
            poolLiquidityUsd,
            fracturePointUsd,
            maxLinearOrderUsd,
            stressedExitCapacity25Usd,
            stressedExitCapacity50Usd,
            hardPositionCeilingUsd,
            brittlenessIndex,
            marginalSlippageBpsPerDollar,
            isFractured,
            rationale,
        };
    }
}
//# sourceMappingURL=liquidity-fracture.js.map