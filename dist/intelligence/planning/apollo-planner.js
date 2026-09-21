/**
 * APOLLO: Goal-Directed Mission Planner
 * Blueprint Engine #24
 *
 * Manages structured missions for every tracked opportunity and active position:
 * Priorities: P0 EMERGENCY | P1 ACTIVE_POSITION | P2 EXECUTION | P3 HIGH_POTENTIAL |
 * P4 INVESTIGATION | P5 RESEARCH | P6 BACKGROUND.
 * Invariant: Entry is not the end of reasoning; missions persist throughout position lifecycle.
 */
export class ApolloMissionPlanner {
    static VERSION = '1.0.0';
    missions = new Map();
    createMission(params) {
        const now = Date.now();
        const missionId = `mis_${params.token_mint.slice(0, 6)}_${now}`;
        const mission = {
            mission_id: missionId,
            token_mint: params.token_mint,
            priority: params.priority,
            state: 'CREATED',
            objective: params.objective,
            risk_budget_sol: params.risk_budget_sol,
            max_slippage_bps: 150,
            profit_target_pct: params.profit_target_pct ?? 25.0,
            stop_loss_pct: params.stop_loss_pct ?? -12.0,
            created_at_ms: now,
            deadline_ms: now + params.ttl_minutes * 60000,
            success_condition: `Attain target profit +${params.profit_target_pct ?? 25}% or clean confirmation`,
            failure_condition: `Drawdown reaches stop loss ${params.stop_loss_pct ?? -12}% or cascade collapse`,
            abort_condition: 'Guardian safety violation or critical invariant break',
            is_active_position: params.priority === 'P1_ACTIVE_POSITION'
        };
        this.missions.set(mission.token_mint, mission);
        return mission;
    }
    transitionState(tokenMint, newState) {
        const mission = this.missions.get(tokenMint);
        if (!mission)
            return undefined;
        const updated = {
            ...mission,
            state: newState,
            priority: (newState === 'MONITORING_ACTIVE' || newState === 'ACQUIRING') ? 'P1_ACTIVE_POSITION' : mission.priority,
            is_active_position: newState === 'MONITORING_ACTIVE' || newState === 'ACQUIRING'
        };
        this.missions.set(tokenMint, updated);
        return updated;
    }
    getMission(tokenMint) {
        return this.missions.get(tokenMint);
    }
    getActivePositions() {
        return Array.from(this.missions.values()).filter(m => m.is_active_position && m.state !== 'CONCLUDED' && m.state !== 'ABORTED');
    }
}
//# sourceMappingURL=apollo-planner.js.map