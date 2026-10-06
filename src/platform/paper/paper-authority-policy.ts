/**
 * SYLPH FUSION — PAPER AUTHORITY POLICY & RISK SHADOW
 * Specifications: Master Blueprint Sections VIII, IX, X, CXXXVI
 *
 * Distinguishes between:
 * 1. PAPER_STANDARD (conservative production-like gates)
 * 2. PAPER_AGGRESSIVE (elevated exposure, risk controls active)
 * 3. PAPER_MAX_RISK / PAPER_CHAOS (risk gates become purely observational; simulated bankruptcy allowed)
 *
 * INVARIANTS:
 * - Risk may be bypassed in PAPER_MAX_RISK. Reality may not.
 * - Never silently bypass: every override emits a PAPER_RISK_BYPASS event.
 * - Never fake liquidity, fills, landings, or execution.
 * - Live signing and live capital authority remain structurally forbidden.
 */

import { createHash } from 'node:crypto';

export type PaperAuthorityMode =
  | 'PAPER_STANDARD'
  | 'PAPER_AGGRESSIVE'
  | 'PAPER_MAX_RISK'
  | 'PAPER_CHAOS';

export interface CounterfactualRiskEstimate {
  readonly expectedDrawdownBps: number | null;
  readonly ruinProbability: number | null;
  readonly tailLossBps: number | null;
}

export interface PaperRiskDecision {
  readonly mode: PaperAuthorityMode;
  readonly normalDecision: 'ALLOW' | 'DENY';
  readonly paperDecision: 'ALLOW' | 'ATTEMPT' | 'DENY';
  readonly bypassedRules: readonly string[];
  readonly counterfactualRisk: CounterfactualRiskEstimate;
  readonly ruleEvaluations: Readonly<Record<string, {
    readonly normalResult: 'ALLOW' | 'DENY';
    readonly bypassed: boolean;
    readonly reason?: string;
  }>>;
}

export interface PaperRiskBypassEvent {
  readonly eventId: string;
  readonly timestamp: number;
  readonly mode: PaperAuthorityMode;
  readonly rule: string;
  readonly normalResult: 'DENY';
  readonly paperMaxRiskResult: 'ATTEMPT';
  readonly reason: string;
  readonly mint?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RuleCounterfactualStat {
  readonly rule: string;
  timesEvaluated: number;
  timesBypassed: number;
  lossesAvoidedLamports: bigint;
  profitsBlockedLamports: bigint;
  moonshotsBlockedCount: number; // >= 10x
  extremeWinnersBlockedCount: number; // >= 50x
  rugLossesAvoidedLamports: bigint;
  feesAvoidedLamports: bigint;
  drawdownAvoidedBps: number;
  capitalTimeSavedMs: number;
}

export interface PaperBankruptcyRecord {
  readonly outcome: 'BANKRUPT';
  readonly bankrollId: string;
  readonly mode: PaperAuthorityMode;
  readonly timeToBankruptcyMs: number;
  readonly startingBankrollLamports: bigint;
  readonly terminalEquityLamports: bigint;
  readonly maximumEquityLamports: bigint;
  readonly maximumDrawdownBps: number;
  readonly totalTradesExecuted: number;
  readonly largestLossLamports: bigint;
  readonly largestPositionLamports: bigint;
  readonly cause: string;
  readonly strategy: string;
  readonly regime: string;
  readonly riskRulesBypassed: readonly string[];
  readonly bankruptAt: number;
}

/**
 * Tracks what normal SYLPH would have done vs what PAPER_MAX_RISK did,
 * establishing the net economic value and Moonshot Tax of each safety rule.
 */
export class RiskGateCounterfactualLedger {
  private readonly rules = new Map<string, RuleCounterfactualStat>();
  private readonly bypassEvents: PaperRiskBypassEvent[] = [];

