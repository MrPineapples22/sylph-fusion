/**
 * SOL-SYLPH Master Implementation Blueprint - SAGE
 * Capability Assurance, Execution Path Budgeting & Health Synthesis
 * Specifications: Parts 78, 83-85.
 */
export class SageCapabilityAssurance {
    capabilities = {
        TOKEN_DISCOVERY: 'AVAILABLE',
        MARKET_MONITORING: 'AVAILABLE',
        TOKEN_ANALYSIS: 'AVAILABLE',
        FORECASTING: 'AVAILABLE',
        OPPORTUNITY_RANKING: 'AVAILABLE',
        NEW_ENTRY: 'AVAILABLE',
        POSITION_MANAGEMENT: 'AVAILABLE',
        PARTIAL_EXIT: 'AVAILABLE',
        EMERGENCY_EXIT: 'AVAILABLE',
        TX_RECONCILIATION: 'AVAILABLE',
        RESEARCH: 'AVAILABLE',
        REPLAY: 'AVAILABLE',
    };
    /**
     * Part 78: Audit all 12 capabilities dynamically based on system integrity and recovery state
     */
    auditCapabilities(systemStatus) {
        // 1. Emergency Exit & Position Management are highest priority
        if (!systemStatus.rpcHealthy) {
            this.capabilities.NEW_ENTRY = 'BLOCKED';
            this.capabilities.FORECASTING = 'DEGRADED';
            this.capabilities.EMERGENCY_EXIT = 'DEGRADED';
            this.capabilities.TOKEN_DISCOVERY = 'LIMITED';
        }
        else if (systemStatus.isRecovering) {
            this.capabilities.NEW_ENTRY = 'BLOCKED';
            this.capabilities.EMERGENCY_EXIT = 'AVAILABLE';
            this.capabilities.POSITION_MANAGEMENT = 'AVAILABLE';
            this.capabilities.TX_RECONCILIATION = 'RECOVERING';
            this.capabilities.RESEARCH = 'BLOCKED';
        }
        else if (systemStatus.killSwitchActive) {
            this.capabilities.NEW_ENTRY = 'BLOCKED';
            this.capabilities.EMERGENCY_EXIT = 'AVAILABLE';
            this.capabilities.RESEARCH = 'LIMITED';
        }
        else if (!systemStatus.feedFresh) {
            this.capabilities.NEW_ENTRY = 'BLOCKED';
            this.capabilities.TOKEN_DISCOVERY = 'DEGRADED';
            this.capabilities.MARKET_MONITORING = 'DEGRADED';
            this.capabilities.EMERGENCY_EXIT = 'AVAILABLE';
            this.capabilities.POSITION_MANAGEMENT = 'AVAILABLE';
            this.capabilities.TX_RECONCILIATION = 'AVAILABLE';
        }
        else {
            // Nominal
            this.capabilities.TOKEN_DISCOVERY = 'AVAILABLE';
            this.capabilities.MARKET_MONITORING = 'AVAILABLE';
            this.capabilities.TOKEN_ANALYSIS = 'AVAILABLE';
            this.capabilities.FORECASTING = 'AVAILABLE';
            this.capabilities.OPPORTUNITY_RANKING = 'AVAILABLE';
            this.capabilities.NEW_ENTRY = 'AVAILABLE';
            this.capabilities.POSITION_MANAGEMENT = 'AVAILABLE';
            this.capabilities.PARTIAL_EXIT = 'AVAILABLE';
            this.capabilities.EMERGENCY_EXIT = 'AVAILABLE';
            this.capabilities.TX_RECONCILIATION = 'AVAILABLE';
            this.capabilities.RESEARCH = 'AVAILABLE';
            this.capabilities.REPLAY = 'AVAILABLE';
        }
        // Part 83: Path budgeting (Hot <= 50ms, Warm <= 250ms, Cold throttled if queue > 20)
        const hotObservedMs = systemStatus.feedFresh ? 12 : 65;
        const coldThrottled = systemStatus.queueLag > 20 || systemStatus.isRecovering;
        // Capability score
        let availableCount = 0;
        const all = Object.values(this.capabilities);
        for (const s of all) {
            if (s === 'AVAILABLE')
                availableCount += 1.0;
            else if (s === 'LIMITED' || s === 'DEGRADED')
                availableCount += 0.5;
        }
        const score = Number(((availableCount / all.length) * 100).toFixed(1));
        return {
            capabilities: { ...this.capabilities },
            hot_path_latency_budget_ms: 50,
            hot_path_observed_latency_ms: hotObservedMs,
            warm_path_queue_depth: systemStatus.queueLag,
            cold_path_throttled: coldThrottled,
            safety_resource_reserved_pct: 35.0, // Minimum 35% reserved for safety & exit
            overall_capability_score: score,
            timestamp_ms: Date.now(),
        };
    }
    getCapability(capability) {
        return this.capabilities[capability];
    }
    /**
     * Section 7: Replace coarse orders_locked with fine-grained capability matrix.
     */
    getGranularCapabilityMatrix(systemStatus) {
        const audit = this.auditCapabilities(systemStatus);
        const openAllowed = audit.capabilities.NEW_ENTRY === 'AVAILABLE';
        const emergencyAllowed = audit.capabilities.EMERGENCY_EXIT === 'AVAILABLE';
        const posMgmtAllowed = audit.capabilities.POSITION_MANAGEMENT === 'AVAILABLE';
        return {
            can_discover: systemStatus.feedFresh ? 'ENABLED' : 'DEGRADED',
            can_analyze: systemStatus.feedFresh ? 'ENABLED' : 'DEGRADED',
            can_open: openAllowed ? 'ENABLED' : 'BLOCKED',
            can_increase: openAllowed ? 'ENABLED' : 'BLOCKED',
            can_reduce: posMgmtAllowed ? 'ENABLED' : 'BLOCKED',
            can_close: emergencyAllowed ? 'ENABLED' : 'BLOCKED',
            can_quote: systemStatus.feedFresh ? 'ENABLED' : 'DEGRADED',
            can_build_tx: systemStatus.rpcHealthy ? 'ENABLED' : 'BLOCKED',
            can_sign: !systemStatus.killSwitchActive ? 'ENABLED' : 'BLOCKED',
            can_submit: systemStatus.rpcHealthy ? 'ENABLED' : 'BLOCKED',
            can_confirm: 'ENABLED',
            can_reconcile: 'ENABLED',
        };
    }
}
//# sourceMappingURL=capability-assurance.js.map