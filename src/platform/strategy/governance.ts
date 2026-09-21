/**
 * SOL-SYLPH Multi-User Platform - Strategy Governance & Contracts
 * Specifications: Sections XXVIII (Multi-Strategy Allocator), XXIX (Strategy Contracts),
 * XXX (Champion/Challenger), XXXI (Automatic Quarantine).
 *
 * Rules:
 * 1. Every strategy version has a machine-enforced immutable contract.
 * 2. Stages: DEVELOPMENT, BACKTEST, SHADOW, CANARY, PRODUCTION, QUARANTINED, RETIRED.
 * 3. Strategy cannot modify its own risk budget or authorized size.
 * 4. Only PRODUCTION and CANARY strategies can deploy live capital (canary has 10% max allocation).
 * 5. Automatic quarantine triggered on severe drawdown, negative expectancy, or high failure rate.
 */

export type StrategyStage =
  | 'DEVELOPMENT'
  | 'BACKTEST'
  | 'SHADOW'
  | 'CANARY'
  | 'PRODUCTION'
  | 'QUARANTINED'
  | 'RETIRED';

export interface StrategyContract {
  readonly strategyId: string;
  readonly version: string;
  readonly stage: StrategyStage;
  readonly maxPositionSizeLamports: bigint;
  readonly maxAggregateCapitalLamports: bigint;
  readonly minLiquidityLamports: bigint;
  readonly maxDrawdownBps: number; // e.g. 1500 (15%)
  readonly maxHoldingDurationSec: number;
  readonly isCapitalAuthorized: boolean;
}

export interface StrategyPerformanceMetrics {
  readonly strategyId: string;
  readonly totalTrades: number;
  readonly winningTrades: number;
  readonly grossPnlLamports: bigint;
  readonly netExpectancyLamports: bigint;
  readonly maxDrawdownBps: number;
  readonly consecutiveFailures: number;
}

export class StrategyGovernanceEngine {
  private readonly contracts: Map<string, StrategyContract> = new Map();
  private readonly performanceStore: Map<string, StrategyPerformanceMetrics> = new Map();

  /**
   * Register a machine-enforced strategy contract.
   */
  public registerContract(contract: StrategyContract): void {
    this.contracts.set(contract.strategyId, contract);
  }

  public getContract(strategyId: string): StrategyContract | undefined {
    return this.contracts.get(strategyId);
  }

  /**
   * Verify if a strategy is authorized to receive capital allocation.
   */
  public canAllocateCapital(strategyId: string): { authorized: boolean; maxAllowedLamports: bigint; reason?: string } {
    const contract = this.contracts.get(strategyId);
    if (!contract) {
      return { authorized: false, maxAllowedLamports: 0n, reason: 'Strategy contract not found' };
    }

    if (contract.stage === 'QUARANTINED' || contract.stage === 'RETIRED') {
      return { authorized: false, maxAllowedLamports: 0n, reason: `Strategy in ${contract.stage} state` };
    }

    if (contract.stage === 'SHADOW' || contract.stage === 'BACKTEST' || contract.stage === 'DEVELOPMENT') {
      return { authorized: false, maxAllowedLamports: 0n, reason: `Strategy in non-trading stage (${contract.stage})` };
    }

    if (!contract.isCapitalAuthorized) {
      return { authorized: false, maxAllowedLamports: 0n, reason: 'Capital not authorized in contract' };
    }

    // Canary stage receives max 10% of aggregate limit
    if (contract.stage === 'CANARY') {
      return {
        authorized: true,
        maxAllowedLamports: contract.maxAggregateCapitalLamports / 10n,
      };
    }

    // Production Champion
    return {
      authorized: true,
      maxAllowedLamports: contract.maxAggregateCapitalLamports,
    };
  }

  /**
   * Update performance and evaluate automatic quarantine triggers.
   */
  public updatePerformance(
    strategyId: string,
    metrics: StrategyPerformanceMetrics
  ): { quarantined: boolean; reason?: string } {
    this.performanceStore.set(strategyId, metrics);
    const contract = this.contracts.get(strategyId);
    if (!contract) return { quarantined: false };

    // 1. Drawdown breach
    if (metrics.maxDrawdownBps >= contract.maxDrawdownBps) {
      this.quarantine(strategyId, `Max drawdown breach: ${metrics.maxDrawdownBps} bps >= limit ${contract.maxDrawdownBps} bps`);
      return {
        quarantined: true,
        reason: `Drawdown breached (${metrics.maxDrawdownBps} bps >= ${contract.maxDrawdownBps} bps)`,
      };
    }

    // 2. Negative expectancy after significant sample size (>= 15 trades)
    if (metrics.totalTrades >= 15 && metrics.netExpectancyLamports < 0n) {
      this.quarantine(strategyId, `Negative net expectancy (${metrics.netExpectancyLamports} lamports) across ${metrics.totalTrades} trades`);
      return {
        quarantined: true,
        reason: 'Negative net expectancy across sample',
      };
    }

    // 3. Excessive consecutive failures
    if (metrics.consecutiveFailures >= 5) {
      this.quarantine(strategyId, `Consecutive execution failure streak (${metrics.consecutiveFailures})`);
      return {
        quarantined: true,
        reason: 'Consecutive execution failures exceeded limit',
      };
    }

    return { quarantined: false };
  }

  public quarantine(strategyId: string, reason: string): void {
    const contract = this.contracts.get(strategyId);
    if (contract) {
      this.contracts.set(strategyId, {
        ...contract,
        stage: 'QUARANTINED',
        isCapitalAuthorized: false,
      });
    }
  }

  public getPerformance(strategyId: string): StrategyPerformanceMetrics | undefined {
    return this.performanceStore.get(strategyId);
  }
}
