export class EntryTimingEngine {
    evaluateTiming(telemetry) {
        // 1. Invalidation checks: high seller dominance or extreme dumping
        if (telemetry.sellPressureRatio > 0.70) {
            return {
                isReady: false,
                mode: 'WAIT_FOR_SETUP',
                timingScore: 15,
                confidence: 0.85,
                invalidationReason: `SELLER_DOMINANCE: Sell pressure ratio is ${(telemetry.sellPressureRatio * 100).toFixed(0)}% (>70% ceiling)`,
                notes: 'Excessive selling indicates early sniper dump or lack of organic bid support.',
            };
        }
        if (telemetry.retraceFromPeakPct > 0.40) {
            return {
                isReady: false,
                mode: 'WAIT_FOR_SETUP',
                timingScore: 20,
                confidence: 0.90,
                invalidationReason: `DEEP_PULLBACK_COLLAPSE: Retrace from peak is ${(telemetry.retraceFromPeakPct * 100).toFixed(0)}% (>40% breakdown)`,
                notes: 'Pullback exceeded 40% threshold; structural trend broken into possible rug.',
            };
        }
        // 2. Mode 1: Smart-Wallet Confirmation
        if (telemetry.smartWalletPresent && telemetry.sellPressureRatio < 0.45) {
            return {
                isReady: true,
                mode: 'SMART_WALLET_CONFIRMATION',
                timingScore: 92,
                confidence: 0.88,
                notes: 'Verified historical smart wallet accumulated with low adverse sell flow.',
            };
        }
        // 3. Mode 2: Pullback Confirmation Mode
        // Optimal for curves with established liquidity (> 3.0 SOL) that had an initial run
        if (telemetry.realSolReserve >= 3.0 && telemetry.tokenAgeSeconds >= 20) {
            if (telemetry.retraceFromPeakPct >= 0.08 && telemetry.retraceFromPeakPct <= 0.25) {
                if (telemetry.sellPressureRatio <= 0.40 && telemetry.uniqueBuyerGrowthRate >= 2) {
                    return {
                        isReady: true,
                        mode: 'PULLBACK_CONFIRMATION',
                        timingScore: 88,
                        confidence: 0.82,
                        notes: `Clean ${(telemetry.retraceFromPeakPct * 100).toFixed(1)}% pullback with seller exhaustion and new organic buyers entering.`,
                    };
                }
            }
        }
        // 4. Mode 3: Breakout Expansion Mode
        // Rapid momentum acceleration with broad buyer breadth
        if (telemetry.priceVelocityBps > 50 && telemetry.volumeVelocitySolSec > 0.5) {
            if (telemetry.uniqueBuyerGrowthRate >= 5 && telemetry.sellPressureRatio <= 0.30) {
                return {
                    isReady: true,
                    mode: 'BREAKOUT_EXPANSION',
                    timingScore: 85,
                    confidence: 0.78,
                    notes: `Breakout confirmed: +${telemetry.priceVelocityBps} BPS/s velocity with ${telemetry.volumeVelocitySolSec.toFixed(2)} SOL/s volume and expanding buyer breadth.`,
                };
            }
        }
        // 5. Mode 4: Liquidity Growth Mode
        // Consistent organic reserve accumulation
        if (telemetry.realSolReserve >= 2.5 && telemetry.recentTxCount >= 10 && telemetry.sellPressureRatio <= 0.35) {
            return {
                isReady: true,
                mode: 'LIQUIDITY_GROWTH',
                timingScore: 78,
                confidence: 0.75,
                notes: `Steady curve accumulation (${telemetry.realSolReserve.toFixed(2)} SOL reserves, ${telemetry.recentTxCount} txs).`,
            };
        }
        // 6. Default: Wait for Setup
        return {
            isReady: false,
            mode: 'WAIT_FOR_SETUP',
            timingScore: 45,
            confidence: 0.60,
            notes: 'Awaiting clean pullback or volume acceleration trigger before issuing permit.',
        };
    }
    /**
     * Advanced Entry Timing & Feasibility Gate:
     * 1. Anti-Top Climax Exhaustion: Rejects entries when token has surged >100% in <15s without consolidation.
     * 2. Entry Window Expiry: Blocks orders if discovery age exceeds 4.0 seconds (momentum decay).
     * 3. Volume Acceleration & Flow Derivatives: Verifies positive trade rate velocity.
     */
    validateEntryFeasibility(telemetry, opportunityAgeMs = 0) {
        // 1. Entry Window Expiration (4.0s Half-Life)
        if (opportunityAgeMs > 4_000) {
            return {
                canEnter: false,
                recommendedMode: 'WAIT_FOR_SETUP',
                confidence: 0,
                isClimaxExhaustion: false,
                isStaleWindow: true,
                flowAccelerationPositive: false,
                reason: `STALE_ENTRY_WINDOW: Signal age (${opportunityAgeMs}ms) exceeds 4000ms execution half-life`,
            };
        }
        // 2. Anti-Top Climax Exhaustion (Blow-off Top)
        // If token is very young (<30s) and price velocity is extreme (>4000 bps/s) with near-zero pullback
        if (telemetry.tokenAgeSeconds < 45 && telemetry.priceVelocityBps > 4_000 && telemetry.retraceFromPeakPct < 0.03) {
            return {
                canEnter: false,
                recommendedMode: 'PULLBACK_CONFIRMATION',
                confidence: 0.35,
                isClimaxExhaustion: true,
                isStaleWindow: false,
                flowAccelerationPositive: true,
                reason: 'ANTI_TOP_CLIMAX_EXHAUSTION: Extreme velocity without consolidation; wait for pullback',
            };
        }
        // 3. Flow Acceleration & Positive Trade Rate Velocity
        const flowPositive = telemetry.volumeVelocitySolSec > 0.05 && telemetry.uniqueBuyerGrowthRate >= 1.0;
        if (!flowPositive && telemetry.sellPressureRatio > 0.65) {
            return {
                canEnter: false,
                recommendedMode: 'WAIT_FOR_SETUP',
                confidence: 0.20,
                isClimaxExhaustion: false,
                isStaleWindow: false,
                flowAccelerationPositive: false,
                reason: 'NEGATIVE_FLOW_ACCELERATION: Sell pressure exceeds 65% with decaying buyer growth',
            };
        }
        const standardEval = this.evaluateTiming(telemetry);
        return {
            canEnter: standardEval.isReady,
            recommendedMode: standardEval.mode,
            confidence: standardEval.confidence,
            isClimaxExhaustion: false,
            isStaleWindow: false,
            flowAccelerationPositive: flowPositive,
            reason: standardEval.notes || standardEval.invalidationReason || 'Standard timing evaluation',
        };
    }
}
//# sourceMappingURL=entry-timing.js.map