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

export type ExitActionType =
  | 'HOLD'
  | 'REDUCE_50'
  | 'REDUCE_33'
  | 'REDUCE_66'
  | 'EXIT_100_PROFIT'
  | 'EXIT_100_STOP'
  | 'EXIT_100_TOXICITY'
  | 'EXIT_100_LIQUIDITY_SHOCK'
  | 'EXIT_100_INVALIDATION';

export interface PositionStateSnapshot {
  readonly mint: string;
  readonly entryPriceUsd: number;
  readonly currentPriceUsd: number;
  readonly highestPriceUsd: number;           // Peak price observed since entry
  readonly lowestPriceUsd: number;            // Trough price observed since entry
  readonly unrealizedPnlPct: number;          // e.g. +0.45 (+45%) or -0.08 (-8%)
  readonly realSolReserve: number;
  readonly priorBlockSolReserve: number;
  readonly consecutiveSellBlocks: number;     // Consecutive blocks where sells > 75%
  readonly currentSellPressureRatio: number;  // Recent sell / (buy + sell)
  readonly isDevSold: boolean;
  readonly stagesCompleted: number;           // 0: none, 1: 33% taken, 2: 66% taken
  readonly holdingTimeSeconds: number;
}

export interface ExitEvaluationResult {
  readonly action: ExitActionType;
  readonly reduceFraction: number;            // 0.0, 0.33, 0.66, 1.0
  readonly triggerReason: string;
  readonly effectiveStopPriceUsd: number;
  readonly isUrgent: boolean;
  readonly notes: string;
}

export class DynamicExitEngine {
  private readonly initialStructuralStopPct = 0.12; // -12% hard structural stop
  private readonly trailingStopAtrMultiplier = 0.15; // 15% dynamic trail off peak
  private readonly liquidityShockThresholdPct = 0.15; // 15% single-block drop

  public evaluateExit(pos: PositionStateSnapshot): ExitEvaluationResult {
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
    } else if (pos.unrealizedPnlPct >= 0.35 && pos.stagesCompleted < 1) {
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

  /**
   * Evaluates Dynamic Staged Trailing Stops for Multi-Baggers (AGENTS.md):
   * Gain < 100%: 20% trail
   * Gain > 100%: 30% structural trail (prevents choking multi-baggers during 25-30% pullbacks)
   * Gain > 500%: 40% structural trail
   * Enforces 50/50 Rule: 50% scale-out at +20% gain to secure risk-free execution for remainder.
   */
  public evaluateGodTierExits(position: PositionStateSnapshot): {
    action: ExitActionType;
    reason: string;
    protectiveStopUsd: number;
    fractionPct: number;
  } {
    const { entryPriceUsd, currentPriceUsd, highestPriceUsd, unrealizedPnlPct } = position;
    const peakRatio = highestPriceUsd / entryPriceUsd;

    // 1. Dynamic 50/50 Rule: Scale out 50% at >= +20% gain to de-risk
    if (unrealizedPnlPct >= 0.20 && unrealizedPnlPct < 0.35 && position.realSolReserve > 0) {
      return {
        action: 'REDUCE_50',
        reason: '50/50 RULE: Secure 50% profit at +20% gain milestone to make runner risk-free',
        protectiveStopUsd: entryPriceUsd * 1.05, // Lock in breakeven + 5%
        fractionPct: 0.50,
      };
    }

    // 2. Dynamic Staged Trailing Stops
    let trailPct = 0.15;
    let floorMultiplier = 1.01;

    if (peakRatio >= 6.0) {
      // 500%+ Moonshot: 40% structural trail
      trailPct = 0.40;
      floorMultiplier = 4.0;
    } else if (peakRatio >= 2.0) {
      // 100%+ Double: 30% trail
      trailPct = 0.30;
      floorMultiplier = 1.50;
    } else if (peakRatio >= 1.25) {
      // 25%+ Gain: 20% trail
      trailPct = 0.20;
      floorMultiplier = 1.10;
    }

    const stagedFloorUsd = entryPriceUsd * floorMultiplier;
    const trailingStopUsd = highestPriceUsd * (1 - trailPct);
    const effectiveStopUsd = Math.max(stagedFloorUsd, trailingStopUsd);

    if (currentPriceUsd <= effectiveStopUsd && peakRatio >= 1.04) {
      return {
        action: 'EXIT_100_PROFIT',
        reason: `DYNAMIC_STAGED_TRAIL: Price breached staged trailing stop ($${effectiveStopUsd.toFixed(6)}) from peak $${highestPriceUsd.toFixed(6)}`,
        protectiveStopUsd: effectiveStopUsd,
        fractionPct: 1.0,
      };
    }

    return {
      action: 'HOLD',
      reason: `Holding: trailing floor at $${effectiveStopUsd.toFixed(6)} (${(trailPct * 100).toFixed(0)}% trail)`,
      protectiveStopUsd: effectiveStopUsd,
      fractionPct: 0.0,
    };
  }

}
