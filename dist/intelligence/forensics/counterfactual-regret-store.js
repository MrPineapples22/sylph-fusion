import { createHash } from 'node:crypto';
export class ExecutionRegretEngine {
    /**
     * Disentangles realized trade performance into orthogonal regret components
     * and runs counterfactual perturbations.
     */
    static evaluateDecisionRegret(params) {
        const { decisionId, opportunityId, tokenId, strategyVersion = 'sylph_momentum_v1.0', slot, actionTaken, expectedNetEvBps, expectedSlippageBps, realizedPnlBps, realizedSlippageBps, discoveryLagMs, peakObservedPriceBps = Math.max(realizedPnlBps, expectedNetEvBps), drawdownObservedPriceBps = Math.min(realizedPnlBps, -50), subsequentSlotPriceDeltasBps = [0, 0, 0], outcomeEvidenceClass = 'CALLER_SUPPLIED_UNVERIFIED', } = params;
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
        const alphaDecomposition = {
            discoveryRegretBps,
            pricingRegretBps,
            executionRegretBps,
            exitRegretBps,
            netAttributableLossBps,
        };
        // 2. Counterfactual Scenarios
        const scenarios = [];
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
        let primaryFailureSubsystem = 'NONE';
        let maxSubsystemLoss = 0;
        const components = [
            { name: 'DISCOVERY', val: discoveryRegretBps },
            { name: 'PRICING', val: pricingRegretBps },
            { name: 'EXECUTION', val: executionRegretBps },
            { name: 'EXIT', val: exitRegretBps },
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
        }
        else if (primaryFailureSubsystem === 'PRICING') {
            actionablePolicyTuning = 'Increase hurdle rate and apply tighter conformal uncertainty bounds to SPIE.';
        }
        else if (primaryFailureSubsystem === 'EXECUTION') {
            actionablePolicyTuning = 'Increase default priority tip percentile and verify lock contention graph before bundling.';
        }
        else if (primaryFailureSubsystem === 'EXIT') {
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
        };
        // Keep each immutable observation distinct when the same opportunity is
        // re-evaluated in a slot. Replaying the same object remains idempotent.
        const digest = createHash('sha256').update(JSON.stringify(evaluation)).digest('hex');
        return { ...evaluation, evaluationId: `cfr_${digest}` };
    }
}
export class CounterfactualRegretStore {
    records = new Map();
    maxCapacity;
    journal;
    journalFailureCount = 0;
    lastJournalError = null;
    constructor(maxCapacity = 2000, journal) {
        this.maxCapacity = maxCapacity;
        this.journal = journal;
    }
    recordEvaluation(evalResult) {
        if (this.records.size >= this.maxCapacity) {
            const oldestKey = this.records.keys().next().value;
            if (oldestKey) {
                this.records.delete(oldestKey);
            }
        }
        this.records.set(evalResult.evaluationId, evalResult);
        if (this.journal) {
            try {
                void Promise.resolve(this.journal.saveCounterfactualEvaluation(evalResult))
                    .catch(error => this.recordJournalFailure(error));
            }
            catch (error) {
                this.recordJournalFailure(error);
            }
        }
    }
    recordJournalFailure(error) {
        this.journalFailureCount += 1;
        this.lastJournalError = error instanceof Error ? error.message : String(error);
    }
    getJournalHealth() {
        return Object.freeze({ failureCount: this.journalFailureCount, lastError: this.lastJournalError });
    }
    getEvaluation(evaluationId) {
        return this.records.get(evaluationId);
    }
    getEvaluationsForToken(tokenId) {
        const matched = [];
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
    getAggregateRegretReport(strategyVersion = 'sylph_momentum_v1.0') {
        const matched = [];
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
            { name: 'DISCOVERY', val: meanDiscoveryRegretBps },
            { name: 'PRICING', val: meanPricingRegretBps },
            { name: 'EXECUTION', val: meanExecutionRegretBps },
            { name: 'EXIT', val: meanExitRegretBps },
        ];
        candidates.sort((a, b) => b.val - a.val);
        const dominant = candidates[0].val > 25 ? candidates[0].name : 'BALANCED';
        let recommendedAdjustment = 'Balanced performance across subsystems.';
        if (dominant === 'DISCOVERY') {
            recommendedAdjustment = `Dominant regret is DISCOVERY (${meanDiscoveryRegretBps} bps). Expedite Yellowstone gRPC parser pipeline.`;
        }
        else if (dominant === 'PRICING') {
            recommendedAdjustment = `Dominant regret is PRICING (${meanPricingRegretBps} bps). Calibrate conformal prediction bounds.`;
        }
        else if (dominant === 'EXECUTION') {
            recommendedAdjustment = `Dominant regret is EXECUTION (${meanExecutionRegretBps} bps). Upgrade tip scheduling and avoid contended accounts.`;
        }
        else if (dominant === 'EXIT') {
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
//# sourceMappingURL=counterfactual-regret-store.js.map