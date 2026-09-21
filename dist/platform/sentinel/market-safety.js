/**
 * SOL-SYLPH Multi-User Platform - Systemic Market Safety Engine
 * Specifications: Section XL (Systemic Market Safety Engine).
 *
 * Rules:
 * 1. Independent global market safety states: GREEN, YELLOW, ORANGE, RED, RECOVERY.
 * 2. Unclean reconciliation or catastrophic market failure triggers RED immediately.
 * 3. Hysteresis prevents rapid state flapping.
 * 4. RED state blocks all new risk deployment platform-wide.
 */
export const DEFAULT_MARKET_SAFETY_POLICY = {
    maxRpcErrorBpsYellow: 300,
    maxRpcErrorBpsRed: 1000,
    maxDexLiquidityDropBpsRed: 3000,
    maxRecentRugsRed: 4,
    recoveryCooldownMs: 60_000, // 60s for testing/eval
};
export class SystemicMarketSafetyEngine {
    currentState = 'GREEN';
    stateEnteredAt = Date.now();
    lastDeteriorationAt = 0;
    policy;
    constructor(policy = {}) {
        this.policy = { ...DEFAULT_MARKET_SAFETY_POLICY, ...policy };
    }
    getState() {
        return this.currentState;
    }
    getGlobalRiskScaleFactor() {
        switch (this.currentState) {
            case 'GREEN':
                return 1.0;
            case 'YELLOW':
                return 0.8;
            case 'ORANGE':
                return 0.5;
            case 'RECOVERY':
                return 0.3;
            case 'RED':
            default:
                return 0.0;
        }
    }
    evaluate(inputs, now = Date.now()) {
        // 1. Hard Safety Invariant: Any reconciliation uncleanliness triggers RED instantly
        if (!inputs.reconciliationClean) {
            this.transitionTo('RED', now);
            return this.currentState;
        }
        // 2. Immediate RED Conditions
        if (inputs.rpcFailureRateBps >= this.policy.maxRpcErrorBpsRed ||
            inputs.recentRugCount >= this.policy.maxRecentRugsRed ||
            inputs.dexLiquidityDropBps >= this.policy.maxDexLiquidityDropBpsRed) {
            this.transitionTo('RED', now);
            return this.currentState;
        }
        // 3. ORANGE Conditions
        if (inputs.rpcFailureRateBps >= this.policy.maxRpcErrorBpsYellow * 2 ||
            inputs.recentRugCount >= 2 ||
            inputs.dexLiquidityDropBps >= 1500) {
            if (this.currentState === 'RED') {
                // Must stay in RED or transition through RECOVERY with hysteresis
                this.checkHysteresisRecovery(now, 'ORANGE');
            }
            else {
                this.transitionTo('ORANGE', now);
            }
            return this.currentState;
        }
        // 4. YELLOW Conditions
        if (inputs.rpcFailureRateBps >= this.policy.maxRpcErrorBpsYellow || inputs.recentRugCount >= 1) {
            if (this.currentState === 'RED' || this.currentState === 'ORANGE') {
                this.checkHysteresisRecovery(now, 'YELLOW');
            }
            else {
                this.transitionTo('YELLOW', now);
            }
            return this.currentState;
        }
        // 5. Clean Conditions -> Progressively recover with hysteresis
        if (this.currentState === 'RED') {
            this.checkHysteresisRecovery(now, 'RECOVERY');
        }
        else if (this.currentState === 'RECOVERY' || this.currentState === 'ORANGE' || this.currentState === 'YELLOW') {
            this.checkHysteresisRecovery(now, 'GREEN');
        }
        return this.currentState;
    }
    transitionTo(newState, now) {
        if (this.currentState !== newState) {
            this.currentState = newState;
            this.stateEnteredAt = now;
            if (newState === 'RED' || newState === 'ORANGE' || newState === 'YELLOW') {
                this.lastDeteriorationAt = now;
            }
        }
    }
    checkHysteresisRecovery(now, targetState) {
        // Only recover if sufficient clean time has elapsed
        if (now - this.lastDeteriorationAt >= this.policy.recoveryCooldownMs) {
            this.transitionTo(targetState, now);
        }
    }
}
//# sourceMappingURL=market-safety.js.map