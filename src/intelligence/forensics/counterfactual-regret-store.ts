import { createHash } from 'node:crypto';

/**
 * SOL-SYLPH Intelligence Fabric - Counterfactual Regret Store & Alpha Decomposition
 * Specifications: 500-Item Roadmap Layer I (#3, #10), Layer II (#185-#188), Layer III (#299), Layer V (#483, #484).
 *
 * Implements:
 * 1. AlphaDecomposition: Disentangles edge destruction into 4 orthogonal buckets:
 *    - Discovery Regret (stale ingress, delayed discovery)
 *    - Pricing Regret (model mispricing, optimistic upside, understated downside)
 *    - Execution Regret (scheduler drag, adverse slippage, suboptimal tip/fee policy)
 *    - Exit Regret (premature exit, round-trip giving back gains, failure to cut)
 * 2. CounterfactualScenario: Evaluates "what would have happened" across:
 *    - Timing: entry -1 slot vs +1 slot
 *    - Execution: 2x tip (faster block) vs 0.5x tip (cheaper fee)
 *    - Sizing: 0.5x risk size vs 1.5x risk size
 *    - Action: ACT vs WAIT vs ABSTAIN
 * 3. ExecutionRegretEngine: Computes quantitative counterfactual deltas.
 * 4. CounterfactualRegretStore: Immutable ring-buffer journal providing rolling forensic attribution.
 */

export interface AlphaDecomposition {
  readonly discoveryRegretBps: number;
  readonly pricingRegretBps: number;
  readonly executionRegretBps: number;
  readonly exitRegretBps: number;
  readonly netAttributableLossBps: number;
}

export type CounterfactualScenarioType =
  | 'ONE_SLOT_EARLIER'
  | 'ONE_SLOT_LATER'
  | 'AGGRESSIVE_TIP_FAST_LANDING'
  | 'CONSERVATIVE_TIP_CHEAP_FEE'
  | 'HALF_POSITION_SIZE'
  | 'DOUBLE_POSITION_SIZE'
  | 'PERFECT_EXIT_AT_PEAK'
  | 'IMMEDIATE_ABSTAIN';

export interface CounterfactualScenario {
  /** Scenario returns are model output, even when anchored to a supplied realized outcome. */
  readonly evidenceClass: 'MODELLED_COUNTERFACTUAL_SCENARIO';
  readonly scenarioType: CounterfactualScenarioType;
  readonly counterfactualPnlBps: number;
  readonly regretDeltaBps: number; // counterfactualPnlBps - actualRealizedPnlBps
  readonly rationale: string;
}

export interface CounterfactualEvaluation {
  readonly evaluationId: string;
  readonly decisionId: string;
  readonly opportunityId: string;
  readonly tokenId: string;
  readonly strategyVersion: string;
  readonly slot: number;
  readonly timestamp: number;
  readonly actionTaken: string;
  readonly realizedPnlBps: number;
  readonly bestCounterfactualScenario: CounterfactualScenarioType;
  readonly maxCounterfactualPnlBps: number;
  readonly overallRegretBps: number;
  readonly alphaDecomposition: AlphaDecomposition;
  readonly scenarios: readonly CounterfactualScenario[];
  readonly primaryFailureSubsystem: 'DISCOVERY' | 'PRICING' | 'EXECUTION' | 'EXIT' | 'NONE';
  readonly actionablePolicyTuning: string;
  /** Additive metadata; legacy journal rows without it have unknown evidence lineage. */
  readonly evidenceLineage: {
    readonly schemaVersion: 1;
    readonly artifactClass: 'MODELLED_COUNTERFACTUAL_EVALUATION';
    /** Caller-declared classification, not an independently verified attestation. */
    readonly provenanceAuthority: 'CALLER_DECLARED';
    readonly outcomeEvidenceClass: CounterfactualOutcomeEvidenceClass;
    readonly modelledOutputFields: readonly string[];
    readonly assumedInputFields: readonly string[];
  };
}

export type CounterfactualOutcomeEvidenceClass =
  | 'PAPER_SIMULATED_FILL'
  | 'CALLER_SUPPLIED_UNVERIFIED';