  public recordBypass(event: PaperRiskBypassEvent): void {
    this.bypassEvents.push(Object.freeze({ ...event }));
    if (this.bypassEvents.length > 5000) this.bypassEvents.shift();

    let stat = this.rules.get(event.rule);
    if (!stat) {
      stat = {
        rule: event.rule,
        timesEvaluated: 0,
        timesBypassed: 0,
        lossesAvoidedLamports: 0n,
        profitsBlockedLamports: 0n,
        moonshotsBlockedCount: 0,
        extremeWinnersBlockedCount: 0,
        rugLossesAvoidedLamports: 0n,
        feesAvoidedLamports: 0n,
        drawdownAvoidedBps: 0,
        capitalTimeSavedMs: 0,
      };
      this.rules.set(event.rule, stat);
    }
    stat.timesBypassed++;
  }

  public recordEvaluation(rule: string, normalResult: 'ALLOW' | 'DENY'): void {
    let stat = this.rules.get(rule);
    if (!stat) {
      stat = {
        rule,
        timesEvaluated: 0,
        timesBypassed: 0,
        lossesAvoidedLamports: 0n,
        profitsBlockedLamports: 0n,
        moonshotsBlockedCount: 0,
        extremeWinnersBlockedCount: 0,
        rugLossesAvoidedLamports: 0n,
        feesAvoidedLamports: 0n,
        drawdownAvoidedBps: 0,
        capitalTimeSavedMs: 0,
      };
      this.rules.set(rule, stat);
    }
    stat.timesEvaluated++;
  }

  public recordOutcome(params: {
    rule: string;
    actualPnLLamports: bigint;
    multiple: number;
    isRug: boolean;
    feesPaidLamports: bigint;
    holdingTimeMs: number;
  }): void {
    const stat = this.rules.get(params.rule);
    if (!stat) return;

    if (params.actualPnLLamports < 0n) {
      // Normal rule would have avoided this loss
      stat.lossesAvoidedLamports += -params.actualPnLLamports;
      if (params.isRug) {
        stat.rugLossesAvoidedLamports += -params.actualPnLLamports;
      }
      stat.feesAvoidedLamports += params.feesPaidLamports;
      stat.capitalTimeSavedMs += params.holdingTimeMs;
    } else {
      // Normal rule would have blocked this profit!
      stat.profitsBlockedLamports += params.actualPnLLamports;
      if (params.multiple >= 50) {
        stat.extremeWinnersBlockedCount++;
      }
      if (params.multiple >= 10) {
        stat.moonshotsBlockedCount++;
      }
    }
  }

  /**
   * FilterNetValue = AvoidedLoss - MissedExecutableEV
   */
  public getFilterNetValue(rule: string): bigint {
    const stat = this.rules.get(rule);
    if (!stat) return 0n;
    return stat.lossesAvoidedLamports - stat.profitsBlockedLamports;
  }

  /**
   * MoonshotTax(F) = ExtremeWinnerEVRejected / BadEVPrevented
   */
  public getMoonshotTax(rule: string): number {
    const stat = this.rules.get(rule);
    if (!stat || stat.lossesAvoidedLamports <= 0n) return 0;
    const extremeEv = Number(stat.profitsBlockedLamports);
    const badEv = Number(stat.lossesAvoidedLamports);
    return extremeEv / badEv;
  }

  public getStats(): ReadonlyMap<string, Readonly<RuleCounterfactualStat>> {
    return this.rules;
  }

  public getRecentBypasses(limit = 100): readonly PaperRiskBypassEvent[] {
    return this.bypassEvents.slice(-limit);
  }
}

export class PaperAuthorityPolicy {
  public readonly mode: PaperAuthorityMode;
  public readonly counterfactualLedger: RiskGateCounterfactualLedger;
  private isBankrupt = false;
  private bankruptcyRecord: PaperBankruptcyRecord | null = null;

  constructor(
    mode: PaperAuthorityMode = 'PAPER_STANDARD',
    counterfactualLedger = new RiskGateCounterfactualLedger()
  ) {
    this.mode = mode === 'PAPER_CHAOS' ? 'PAPER_MAX_RISK' : mode;
    this.counterfactualLedger = counterfactualLedger;
  }

