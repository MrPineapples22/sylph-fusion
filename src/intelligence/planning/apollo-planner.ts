/**
 * APOLLO: Goal-Directed Mission Planner
 * Blueprint Engine #24
 * 
 * Manages structured missions for every tracked opportunity and active position:
 * Priorities: P0 EMERGENCY | P1 ACTIVE_POSITION | P2 EXECUTION | P3 HIGH_POTENTIAL |
 * P4 INVESTIGATION | P5 RESEARCH | P6 BACKGROUND.
 * Invariant: Entry is not the end of reasoning; missions persist throughout position lifecycle.
 */

export type ApolloPriority = 
  | 'P0_EMERGENCY'
  | 'P1_ACTIVE_POSITION'
  | 'P2_EXECUTION'
  | 'P3_HIGH_POTENTIAL'
  | 'P4_INVESTIGATION'
  | 'P5_RESEARCH'
  | 'P6_BACKGROUND';

export type ApolloMissionState = 
  | 'CREATED'
  | 'SCOUTING'
  | 'INVESTIGATING'
  | 'ACQUIRING'
  | 'MONITORING_ACTIVE'
  | 'EXITING'
  | 'CONCLUDED'
  | 'ABORTED';

export interface ApolloMission {
  readonly mission_id: string;
  readonly token_mint: string;
  readonly priority: ApolloPriority;
  readonly state: ApolloMissionState;
  readonly objective: string;
  readonly risk_budget_sol: number;
  readonly max_slippage_bps: number;
  readonly profit_target_pct: number;
  readonly stop_loss_pct: number;
  readonly created_at_ms: number;
  readonly deadline_ms: number;
  readonly success_condition: string;
  readonly failure_condition: string;
  readonly abort_condition: string;
  readonly is_active_position: boolean;
}

export class ApolloMissionPlanner {
  public static readonly VERSION = '1.0.0';
  private missions: Map<string, ApolloMission> = new Map();

  public createMission(params: {
    token_mint: string;
    priority: ApolloPriority;
    objective: string;
    risk_budget_sol: number;
    ttl_minutes: number;
    profit_target_pct?: number;
    stop_loss_pct?: number;
  }): ApolloMission {
    const now = Date.now();
    const missionId = `mis_${params.token_mint.slice(0, 6)}_${now}`;

    const mission: ApolloMission = {
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

  public transitionState(tokenMint: string, newState: ApolloMissionState): ApolloMission | undefined {
    const mission = this.missions.get(tokenMint);
    if (!mission) return undefined;

    const updated: ApolloMission = {
      ...mission,
      state: newState,
      priority: (newState === 'MONITORING_ACTIVE' || newState === 'ACQUIRING') ? 'P1_ACTIVE_POSITION' : mission.priority,
      is_active_position: newState === 'MONITORING_ACTIVE' || newState === 'ACQUIRING'
    };

    this.missions.set(tokenMint, updated);
    return updated;
  }

  public getMission(tokenMint: string): ApolloMission | undefined {
    return this.missions.get(tokenMint);
  }

  public getActivePositions(): readonly ApolloMission[] {
    return Array.from(this.missions.values()).filter(m => m.is_active_position && m.state !== 'CONCLUDED' && m.state !== 'ABORTED');
  }
}
