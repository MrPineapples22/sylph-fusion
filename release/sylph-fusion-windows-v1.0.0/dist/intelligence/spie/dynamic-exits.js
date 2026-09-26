/**
 * SOL-SYLPH Platform - Dynamic Exit Engine
 * Specifications: Master Quantitative Upgrade (Phase 6 & 9).
 *
 * Implements reactive, multi-stage position exits:
 * 1. Toxic Flow Defense: 100% exit on institutional or cluster sell runs
 * 2. Liquidity Shock Defense: 100% exit on single-block reserve drop > 15%
 * 3. Dynamic Volatility Trailing Stop: 1.5x ATR trailing once in profit
 * 4. Staged Profit Taking: 33% at +35%, 33% at +75%, 34% moonbag trailing
 */
export class DynamicExitEngine {
    initialStructuralStopPct = 0.12; // -12% hard structural stop
    trailingStopAtrMultiplier = 0.15; // 15% dynamic trail off peak
    liquidityShockThresholdPct = 0.15; // 15% single-block drop
    evaluateExit(pos) {
        const entry = pos.entryPriceUsd;
        const current = pos.currentPriceUsd;
        const peak = Math.max(pos.highestPriceUsd, current);
        // Initial default stop: 12% below entry
        let effectiveStopPriceUsd = entry * (1 - this.initialStructuralStopPct);
        // 1. Hard Invariant: Developer / Creator Dump
        if (pos.isDevSold) {
            return {
                action: 'EXIT_100_INVALIDATION',
                reduceFraction: 1.0,
                triggerReason: 'CREATOR_SELL_DETECTED',
                effectiveStopPriceUsd,
                isUrgent: true,
                notes: 'Developer sold tokens on active curve; thesis invalidated instantly.',
            };
        }
        // 2. Liquidity Shock Defense (Rug / LP drain attempt)
        if (pos.priorBlockSolReserve > 0) {
            const dropPct = (pos.priorBlockSolReserve - pos.realSolReserve) / pos.priorBlockSolReserve;
            if (dropPct >= this.liquidityShockThresholdPct) {
                return {
                    action: 'EXIT_100_LIQUIDITY_SHOCK',
                    reduceFraction: 1.0,
                    triggerReason: `LIQUIDITY_SHOCK: Real reserves dropped ${(dropPct * 100).toFixed(1)}% in one block`,
                    effectiveStopPriceUsd,
                    isUrgent: true,
                    notes: 'Sudden deep liquidity removal detected; sweeping exit before pool is drained.',
                };
            }
        }
        // 3. Adverse Flow Toxicity Stop
        // If 4 or more consecutive blocks have >75% selling, bail out before waterfall
        if (pos.consecutiveSellBlocks >= 4 && pos.currentSellPressureRatio >= 0.75) {
            return {
                action: 'EXIT_100_TOXICITY',
                reduceFraction: 1.0,
                triggerReason: `ADVERSE_FLOW_TOXICITY: ${pos.consecutiveSellBlocks} consecutive sell blocks`,
                effectiveStopPriceUsd,
                isUrgent: true,
                notes: 'Coordinated exit cluster detected; unwinding position immediately.',
            };
        }
        // 4. Staged Profit Taking & Trailing Stop Updates
        // If in profit by >= +35% and stage 0 completed
        if (pos.unrealizedPnlPct >= 0.75 && pos.stagesCompleted < 2) {
            // Stage 2: Take additional 33% profit at +75%
            return {
                action: 'REDUCE_66',
                reduceFraction: 0.33,
                triggerReason: `TAKE_PROFIT_STAGE_2 (+${(pos.unrealizedPnlPct * 100).toFixed(1)}% >= +75%)`,
                effectiveStopPriceUsd: entry * 1.25, // Lock in +25% profit floor on remainder
                isUrgent: false,
                notes: 'Unwind second 33% tranche; raise protective stop to +25% above entry.',
            };
        }
        else if (pos.unrealizedPnlPct >= 0.35 && pos.stagesCompleted < 1) {
            // Stage 1: Take 33% profit at +35%
            return {
                action: 'REDUCE_33',
                reduceFraction: 0.33,
                triggerReason: `TAKE_PROFIT_STAGE_1 (+${(pos.unrealizedPnlPct * 100).toFixed(1)}% >= +35%)`,
                effectiveStopPriceUsd: entry * 1.05, // Move stop to Breakeven + 5%
                isUrgent: false,
                notes: 'Unwind initial 33% tranche; move stop to Breakeven +5% to eliminate downside risk.',
            };
        }
        // 5. Dynamic Trailing Stop
        // Once peaked > +20%, trail stop from peak by 15%
        if (peak >= entry * 1.20) {
            const dynamicTrail = peak * (1 - this.trailingStopAtrMultiplier);
            effectiveStopPriceUsd = Math.max(effectiveStopPriceUsd, dynamicTrail);
            if (current <= effectiveStopPriceUsd) {
                return {
                    action: 'EXIT_100_STOP',
                    reduceFraction: 1.0,
                    triggerReason: `DYNAMIC_TRAILING_STOP (Hit $${effectiveStopPriceUsd.toFixed(6)} trailing from peak $${peak.toFixed(6)})`,
                    effectiveStopPriceUsd,
                    isUrgent: false,
                    notes: 'Momentum decay reached trailing buffer; realizing remainder.',
                };
            }
        }
        // 6. Hard Structural Stop Loss
        if (current <= effectiveStopPriceUsd) {
            return {
                action: 'EXIT_100_STOP',
                reduceFraction: 1.0,
                triggerReason: `STRUCTURAL_STOP_LOSS (Current $${current.toFixed(6)} <= Stop $${effectiveStopPriceUsd.toFixed(6)})`,
                effectiveStopPriceUsd,
                isUrgent: true,
                notes: 'Hit structural stop loss floor; cutting risk immediately.',
            };
        }
        // 7. Default: Hold Position
        return {
            action: 'HOLD',
            reduceFraction: 0.0,
            triggerReason: 'NONE',
            effectiveStopPriceUsd,
            isUrgent: false,
            notes: `Position healthy (${(pos.unrealizedPnlPct * 100).toFixed(1)}% P&L). Protective stop at $${effectiveStopPriceUsd.toFixed(6)}.`,
        };
    }
}
//# sourceMappingURL=dynamic-exits.js.map