  public isMaxRisk(): boolean {
    return this.mode === 'PAPER_MAX_RISK' || this.mode === 'PAPER_CHAOS';
  }

  public isAggressive(): boolean {
    return this.mode === 'PAPER_AGGRESSIVE' || this.isMaxRisk();
  }

  /**
   * Evaluates a risk rule. In PAPER_MAX_RISK, if the rule returns DENY,
   * the policy transforms the paper outcome to ATTEMPT and logs a PAPER_RISK_BYPASS event.
   */
  public evaluateRule(params: {
    rule: string;
    check: () => { allowed: boolean; reason?: string };
    counterfactualRisk?: Partial<CounterfactualRiskEstimate>;
    mint?: string;
    context?: Record<string, unknown>;
  }): {
    normalAllowed: boolean;
    paperAllowed: boolean;
    bypassed: boolean;
    reason?: string;
  } {
    const result = params.check();
    this.counterfactualLedger.recordEvaluation(params.rule, result.allowed ? 'ALLOW' : 'DENY');

    if (result.allowed) {
      return {
        normalAllowed: true,
        paperAllowed: true,
        bypassed: false,
      };
    }

    // Normal check DENIED this action
    if (this.isMaxRisk()) {
      // Risk is bypassed for counterfactual research
      const event: PaperRiskBypassEvent = {
        eventId: `bypass_${createHash('sha256').update(`${params.rule}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16)}`,
        timestamp: Date.now(),
        mode: this.mode,
        rule: params.rule,
        normalResult: 'DENY',
        paperMaxRiskResult: 'ATTEMPT',
        reason: params.check().reason ?? 'COUNTERFACTUAL_RESEARCH',
        mint: params.mint,
        details: params.context,
      };

      this.counterfactualLedger.recordBypass(event);

      return {
        normalAllowed: false,
        paperAllowed: true,
        bypassed: true,
        reason: result.reason,
      };
    }

    // Standard mode respects the gate strictly
    return {
      normalAllowed: false,
      paperAllowed: false,
      bypassed: false,
      reason: result.reason,
    };
  }

  /**
   * Handle simulated bankruptcy.
   * Master Blueprint Section X: "Do NOT reset the paper bankroll when it reaches zero. Bankruptcy is an outcome."
   */
  public handleBankruptcy(params: {
    bankrollId: string;
    currentEquityLamports: bigint;
    startingBankrollLamports: bigint;
    maximumEquityLamports: bigint;
    maximumDrawdownBps: number;
    totalTradesExecuted: number;
    largestLossLamports: bigint;
    largestPositionLamports: bigint;
    cause: string;
    strategy: string;
    regime: string;
    riskRulesBypassed: readonly string[];
    startedAtMs: number;
  }): PaperBankruptcyRecord {
    this.isBankrupt = true;
    const now = Date.now();
    const record: PaperBankruptcyRecord = {
      outcome: 'BANKRUPT',
      bankrollId: params.bankrollId,
      mode: this.mode,
      timeToBankruptcyMs: Math.max(0, now - params.startedAtMs),
      startingBankrollLamports: params.startingBankrollLamports,
      terminalEquityLamports: params.currentEquityLamports,
      maximumEquityLamports: params.maximumEquityLamports,
      maximumDrawdownBps: params.maximumDrawdownBps,
      totalTradesExecuted: params.totalTradesExecuted,
      largestLossLamports: params.largestLossLamports,
      largestPositionLamports: params.largestPositionLamports,
      cause: params.cause,
      strategy: params.strategy,
      regime: params.regime,
      riskRulesBypassed: [...params.riskRulesBypassed],
      bankruptAt: now,
    };

    this.bankruptcyRecord = Object.freeze(record);
    return this.bankruptcyRecord;
  }

  public getBankruptcyRecord(): PaperBankruptcyRecord | null {
    return this.bankruptcyRecord;
  }

  public hasBankrupted(): boolean {
    return this.isBankrupt;
  }
}