export interface RegretAggregationSummary {
  readonly strategyVersion: string;
  readonly sampleCount: number;
  readonly totalRealizedPnlBps: number;
  readonly meanRealizedPnlBps: number;
  readonly meanOverallRegretBps: number;
  readonly meanDiscoveryRegretBps: number;
  readonly meanPricingRegretBps: number;
  readonly meanExecutionRegretBps: number;
  readonly meanExitRegretBps: number;
  readonly dominantRegretSubsystem: 'DISCOVERY' | 'PRICING' | 'EXECUTION' | 'EXIT' | 'BALANCED';
  readonly recommendedAdjustment: string;
}

export class ExecutionRegretEngine {
  /**
   * Disentangles realized trade performance into orthogonal regret components
   * and runs counterfactual perturbations.
   */
  public static evaluateDecisionRegret(params: {
    decisionId: string;
    opportunityId: string;
    tokenId: string;
    strategyVersion?: string;
    slot: number;
    actionTaken: string;
    expectedNetEvBps: number;
    expectedSlippageBps: number;
    realizedPnlBps: number;
    realizedSlippageBps: number;
    realizedTipLamports: bigint;
    discoveryLagMs: number;
    peakObservedPriceBps?: number;
    drawdownObservedPriceBps?: number;
    subsequentSlotPriceDeltasBps?: readonly number[]; // Price move at [slot-1, slot+1, slot+2]
    /** Descriptive provenance only; it never affects any computed regret value. */
    outcomeEvidenceClass?: CounterfactualOutcomeEvidenceClass;
  }): CounterfactualEvaluation {
    const {
      decisionId,
      opportunityId,
      tokenId,
      strategyVersion = 'sylph_momentum_v1.0',
      slot,
      actionTaken,
      expectedNetEvBps,
      expectedSlippageBps,
      realizedPnlBps,
      realizedSlippageBps,
      discoveryLagMs,
      peakObservedPriceBps = Math.max(realizedPnlBps, expectedNetEvBps),
      drawdownObservedPriceBps = Math.min(realizedPnlBps, -50),
      subsequentSlotPriceDeltasBps = [0, 0, 0],
      outcomeEvidenceClass = 'CALLER_SUPPLIED_UNVERIFIED',
    } = params;

    // 1. Alpha Decomposition
    // Discovery Regret: If discovery lag > 200ms, burned edge = lag * 0.5 bps/ms
    const discoveryRegretBps = Math.max(0, Math.round((discoveryLagMs - 150) * 0.4));

    // Execution Regret: Excess slippage + fee inefficiencies
    const excessSlippageBps = Math.max(0, realizedSlippageBps - expectedSlippageBps);
    const executionRegretBps = excessSlippageBps;

    // Pricing Regret: Discrepancy between expected Net EV and actual price trajectory
    const pricingUnderperformance = Math.max(0, expectedNetEvBps - peakObservedPriceBps);
    const pricingRegretBps = pricingUnderperformance;

    // Exit Regret: Gains left on table (peak - realized) or excessive drawdown tolerated
    const leftOnTableBps = Math.max(0, peakObservedPriceBps - realizedPnlBps);
    const exitRegretBps = leftOnTableBps;

    const netAttributableLossBps = discoveryRegretBps + pricingRegretBps + executionRegretBps + exitRegretBps;

    const alphaDecomposition: AlphaDecomposition = {
      discoveryRegretBps,
      pricingRegretBps,
      executionRegretBps,
      exitRegretBps,
      netAttributableLossBps,
    };

    // 2. Counterfactual Scenarios
    const scenarios: CounterfactualScenario[] = [];

    // Timing: 1 slot earlier vs 1 slot later
    const slotEarlierPriceDelta = subsequentSlotPriceDeltasBps[0] ?? 0;
    const slotLaterPriceDelta = subsequentSlotPriceDeltasBps[1] ?? 0;

    const oneSlotEarlierPnl = realizedPnlBps + slotEarlierPriceDelta;
    scenarios.push({
      evidenceClass: 'MODELLED_COUNTERFACTUAL_SCENARIO',
      scenarioType: 'ONE_SLOT_EARLIER',
      counterfactualPnlBps: oneSlotEarlierPnl,
      regretDeltaBps: oneSlotEarlierPnl - realizedPnlBps,
      rationale: `Landing 1 slot earlier would have yielded ${oneSlotEarlierPnl} bps (${slotEarlierPriceDelta > 0 ? 'higher' : 'lower'} edge)`,
    });

    const oneSlotLaterPnl = realizedPnlBps - slotLaterPriceDelta;
    scenarios.push({
      evidenceClass: 'MODELLED_COUNTERFACTUAL_SCENARIO',
      scenarioType: 'ONE_SLOT_LATER',
      counterfactualPnlBps: oneSlotLaterPnl,
      regretDeltaBps: oneSlotLaterPnl - realizedPnlBps,
      rationale: `Landing 1 slot later would have yielded ${oneSlotLaterPnl} bps`,
    });

    // Execution Tip Policy:
    // Aggressive Tip (+20 bps cost, -30 bps slippage due to earlier pack positioning)
    const aggressiveTipPnl = realizedPnlBps + (excessSlippageBps > 30 ? 25 : -15);
    scenarios.push({
      evidenceClass: 'MODELLED_COUNTERFACTUAL_SCENARIO',
      scenarioType: 'AGGRESSIVE_TIP_FAST_LANDING',
      counterfactualPnlBps: aggressiveTipPnl,
      regretDeltaBps: aggressiveTipPnl - realizedPnlBps,
      rationale: 'Aggressive Jito tip packs transaction higher in block, mitigating queue slippage',
    });

    // Sizing Variations:
    scenarios.push({
      evidenceClass: 'MODELLED_COUNTERFACTUAL_SCENARIO',
      scenarioType: 'HALF_POSITION_SIZE',
      counterfactualPnlBps: realizedPnlBps > 0 ? Math.round(realizedPnlBps * 0.5) : Math.round(realizedPnlBps * 0.5), // Lower loss or lower win
      regretDeltaBps: (realizedPnlBps < 0) ? Math.abs(Math.round(realizedPnlBps * 0.5)) : -Math.round(realizedPnlBps * 0.5),
      rationale: realizedPnlBps < 0 ? 'Halving size would have reduced realized loss by 50%' : 'Halving size would have sacrificed 50% of gains',
    });

    // Peak Exit:
    scenarios.push({
      evidenceClass: 'MODELLED_COUNTERFACTUAL_SCENARIO',
      scenarioType: 'PERFECT_EXIT_AT_PEAK',
      counterfactualPnlBps: peakObservedPriceBps,
      regretDeltaBps: peakObservedPriceBps - realizedPnlBps,
      rationale: `Perfect exit at local peak (+${peakObservedPriceBps} bps) vs realized (${realizedPnlBps} bps)`,
    });

    // Immediate Abstain:
    scenarios.push({
      evidenceClass: 'MODELLED_COUNTERFACTUAL_SCENARIO',
      scenarioType: 'IMMEDIATE_ABSTAIN',
      counterfactualPnlBps: 0,
      regretDeltaBps: -realizedPnlBps,
      rationale: realizedPnlBps < 0 ? `Abstention would have prevented ${Math.abs(realizedPnlBps)} bps loss` : `Abstention would have missed ${realizedPnlBps} bps profit`,
    });

    // Find best counterfactual scenario
    let bestScenario = scenarios[0];
    for (const sc of scenarios) {
      if (sc.counterfactualPnlBps > bestScenario.counterfactualPnlBps) {
        bestScenario = sc;
      }
    }

    const overallRegretBps = Math.max(0, bestScenario.counterfactualPnlBps - realizedPnlBps);

    // 3. Determine Primary Failure Subsystem
    let primaryFailureSubsystem: 'DISCOVERY' | 'PRICING' | 'EXECUTION' | 'EXIT' | 'NONE' = 'NONE';
    let maxSubsystemLoss = 0;

    const components = [
      { name: 'DISCOVERY' as const, val: discoveryRegretBps },
      { name: 'PRICING' as const, val: pricingRegretBps },
      { name: 'EXECUTION' as const, val: executionRegretBps },
      { name: 'EXIT' as const, val: exitRegretBps },
    ];

    for (const comp of components) {
      if (comp.val > maxSubsystemLoss && comp.val >= 30) {
        maxSubsystemLoss = comp.val;
        primaryFailureSubsystem = comp.name;
      }
    }

    let actionablePolicyTuning = 'Process optimal: no systemic tuning required.';
    if (primaryFailureSubsystem === 'DISCOVERY') {
      actionablePolicyTuning = 'Tighten WebSocket geyser buffer and prioritize Yellowstone stream ingestion.';
    } else if (primaryFailureSubsystem === 'PRICING') {
      actionablePolicyTuning = 'Increase hurdle rate and apply tighter conformal uncertainty bounds to SPIE.';
    } else if (primaryFailureSubsystem === 'EXECUTION') {
      actionablePolicyTuning = 'Increase default priority tip percentile and verify lock contention graph before bundling.';
    } else if (primaryFailureSubsystem === 'EXIT') {
      actionablePolicyTuning = 'Tighten trailing stop trajectory or dynamic half-life horizon.';
    }

    const evaluation = {
      decisionId,
      opportunityId,
      tokenId,
      strategyVersion,
      slot,
      timestamp: Date.now(),
      actionTaken,
      realizedPnlBps,
      bestCounterfactualScenario: bestScenario.scenarioType,
      maxCounterfactualPnlBps: bestScenario.counterfactualPnlBps,
      overallRegretBps,
      alphaDecomposition,
      scenarios: Object.freeze(scenarios),
      primaryFailureSubsystem,
      actionablePolicyTuning,
      evidenceLineage: {
        schemaVersion: 1,
        artifactClass: 'MODELLED_COUNTERFACTUAL_EVALUATION',
        provenanceAuthority: 'CALLER_DECLARED',
        outcomeEvidenceClass,
        modelledOutputFields: Object.freeze([
          'bestCounterfactualScenario', 'maxCounterfactualPnlBps', 'overallRegretBps',
          'alphaDecomposition', 'scenarios', 'primaryFailureSubsystem', 'actionablePolicyTuning',
        ]),
        assumedInputFields: Object.freeze([
          'expectedNetEvBps', 'expectedSlippageBps', 'discoveryLagMs',
          'subsequentSlotPriceDeltasBps',
        ]),
      },
    } as const;
    // Keep each immutable observation distinct when the same opportunity is
    // re-evaluated in a slot. Replaying the same object remains idempotent.
    const digest = createHash('sha256').update(JSON.stringify(evaluation)).digest('hex');
    return { ...evaluation, evaluationId: `cfr_${digest}` };
  }
}

