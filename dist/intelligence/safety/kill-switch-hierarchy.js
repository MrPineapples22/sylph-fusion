/**
 * SOL-SYLPH Master Production Intelligence - Kill-Switch Hierarchy & Degradation Modes
 * Specifications: Parts LXXV (Kill-Switch Hierarchy), LXXVI (Hard Safety Invariants),
 * LXXVII (Graceful Degradation).
 *
 * Implements:
 * - Granular Kill-Switch Hierarchy: TOKEN, SIGNAL, MODEL, DOMAIN, EXECUTION, SYSTEM
 * - Operational Degradation Modes: MODE 0 through MODE 5
 * - Hard Safety Invariants (deterministic fail-closed protections)
 */
export class KillSwitchHierarchy {
    currentMode = 'MODE_0_FULL';
    activeSwitches = new Map();
    /**
     * Activates a targeted kill-switch
     */
    activateKill(level, targetId, reason, activatedBy = 'AUTO_DEFENSE') {
        const key = `${level}::${targetId}`;
        this.activeSwitches.set(key, {
            level,
            targetId,
            reason,
            activatedAtMs: Date.now(),
            activatedBy,
        });
        // Auto-escalate system degradation mode if broad switches fire
        if (level === 'SYSTEM_KILL') {
            this.currentMode = 'MODE_5_HALT';
        }
        else if (level === 'EXECUTION_KILL' && this.currentMode !== 'MODE_5_HALT') {
            this.currentMode = 'MODE_3_SHADOW_ONLY';
        }
    }
    /**
     * Deactivates a targeted kill-switch
     */
    deactivateKill(level, targetId) {
        const key = `${level}::${targetId}`;
        const removed = this.activeSwitches.delete(key);
        if (level === 'SYSTEM_KILL' && this.currentMode === 'MODE_5_HALT') {
            this.currentMode = 'MODE_0_FULL';
        }
        return removed;
    }
    /**
     * Checks if an action is permitted for a given context
     */
    isActionPermitted(params) {
        // 1. Global System Kill
        if (this.activeSwitches.has('SYSTEM_KILL::*') || this.currentMode === 'MODE_5_HALT') {
            return { permitted: false, denialReason: 'SYSTEM_KILL_ACTIVE: Complete platform halt' };
        }
        // 2. Execution Kill
        if (params.isLiveExecution && (this.activeSwitches.has('EXECUTION_KILL::*') || this.currentMode === 'MODE_3_SHADOW_ONLY' || this.currentMode === 'MODE_4_OBSERVATION_ONLY')) {
            return { permitted: false, denialReason: 'EXECUTION_KILL_ACTIVE: Live capital deployment locked' };
        }
        // 3. Domain Kill
        if (params.domain && this.activeSwitches.has(`DOMAIN_KILL::${params.domain}`)) {
            return { permitted: false, denialReason: `DOMAIN_KILL_ACTIVE: Domain ${params.domain} quarantined` };
        }
        // 4. Token Kill
        if (params.mint && this.activeSwitches.has(`TOKEN_KILL::${params.mint}`)) {
            return { permitted: false, denialReason: `TOKEN_KILL_ACTIVE: Token ${params.mint} blacklisted` };
        }
        // 5. Model Kill
        if (params.modelName && this.activeSwitches.has(`MODEL_KILL::${params.modelName}`)) {
            return { permitted: false, denialReason: `MODEL_KILL_ACTIVE: Model ${params.modelName} quarantined` };
        }
        // 6. Signal Kill
        if (params.signalName && this.activeSwitches.has(`SIGNAL_KILL::${params.signalName}`)) {
            return { permitted: false, denialReason: `SIGNAL_KILL_ACTIVE: Signal ${params.signalName} bypassed` };
        }
        return { permitted: true };
    }
    setMode(mode) {
        this.currentMode = mode;
    }
    getStatus() {
        const active = Array.from(this.activeSwitches.values());
        let liveTrading = false;
        let shadow = false;
        let ingestion = true;
        let desc = '';
        let subsystems = [];
        switch (this.currentMode) {
            case 'MODE_0_FULL':
                liveTrading = true;
                shadow = true;
                desc = 'Full operational state with all intelligence models active';
                subsystems = ['INGESTION', 'POINT_IN_TIME', 'MODELS', 'PORTFOLIO', 'LIVE_EXECUTION', 'TWIN'];
                break;
            case 'MODE_1_MINOR_DEGRADATION':
                liveTrading = true;
                shadow = true;
                desc = 'Minor degradation: Non-critical telemetry delayed, core models healthy';
                subsystems = ['INGESTION', 'POINT_IN_TIME', 'MODELS', 'PORTFOLIO', 'LIVE_EXECUTION'];
                break;
            case 'MODE_2_REDUCED_INTELLIGENCE':
                liveTrading = true;
                shadow = true;
                desc = 'Reduced intelligence: Complex models bypassed, conservative deterministic heuristics active';
                subsystems = ['INGESTION', 'POINT_IN_TIME', 'CONSERVATIVE_HEURISTICS', 'LIVE_EXECUTION'];
                break;
            case 'MODE_3_SHADOW_ONLY':
                liveTrading = false;
                shadow = true;
                desc = 'Shadow execution only: Zero real capital at risk, full digital twin evaluation';
                subsystems = ['INGESTION', 'POINT_IN_TIME', 'MODELS', 'SHADOW_SIMULATION'];
                break;
            case 'MODE_4_OBSERVATION_ONLY':
                liveTrading = false;
                shadow = false;
                desc = 'Observation only: Market data recorded, no execution simulation';
                subsystems = ['INGESTION', 'MARKET_MEMORY'];
                break;
            case 'MODE_5_HALT':
                liveTrading = false;
                shadow = false;
                ingestion = false;
                desc = 'EMERGENCY HALT: Complete shutdown of network connections and execution';
                subsystems = [];
                break;
        }
        return {
            mode: this.currentMode,
            description: desc,
            liveTradingPermitted: liveTrading,
            shadowSimulationPermitted: shadow,
            dataIngestionActive: ingestion,
            availableSubsystems: subsystems,
            activeKillSwitches: active,
        };
    }
}
//# sourceMappingURL=kill-switch-hierarchy.js.map