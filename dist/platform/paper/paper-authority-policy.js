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
/**
 * Tracks what normal SYLPH would have done vs what PAPER_MAX_RISK did,
 * establishing the net economic value and Moonshot Tax of each safety rule.
 */
export class RiskGateCounterfactualLedger {
    rules = new Map();
    bypassEvents = [];
    recordBypass(event) {
        this.bypassEvents.push(Object.freeze({ ...event }));
        if (this.bypassEvents.length > 5000)
            this.bypassEvents.shift();
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
    recordEvaluation(rule, normalResult) {
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
    recordOutcome(params) {
        const stat = this.rules.get(params.rule);
        if (!stat)
            return;
        if (params.actualPnLLamports < 0n) {
            // Normal rule would have avoided this loss
            stat.lossesAvoidedLamports += -params.actualPnLLamports;
            if (params.isRug) {
                stat.rugLossesAvoidedLamports += -params.actualPnLLamports;
            }
            stat.feesAvoidedLamports += params.feesPaidLamports;
            stat.capitalTimeSavedMs += params.holdingTimeMs;
        }
        else {
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
    getFilterNetValue(rule) {
        const stat = this.rules.get(rule);
        if (!stat)
            return 0n;
        return stat.lossesAvoidedLamports - stat.profitsBlockedLamports;
    }
    /**
     * MoonshotTax(F) = ExtremeWinnerEVRejected / BadEVPrevented
     */
    getMoonshotTax(rule) {
        const stat = this.rules.get(rule);
        if (!stat || stat.lossesAvoidedLamports <= 0n)
            return 0;
        const extremeEv = Number(stat.profitsBlockedLamports);
        const badEv = Number(stat.lossesAvoidedLamports);
        return extremeEv / badEv;
    }
    getStats() {
        return this.rules;
    }
    getRecentBypasses(limit = 100) {
        return this.bypassEvents.slice(-limit);
    }
}
export class PaperAuthorityPolicy {
    mode;
    counterfactualLedger;
    isBankrupt = false;
    bankruptcyRecord = null;
    constructor(mode = 'PAPER_STANDARD', counterfactualLedger = new RiskGateCounterfactualLedger()) {
        this.mode = mode === 'PAPER_CHAOS' ? 'PAPER_MAX_RISK' : mode;
        this.counterfactualLedger = counterfactualLedger;
    }
    isMaxRisk() {
        return this.mode === 'PAPER_MAX_RISK' || this.mode === 'PAPER_CHAOS';
    }
    isAggressive() {
        return this.mode === 'PAPER_AGGRESSIVE' || this.isMaxRisk();
    }
    /**
     * Evaluates a risk rule. In PAPER_MAX_RISK, if the rule returns DENY,
     * the policy transforms the paper outcome to ATTEMPT and logs a PAPER_RISK_BYPASS event.
     */
    evaluateRule(params) {
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
            const event = {
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
    handleBankruptcy(params) {
        this.isBankrupt = true;
        const now = Date.now();
        const record = {
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
    getBankruptcyRecord() {
        return this.bankruptcyRecord;
    }
    hasBankrupted() {
        return this.isBankrupt;
    }
}
//# sourceMappingURL=paper-authority-policy.js.map