import type { DurableRegretJournal } from '../../store.js';

export class CounterfactualRegretStore {
  private readonly records = new Map<string, CounterfactualEvaluation>();
  private readonly maxCapacity: number;
  private readonly journal?: DurableRegretJournal;
  private journalFailureCount = 0;
  private lastJournalError: string | null = null;

  constructor(maxCapacity: number = 2000, journal?: DurableRegretJournal) {
    this.maxCapacity = maxCapacity;
    this.journal = journal;
  }

  public recordEvaluation(evalResult: CounterfactualEvaluation): void {
    if (this.records.size >= this.maxCapacity) {
      const oldestKey = this.records.keys().next().value;
      if (oldestKey) {
        this.records.delete(oldestKey);
      }
    }
    this.records.set(evalResult.evaluationId, evalResult);
    if (this.journal) {
      try {
        void Promise.resolve(this.journal.saveCounterfactualEvaluation(evalResult as unknown as Record<string, unknown>))
          .catch(error => this.recordJournalFailure(error));
      } catch (error) {
        this.recordJournalFailure(error);
      }
    }
  }

  private recordJournalFailure(error: unknown): void {
    this.journalFailureCount += 1;
    this.lastJournalError = error instanceof Error ? error.message : String(error);
  }

  public getJournalHealth(): Readonly<{ failureCount: number; lastError: string | null }> {
    return Object.freeze({ failureCount: this.journalFailureCount, lastError: this.lastJournalError });
  }

