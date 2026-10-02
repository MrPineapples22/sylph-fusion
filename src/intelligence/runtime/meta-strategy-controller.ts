/**
 * SOL-SYLPH Intelligence Fabric - Meta-Strategy Controller
 * Specifications: Master Blueprint Section 72 & Stage 12 (Meta-SYLPH).
 *
 * Implements:
 * 1. 10 Discrete Strategy Execution Modes:
 *    - LAUNCH_SNIPER: ultra-fast entry in sub-10-second mint formulation
 *    - BONDING_EXPANSION: capturing 15% - 80% curve acceleration
 *    - MIGRATION: capturing pre/post AMM graduation transitions
 *    - POST_MIGRATION: trading established AMM pools (Raydium / PumpSwap)
 *    - MOMENTUM: high-conviction breakout with positive capital acceleration
 *    - CHOP: mean-reverting scalp with tight stops
 *    - CRASH: capital defense and opportunistic distress dip captures
 *    - LIQUIDITY_DEFENSIVE: reduce-only, strict liquidation preservation
 *    - UNKNOWN_REGIME: low-exposure shadow-first observation
 *    - SHADOW_ONLY: paper-only research mode with zero live broadcast
 * 2. Meta-Policy Controller:
 *    Dynamically matches ecosystem regime, token lifecycle phase, and alpha half-life to optimal strategy.
 * 3. Deterministic Invariant:
 *    Meta-controller may select strategies, but CANNOT override deterministic safety or Capital Barrier restrictions.
 */

import { createHash } from 'node:crypto';
import type { LifecyclePhase } from '../lifecycle/lifecycle-x.js';

export type StrategyExecutionMode =
  | 'LAUNCH_SNIPER'
  | 'BONDING_EXPANSION'
  | 'MIGRATION'
  | 'POST_MIGRATION'
  | 'MOMENTUM'
  | 'CHOP'
  | 'CRASH'
  | 'LIQUIDITY_DEFENSIVE'
  | 'UNKNOWN_REGIME'
  | 'SHADOW_ONLY';

export interface MetaStrategySelectionInputs {
  readonly mint: string;
  readonly lifecyclePhase: LifecyclePhase;
  readonly ecosystemRegime: 'expansion' | 'neutral' | 'launch_mania' | 'capital_fragmentation' | 'liquidity_stress' | 'execution_stress' | 'unknown';
  readonly alphaHalfLifeMs: number;
  readonly poolLiquiditySol: number;
  readonly netCapitalVelocity: number;
  readonly truthDebtCount: number;
  readonly currentDrawdownPct: number;
}

export interface MetaStrategyVerdict {
  readonly selectedMode: StrategyExecutionMode;
  readonly rationale: string;
  readonly maxPermittedExposureFraction: number; // 0.0 - 1.0 multiplier on capital limit
  readonly targetHoldTimeMaxSec: number;
  readonly isLiveBroadcastingAllowed: boolean;
  readonly verdictDigest: string;
}

