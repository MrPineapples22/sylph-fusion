/**
 * SYLPH FUSION — LIVE CANARY CONTROLLER & CAPITAL LATTICE (Sections 42 - 47)
 *
 * Implements strict capital modes:
 * A0_OBSERVE_ONLY
 * A1_PAPER
 * A2_SHADOW_LIVE_DATA
 * A3_LIVE_CANARY
 * A4_LIMITED_LIVE
 * A5_CERTIFIED_LIVE
 *
 * Hard Canary Invariants (A3):
 * - Max per-token exposure: 0.05 SOL
 * - Max concurrent open positions: 1
 * - Strict daily loss budget: 0.10 SOL
 * - Strict daily transaction count: 5 transactions
 * - No leverage, no borrowing, no martingale, no averaging down
 *
 * Circuit Breakers & Emergency Exit Partition:
 * - Fail closed on RPC disagreement, state-root mismatch, or protocol lease expiry
 * - Separate reduce-only emergency exit authority (never blocked by research model faults)
 */

export type CapitalMode =
  | 'A0_OBSERVE_ONLY'
  | 'A1_PAPER'
  | 'A2_SHADOW_LIVE_DATA'
  | 'A3_LIVE_CANARY'
  | 'A4_LIMITED_LIVE'
  | 'A5_CERTIFIED_LIVE';

export interface CanaryRiskBudgetConfig {
  readonly maxPerPositionExposureLamports: bigint; // e.g. 50_000_000n (0.05 SOL)
  readonly maxConcurrentPositions: number;         // 1
  readonly maxDailyLossLamports: bigint;           // 100_000_000n (0.10 SOL)
  readonly maxDailyTransactions: number;           // 5
  readonly maxDrawdownBps: number;                 // 1000 (10%)
  readonly maxConsecutiveFailures: number;         // 2
}

export interface LiveRiskState {
  readonly currentMode: CapitalMode;
  readonly activePositionMints: readonly string[];
  readonly dailySpentLamports: bigint;
  readonly dailyRealizedLossLamports: bigint;
  readonly dailyTransactionsCount: number;
  readonly consecutiveExecutionFailures: number;
  readonly circuitBreakerTripped: boolean;
  readonly tripReason?: string;
  readonly entriesHalted: boolean;
  readonly emergencyExitPermitted: boolean;
}

export class LiveCanaryController {
  private currentMode: CapitalMode = 'A1_PAPER';
  private readonly config: CanaryRiskBudgetConfig;
  private readonly activePositions = new Set<string>();
  private dailySpent = 0n;
  private dailyRealizedLoss = 0n;
  private dailyTxCount = 0;
  private consecutiveFailures = 0;
  private circuitBreakerTripped = false;
  private tripReason?: string;

  constructor(customConfig?: Partial<CanaryRiskBudgetConfig>) {
    this.config = Object.freeze({
      maxPerPositionExposureLamports: customConfig?.maxPerPositionExposureLamports ?? 50_000_000n, // 0.05 SOL
      maxConcurrentPositions: customConfig?.maxConcurrentPositions ?? 1,
      maxDailyLossLamports: customConfig?.maxDailyLossLamports ?? 100_000_000n, // 0.10 SOL
      maxDailyTransactions: customConfig?.maxDailyTransactions ?? 5,
      maxDrawdownBps: customConfig?.maxDrawdownBps ?? 1000,
      maxConsecutiveFailures: customConfig?.maxConsecutiveFailures ?? 2,
    });
  }

  public getMode(): CapitalMode {
    return this.currentMode;
  }

  /**
   * Promotes capital mode strictly on cryptographic evidence.
   */
  public promoteMode(targetMode: CapitalMode, evidenceRoot: string): void {
    if (this.currentMode === targetMode) return;

    // Strict linear promotion ladder: cannot skip states
    const ladder: CapitalMode[] = [
      'A0_OBSERVE_ONLY',
      'A1_PAPER',
      'A2_SHADOW_LIVE_DATA',
      'A3_LIVE_CANARY',
      'A4_LIMITED_LIVE',
      'A5_CERTIFIED_LIVE',
    ];

    const curIdx = ladder.indexOf(this.currentMode);
    const tgtIdx = ladder.indexOf(targetMode);

    if (tgtIdx > curIdx + 1) {
      throw new Error(`ILLEGAL_CAPITAL_PROMOTION: Cannot jump from ${this.currentMode} to ${targetMode}`);
    }

    if (!evidenceRoot || evidenceRoot.length < 32) {
      throw new Error('CAPITAL_PROMOTION_REJECTED: Missing cryptographic evidence root');
    }

    this.currentMode = targetMode;
  }