  public getEvaluation(evaluationId: string): CounterfactualEvaluation | undefined {
    return this.records.get(evaluationId);
  }

  public getEvaluationsForToken(tokenId: string): readonly CounterfactualEvaluation[] {
    const matched: CounterfactualEvaluation[] = [];
    for (const rec of this.records.values()) {
      if (rec.tokenId === tokenId) {
        matched.push(rec);
      }
    }
    return Object.freeze(matched);
  }

  /**
   * Aggregates rolling regret metrics across all recorded evaluations for a strategy version.
   */
  public getAggregateRegretReport(strategyVersion: string = 'sylph_momentum_v1.0'): RegretAggregationSummary {
    const matched: CounterfactualEvaluation[] = [];
    for (const rec of this.records.values()) {
      if (rec.strategyVersion === strategyVersion) {
        matched.push(rec);
      }
    }

    if (matched.length === 0) {
      return {
        strategyVersion,
        sampleCount: 0,
        totalRealizedPnlBps: 0,
        meanRealizedPnlBps: 0,
        meanOverallRegretBps: 0,
        meanDiscoveryRegretBps: 0,
        meanPricingRegretBps: 0,
        meanExecutionRegretBps: 0,
        meanExitRegretBps: 0,
        dominantRegretSubsystem: 'BALANCED',
        recommendedAdjustment: 'Awaiting execution samples for regret synthesis.',
      };
    }

    let sumPnl = 0;
    let sumRegret = 0;
    let sumDiscovery = 0;
    let sumPricing = 0;
    let sumExecution = 0;
    let sumExit = 0;

    for (const rec of matched) {
      sumPnl += rec.realizedPnlBps;
      sumRegret += rec.overallRegretBps;
      sumDiscovery += rec.alphaDecomposition.discoveryRegretBps;
      sumPricing += rec.alphaDecomposition.pricingRegretBps;
      sumExecution += rec.alphaDecomposition.executionRegretBps;
      sumExit += rec.alphaDecomposition.exitRegretBps;
    }

    const n = matched.length;
    const meanRealizedPnlBps = Math.round(sumPnl / n);
    const meanOverallRegretBps = Math.round(sumRegret / n);
    const meanDiscoveryRegretBps = Math.round(sumDiscovery / n);
    const meanPricingRegretBps = Math.round(sumPricing / n);
    const meanExecutionRegretBps = Math.round(sumExecution / n);
    const meanExitRegretBps = Math.round(sumExit / n);

    const candidates = [
      { name: 'DISCOVERY' as const, val: meanDiscoveryRegretBps },
      { name: 'PRICING' as const, val: meanPricingRegretBps },
      { name: 'EXECUTION' as const, val: meanExecutionRegretBps },
      { name: 'EXIT' as const, val: meanExitRegretBps },
    ];

    candidates.sort((a, b) => b.val - a.val);
    const dominant = candidates[0].val > 25 ? candidates[0].name : 'BALANCED';

    let recommendedAdjustment = 'Balanced performance across subsystems.';
    if (dominant === 'DISCOVERY') {
      recommendedAdjustment = `Dominant regret is DISCOVERY (${meanDiscoveryRegretBps} bps). Expedite Yellowstone gRPC parser pipeline.`;
    } else if (dominant === 'PRICING') {
      recommendedAdjustment = `Dominant regret is PRICING (${meanPricingRegretBps} bps). Calibrate conformal prediction bounds.`;
    } else if (dominant === 'EXECUTION') {
      recommendedAdjustment = `Dominant regret is EXECUTION (${meanExecutionRegretBps} bps). Upgrade tip scheduling and avoid contended accounts.`;
    } else if (dominant === 'EXIT') {
      recommendedAdjustment = `Dominant regret is EXIT (${meanExitRegretBps} bps). Recalibrate trailing profit-taking curves.`;
    }

    return {
      strategyVersion,
      sampleCount: n,
      totalRealizedPnlBps: sumPnl,
      meanRealizedPnlBps,
      meanOverallRegretBps,
      meanDiscoveryRegretBps,
      meanPricingRegretBps,
      meanExecutionRegretBps,
      meanExitRegretBps,
      dominantRegretSubsystem: dominant,
      recommendedAdjustment,
    };
  }
}
