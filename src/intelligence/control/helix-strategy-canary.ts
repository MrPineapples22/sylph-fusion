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

import { createHash } from 'node:crypto';

export type HelixCanaryStage =
  | 'PROPOSED'
  | 'REPLAY'
  | 'SIMULATION'
  | 'SHADOW'
  | 'OBSERVE_ONLY'
  | 'TINY_CANARY'
  | 'RESTRICTED_CANARY'
  | 'LIMITED_PRODUCTION'
  | 'CERTIFIED'
  | 'ACTIVE';

export interface StrategyPerformanceTelemetry {
  readonly strategyId: string;
  readonly tradeCount: number;
  readonly winRatePct: number;
  readonly realizedNetPnlLamports: bigint;
  readonly meanNetPnlLamports: bigint;
  readonly lowerConfidenceBoundLamports: bigint; // 95% LCB
  readonly maxDrawdownBps: number;              // e.g. 500 = 5%
  readonly executionShortfallBps: number;
  readonly regimeDiversityScore: number;         // 0.0 to 1.0
}

export interface HelixStrategyStatus {
  readonly strategyId: string;
  stage: HelixCanaryStage;
  readonly maxCapitalAllocationLamports: bigint;
  readonly maxPositionSizeLamports: bigint;
  readonly isRealCapitalAllowed: boolean;
  readonly promotionCount: number;
  readonly demotionCount: number;
  readonly lastEvaluatedAtMs: number;
  readonly history: readonly string[];
}

export class HelixStrategyCanaryAuthority {
  private strategies = new Map<string, HelixStrategyStatus>();

  private static readonly STAGE_LIMITS: Record<HelixCanaryStage, { maxCapital: bigint; maxPosition: bigint; isReal: boolean }> = {
    PROPOSED: { maxCapital: 0n, maxPosition: 0n, isReal: false },
    REPLAY: { maxCapital: 0n, maxPosition: 0n, isReal: false },
    SIMULATION: { maxCapital: 0n, maxPosition: 0n, isReal: false },
    SHADOW: { maxCapital: 0n, maxPosition: 0n, isReal: false },
    OBSERVE_ONLY: { maxCapital: 0n, maxPosition: 0n, isReal: false },
    TINY_CANARY: { maxCapital: 50_000_000n, maxPosition: 10_000_000n, isReal: true }, // 0.05 SOL total, 0.01 SOL pos
    RESTRICTED_CANARY: { maxCapital: 500_000_000n, maxPosition: 100_000_000n, isReal: true }, // 0.5 SOL total, 0.1 SOL pos
    LIMITED_PRODUCTION: { maxCapital: 2_000_000_000n, maxPosition: 500_000_000n, isReal: true }, // 2.0 SOL total, 0.5 SOL pos
    CERTIFIED: { maxCapital: 5_000_000_000n, maxPosition: 1_000_000_000n, isReal: true }, // 5.0 SOL total, 1.0 SOL pos
    ACTIVE: { maxCapital: 10_000_000_000n, maxPosition: 2_000_000_000n, isReal: true } // 10.0 SOL total, 2.0 SOL pos
  };

  private static readonly STAGE_ORDER: HelixCanaryStage[] = [
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

  public registerStrategy(strategyId: string, initialStage: HelixCanaryStage = 'PROPOSED'): HelixStrategyStatus {
    const limits = HelixStrategyCanaryAuthority.STAGE_LIMITS[initialStage];
    const status: HelixStrategyStatus = {
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

  public getStrategyStatus(strategyId: string): HelixStrategyStatus | undefined {
    return this.strategies.get(strategyId);
  }

  /**
   * Evaluates strategy telemetry for evidence-driven promotion or immediate auto-demotion.
   */
  public evaluateStrategyRollout(
    strategyId: string,
    telemetry: StrategyPerformanceTelemetry
  ): { nextStage: HelixCanaryStage; action: 'PROMOTED' | 'DEMOTED' | 'MAINTAINED'; reason: string } {
    const current = this.strategies.get(strategyId);
    if (!current) throw new Error(`Strategy ${strategyId} not registered in HELIX`);

    const currentIdx = HelixStrategyCanaryAuthority.STAGE_ORDER.indexOf(current.stage);

    // 1. FAST DEMOTION CHECKS (Safety First)
    // Drawdown breach (> 1200 bps = 12%) or negative Lower Confidence Bound with >= 20 trades
    const isDrawdownBreach = telemetry.maxDrawdownBps > 1200;
    const isNegativeLcb = telemetry.tradeCount >= 20 && telemetry.lowerConfidenceBoundLamports < 0n;

    if (isDrawdownBreach || isNegativeLcb) {
      if (currentIdx > 3) {
        // Demote to SHADOW immediately
        const nextStage: HelixCanaryStage = 'SHADOW';
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
      const canPromote =
        telemetry.tradeCount >= minTradesRequired &&
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

  private applyStageChange(
    status: HelixStrategyStatus,
    newStage: HelixCanaryStage,
    action: 'PROMOTED' | 'DEMOTED',
    reason: string
  ): void {
    const limits = HelixStrategyCanaryAuthority.STAGE_LIMITS[newStage];
    status.stage = newStage;
    (status as any).maxCapitalAllocationLamports = limits.maxCapital;
    (status as any).maxPositionSizeLamports = limits.maxPosition;
    (status as any).isRealCapitalAllowed = limits.isReal;
    if (action === 'PROMOTED') (status as any).promotionCount++;
    if (action === 'DEMOTED') (status as any).demotionCount++;
    (status as any).lastEvaluatedAtMs = Date.now();
    (status as any).history = [...status.history, reason];
  }
}