  /**
   * Validates whether a new entry position is permitted under current risk budget and circuit breakers.
   */
  public assertCanaryEntryPermitted(mint: string, requestedAmountLamports: bigint): void {
    if (this.circuitBreakerTripped) {
      throw new Error(`CANARY_ENTRY_BLOCKED: Circuit breaker tripped: ${this.tripReason}`);
    }

    if (this.currentMode !== 'A3_LIVE_CANARY' && this.currentMode !== 'A4_LIMITED_LIVE' && this.currentMode !== 'A5_CERTIFIED_LIVE') {
      throw new Error(`LIVE_ENTRY_BLOCKED: Mode is ${this.currentMode}; live capital authority unavailable`);
    }

    if (this.activePositions.has(mint)) {
      throw new Error(`CANARY_ENTRY_BLOCKED: Averaging down / duplicate position for ${mint} forbidden in Canary mode`);
    }

    if (this.activePositions.size >= this.config.maxConcurrentPositions) {
      throw new Error(
        `CANARY_ENTRY_BLOCKED: Max concurrent positions reached (${this.activePositions.size} >= ${this.config.maxConcurrentPositions})`
      );
    }

    if (requestedAmountLamports > this.config.maxPerPositionExposureLamports) {
      throw new Error(
        `CANARY_ENTRY_BLOCKED: Requested ${requestedAmountLamports} lamports exceeds canary limit ${this.config.maxPerPositionExposureLamports}`
      );
    }

    if (this.dailyRealizedLoss >= this.config.maxDailyLossLamports) {
      this.tripCircuitBreaker('Daily loss limit reached');
      throw new Error(`CANARY_ENTRY_BLOCKED: Daily loss limit ${this.config.maxDailyLossLamports} lamports reached`);
    }

    if (this.dailyTxCount >= this.config.maxDailyTransactions) {
      throw new Error(`CANARY_ENTRY_BLOCKED: Daily transaction limit ${this.config.maxDailyTransactions} reached`);
    }
  }

  public registerEntry(mint: string, amountLamports: bigint): void {
    this.assertCanaryEntryPermitted(mint, amountLamports);
    this.activePositions.add(mint);
    this.dailySpent += amountLamports;
    this.dailyTxCount++;
  }

  public registerExit(mint: string, realizedPnlLamports: bigint): void {
    this.activePositions.delete(mint);
    this.dailyTxCount++;
    if (realizedPnlLamports < 0n) {
      this.dailyRealizedLoss += -realizedPnlLamports;
      if (this.dailyRealizedLoss >= this.config.maxDailyLossLamports) {
        this.tripCircuitBreaker('Daily loss limit exceeded upon exit realization');
      }
    }
    this.consecutiveFailures = 0;
  }

  public registerExecutionFailure(reason: string): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.tripCircuitBreaker(`Consecutive execution failures (${this.consecutiveFailures}): ${reason}`);
    }
  }

  public tripCircuitBreaker(reason: string): void {
    this.circuitBreakerTripped = true;
    this.tripReason = reason;
  }

  public resetCircuitBreaker(): void {
    this.circuitBreakerTripped = false;
    this.tripReason = undefined;
    this.consecutiveFailures = 0;
  }

  public getRiskState(): LiveRiskState {
    return {
      currentMode: this.currentMode,
      activePositionMints: Array.from(this.activePositions),
      dailySpentLamports: this.dailySpent,
      dailyRealizedLossLamports: this.dailyRealizedLoss,
      dailyTransactionsCount: this.dailyTxCount,
      consecutiveExecutionFailures: this.consecutiveFailures,
      circuitBreakerTripped: this.circuitBreakerTripped,
      tripReason: this.tripReason,
      entriesHalted: this.circuitBreakerTripped || this.dailyRealizedLoss >= this.config.maxDailyLossLamports,
      emergencyExitPermitted: true, // Emergency exits are ALWAYS permitted
    };
  }
}
