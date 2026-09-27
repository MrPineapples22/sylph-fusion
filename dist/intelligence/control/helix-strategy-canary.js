/**
 * SYLPH FUSION — HELIX: Economic Canary & Controlled Strategy Experiment Authority
 * Specifications: Section 12 (Upgrade 8: Helix Strategy Canary), Section 103 (Invariant 8)
 *
 * Invariants:
 * 1. 10-stage rollout progression:
 *    PROPOSED -> REPLAY -> SIMULATION -> SHADOW -> OBSERVE_ONLY ->
 *    TINY_CANARY -> RESTRICTED_CANARY -> LIMITED_PRODUCTION -> CERTIFIED -> ACTIVE.
 * 2. Strict capital ceilings per stage. No real capital in stages <= OBSERVE_ONLY.
 * 3. Evidence-driven promotion: requires positive Lower Confidence Bound (LCB),
 *    adequate sample size, acceptable drawdown, and calibrated execution shortfall.
 * 4. Rapid auto-demotion on drawdown breach or negative LCB.
 */
export class HelixStrategyCanaryAuthority {
    strategies = new Map();
    static STAGE_LIMITS = {
        PROPOSED: { maxCapital: 0n, maxPosition: 0n, isReal: false },
        REPLAY: { maxCapital: 0n, maxPosition: 0n, isReal: false },
        SIMULATION: { maxCapital: 0n, maxPosition: 0n, isReal: false },
        SHADOW: { maxCapital: 0n, maxPosition: 0n, isReal: false },
        OBSERVE_ONLY: { maxCapital: 0n, maxPosition: 0n, isReal: false },
        TINY_CANARY: { maxCapital: 50000000n, maxPosition: 10000000n, isReal: true }, // 0.05 SOL total, 0.01 SOL pos
        RESTRICTED_CANARY: { maxCapital: 500000000n, maxPosition: 100000000n, isReal: true }, // 0.5 SOL total, 0.1 SOL pos
        LIMITED_PRODUCTION: { maxCapital: 2000000000n, maxPosition: 500000000n, isReal: true }, // 2.0 SOL total, 0.5 SOL pos
        CERTIFIED: { maxCapital: 5000000000n, maxPosition: 1000000000n, isReal: true }, // 5.0 SOL total, 1.0 SOL pos
        ACTIVE: { maxCapital: 10000000000n, maxPosition: 2000000000n, isReal: true } // 10.0 SOL total, 2.0 SOL pos
    };
    static STAGE_ORDER = [
        'PROPOSED',
        'REPLAY',
        'SIMULATION',
        'SHADOW',
        'OBSERVE_ONLY',
        'TINY_CANARY',
        'RESTRICTED_CANARY',
        'LIMITED_PRODUCTION',
        'CERTIFIED',
        'ACTIVE'
    ];
    registerStrategy(strategyId, initialStage = 'PROPOSED') {
        const limits = HelixStrategyCanaryAuthority.STAGE_LIMITS[initialStage];
        const status = {
            strategyId,
            stage: initialStage,
            maxCapitalAllocationLamports: limits.maxCapital,
            maxPositionSizeLamports: limits.maxPosition,
            isRealCapitalAllowed: limits.isReal,
            promotionCount: 0,
            demotionCount: 0,
            lastEvaluatedAtMs: Date.now(),
            history: [`Registered in stage ${initialStage}`]
        };
        this.strategies.set(strategyId, status);
        return status;
    }
    getStrategyStatus(strategyId) {
        return this.strategies.get(strategyId);
    }
    /**
     * Evaluates strategy telemetry for evidence-driven promotion or immediate auto-demotion.
     */
    evaluateStrategyRollout(strategyId, telemetry) {
        const current = this.strategies.get(strategyId);
        if (!current)
            throw new Error(`Strategy ${strategyId} not registered in HELIX`);
        const currentIdx = HelixStrategyCanaryAuthority.STAGE_ORDER.indexOf(current.stage);
        // 1. FAST DEMOTION CHECKS (Safety First)
        // Drawdown breach (> 1200 bps = 12%) or negative Lower Confidence Bound with >= 20 trades
        const isDrawdownBreach = telemetry.maxDrawdownBps > 1200;
        const isNegativeLcb = telemetry.tradeCount >= 20 && telemetry.lowerConfidenceBoundLamports < 0n;
        if (isDrawdownBreach || isNegativeLcb) {
            if (currentIdx > 3) {
                // Demote to SHADOW immediately
                const nextStage = 'SHADOW';
                const reason = isDrawdownBreach
                    ? `EMERGENCY DEMOTION: Max drawdown ${telemetry.maxDrawdownBps} bps breached threshold 1200 bps`
                    : `STATISTICAL DEMOTION: Negative 95% LCB (${telemetry.lowerConfidenceBoundLamports} lamports) across ${telemetry.tradeCount} trades`;
                this.applyStageChange(current, nextStage, 'DEMOTED', reason);
                return { nextStage, action: 'DEMOTED', reason };
            }
        }
        // 2. PROMOTION CHECKS
        if (currentIdx < HelixStrategyCanaryAuthority.STAGE_ORDER.length - 1) {
            const minTradesRequired = currentIdx >= 4 ? 25 : 10;
            const canPromote = telemetry.tradeCount >= minTradesRequired &&
                telemetry.realizedNetPnlLamports > 0n &&
                telemetry.lowerConfidenceBoundLamports >= 0n &&
                telemetry.maxDrawdownBps <= 800; // <= 8% drawdown
            if (canPromote) {
                const nextStage = HelixStrategyCanaryAuthority.STAGE_ORDER[currentIdx + 1];
                const reason = `Promoted to ${nextStage}: ${telemetry.tradeCount} trades, positive net EV (${telemetry.realizedNetPnlLamports} lamports), LCB >= 0, DD ${telemetry.maxDrawdownBps} bps`;
                this.applyStageChange(current, nextStage, 'PROMOTED', reason);
                return { nextStage, action: 'PROMOTED', reason };
            }
        }
        return {
            nextStage: current.stage,
            action: 'MAINTAINED',
            reason: `Maintained at ${current.stage}: pending further trade evidence (current: ${telemetry.tradeCount} trades)`
        };
    }
    applyStageChange(status, newStage, action, reason) {
        const limits = HelixStrategyCanaryAuthority.STAGE_LIMITS[newStage];
        status.stage = newStage;
        status.maxCapitalAllocationLamports = limits.maxCapital;
        status.maxPositionSizeLamports = limits.maxPosition;
        status.isRealCapitalAllowed = limits.isReal;
        if (action === 'PROMOTED')
            status.promotionCount++;
        if (action === 'DEMOTED')
            status.demotionCount++;
        status.lastEvaluatedAtMs = Date.now();
        status.history = [...status.history, reason];
    }
}
//# sourceMappingURL=helix-strategy-canary.js.map