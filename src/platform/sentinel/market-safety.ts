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

import type { SystemicMarketInputs, SystemicSafetyState } from './types.js';

export interface MarketSafetyPolicy {
  readonly maxRpcErrorBpsYellow: number; // e.g. 300 bps (3%)
  readonly maxRpcErrorBpsRed: number; // e.g. 1000 bps (10%)
  readonly maxDexLiquidityDropBpsRed: number; // e.g. 3000 bps (30%)
  readonly maxRecentRugsRed: number; // e.g. 4
  readonly recoveryCooldownMs: number; // minimum clean window
}

export const DEFAULT_MARKET_SAFETY_POLICY: MarketSafetyPolicy = {
  maxRpcErrorBpsYellow: 300,
  maxRpcErrorBpsRed: 1000,
  maxDexLiquidityDropBpsRed: 3000,
  maxRecentRugsRed: 4,
  recoveryCooldownMs: 60_000, // 60s for testing/eval
};

export class SystemicMarketSafetyEngine {
  private currentState: SystemicSafetyState = 'GREEN';
  private stateEnteredAt: number = Date.now();
  private lastDeteriorationAt: number = 0;
  private readonly policy: MarketSafetyPolicy;

  constructor(policy: Partial<MarketSafetyPolicy> = {}) {
    this.policy = { ...DEFAULT_MARKET_SAFETY_POLICY, ...policy };
  }

  public getState(): SystemicSafetyState {
    return this.currentState;
  }

  public getGlobalRiskScaleFactor(): number {
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

  public evaluate(inputs: SystemicMarketInputs, now = Date.now()): SystemicSafetyState {
    // 1. Hard Safety Invariant: Any reconciliation uncleanliness triggers RED instantly
    if (!inputs.reconciliationClean) {
      this.transitionTo('RED', now);
      return this.currentState;
    }

    // 2. Immediate RED Conditions
    if (
      inputs.rpcFailureRateBps >= this.policy.maxRpcErrorBpsRed ||
      inputs.recentRugCount >= this.policy.maxRecentRugsRed ||
      inputs.dexLiquidityDropBps >= this.policy.maxDexLiquidityDropBpsRed
    ) {
      this.transitionTo('RED', now);
      return this.currentState;
    }

    // 3. ORANGE Conditions
    if (
      inputs.rpcFailureRateBps >= this.policy.maxRpcErrorBpsYellow * 2 ||
      inputs.recentRugCount >= 2 ||
      inputs.dexLiquidityDropBps >= 1500
    ) {
      if (this.currentState === 'RED') {
        // Must stay in RED or transition through RECOVERY with hysteresis
        this.checkHysteresisRecovery(now, 'ORANGE');
      } else {
        this.transitionTo('ORANGE', now);
      }
      return this.currentState;
    }

    // 4. YELLOW Conditions
    if (inputs.rpcFailureRateBps >= this.policy.maxRpcErrorBpsYellow || inputs.recentRugCount >= 1) {
      if (this.currentState === 'RED' || this.currentState === 'ORANGE') {
        this.checkHysteresisRecovery(now, 'YELLOW');
      } else {
        this.transitionTo('YELLOW', now);
      }
      return this.currentState;
    }

    // 5. Clean Conditions -> Progressively recover with hysteresis
    if (this.currentState === 'RED') {
      this.checkHysteresisRecovery(now, 'RECOVERY');
    } else if (this.currentState === 'RECOVERY' || this.currentState === 'ORANGE' || this.currentState === 'YELLOW') {
      this.checkHysteresisRecovery(now, 'GREEN');
    }

    return this.currentState;
  }

  private transitionTo(newState: SystemicSafetyState, now: number): void {
    if (this.currentState !== newState) {
      this.currentState = newState;
      this.stateEnteredAt = now;
      if (newState === 'RED' || newState === 'ORANGE' || newState === 'YELLOW') {
        this.lastDeteriorationAt = now;
      }
    }
  }

  private checkHysteresisRecovery(now: number, targetState: SystemicSafetyState): void {
    // Only recover if sufficient clean time has elapsed
    if (now - this.lastDeteriorationAt >= this.policy.recoveryCooldownMs) {
      this.transitionTo(targetState, now);
    }
  }
}
