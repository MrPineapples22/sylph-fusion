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
export class StrategyGovernanceEngine {
    contracts = new Map();
    performanceStore = new Map();
    /**
     * Register a machine-enforced strategy contract.
     */
    registerContract(contract) {
        this.contracts.set(contract.strategyId, contract);
    }
    getContract(strategyId) {
        return this.contracts.get(strategyId);
    }
    /**
     * Verify if a strategy is authorized to receive capital allocation.
     */
    canAllocateCapital(strategyId) {
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
    updatePerformance(strategyId, metrics) {
        this.performanceStore.set(strategyId, metrics);
        const contract = this.contracts.get(strategyId);
        if (!contract)
            return { quarantined: false };
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
    quarantine(strategyId, reason) {
        const contract = this.contracts.get(strategyId);
        if (contract) {
            this.contracts.set(strategyId, {
                ...contract,
                stage: 'QUARANTINED',
                isCapitalAuthorized: false,
            });
        }
    }
    getPerformance(strategyId) {
        return this.performanceStore.get(strategyId);
    }
}
//# sourceMappingURL=governance.js.map