export class MetaStrategyController {
  /**
   * Evaluates ecosystem and lifecycle state to select the active strategy mode.
   */
  public static selectStrategy(inputs: MetaStrategySelectionInputs): MetaStrategyVerdict {
    const {
      mint,
      lifecyclePhase,
      ecosystemRegime,
      alphaHalfLifeMs,
      poolLiquiditySol,
      netCapitalVelocity,
      truthDebtCount,
      currentDrawdownPct,
    } = inputs;

    // Hard Override 1: Truth Debt or high drawdown forces defensive mode
    if (truthDebtCount >= 3 || currentDrawdownPct >= 12.0) {
      return this.buildVerdict(
        'LIQUIDITY_DEFENSIVE',
        `RISK_OVERRIDE: Truth debt (${truthDebtCount}) or drawdown (${currentDrawdownPct}%) requires capital defense`,
        0.0,
        30,
        false,
        mint
      );
    }

    // Hard Override 2: Unknown regime or stressed environment forces shadow or defensive
    if (ecosystemRegime === 'liquidity_stress' || ecosystemRegime === 'execution_stress') {
      return this.buildVerdict(
        'LIQUIDITY_DEFENSIVE',
        `REGIME_STRESS: Ecosystem in ${ecosystemRegime}; trading restricted to capital defense`,
        0.2,
        60,
        true,
        mint
      );
    }

    if (ecosystemRegime === 'unknown') {
      return this.buildVerdict(
        'UNKNOWN_REGIME',
        'REGIME_UNKNOWN: Unclassified ecosystem macro state; operating in reduced exposure probe mode',
        0.3,
        90,
        true,
        mint
      );
    }

    // Lifecycle Phase Matching
    switch (lifecyclePhase) {
      case 'LAUNCH':
      case 'INITIAL_DISCOVERY':
        if (alphaHalfLifeMs < 2000 && netCapitalVelocity > 1.0) {
          return this.buildVerdict(
            'LAUNCH_SNIPER',
            'EARLY_DISCOVERY: High-velocity launch formulation with ultra-short alpha half-life',
            0.5,
            45,
            true,
            mint
          );
        }
        return this.buildVerdict(
          'BONDING_EXPANSION',
          'EARLY_CURVE: Developing curve formulation with moderate momentum',
          0.6,
          120,
          true,
          mint
        );

      case 'EARLY_BONDING':
      case 'BONDING_EXPANSION':
      case 'CURVE_ACCELERATION':
        return this.buildVerdict(
          'BONDING_EXPANSION',
          'CURVE_ACCELERATION: Active bonding curve progress with expanding capital participation',
          1.0,
          180,
          true,
          mint
        );

      case 'NEAR_MIGRATION':
      case 'MIGRATING':
        return this.buildVerdict(
          'MIGRATION',
          'GRADUATION_LOCK: Approaching or undergoing DEX liquidity migration',
          0.7,
          90,
          true,
          mint
        );

      case 'POST_MIGRATION_DISCOVERY':
      case 'POST_MIGRATION_EXPANSION':
      case 'MATURE_EXPANSION':
        return this.buildVerdict(
          'POST_MIGRATION',
          'AMM_TRADING: Established Raydium/PumpSwap liquidity pool with deep multi-route exit depth',
          1.0,
          300,
          true,
          mint
        );

      case 'MOMENTUM':
        return this.buildVerdict(
          'MOMENTUM',
          'BREAKOUT_EXPANSION: High-velocity breakout with sustained entity inflows',
          1.0,
          240,
          true,
          mint
        );

      case 'DISTRIBUTION':
      case 'LIQUIDITY_DECAY':
      case 'COLLAPSE':
      case 'DEAD':
        return this.buildVerdict(
          'LIQUIDITY_DEFENSIVE',
          'ADVERSE_LIFECYCLE: Token in terminal or distribution phase; entries blocked',
          0.0,
          30,
          false,
          mint
        );

      default:
        return this.buildVerdict(
          'SHADOW_ONLY',
          'UNCLASSIFIED_PHASE: Fallback to shadow simulation',
          0.0,
          60,
          false,
          mint
        );
    }
  }

  private static buildVerdict(
    mode: StrategyExecutionMode,
    rationale: string,
    exposureFraction: number,
    holdTimeSec: number,
    isLiveAllowed: boolean,
    mint: string
  ): MetaStrategyVerdict {
    const verdictDigest = createHash('sha256')
      .update('META_STRATEGY:')
      .update(mint)
      .update(mode)
      .update(exposureFraction.toString())
      .update(isLiveAllowed ? 'LIVE' : 'PAPER')
      .digest('hex');

    return {
      selectedMode: mode,
      rationale,
      maxPermittedExposureFraction: exposureFraction,
      targetHoldTimeMaxSec: holdTimeSec,
      isLiveBroadcastingAllowed: isLiveAllowed,
      verdictDigest,
    };
  }
}
