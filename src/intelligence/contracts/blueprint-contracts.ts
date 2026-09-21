/**
 * SOL-SYLPH Master Implementation Blueprint - Shared Contracts
 * Unified Intelligence, Strategy Coordination, Capital Planning, Governance,
 * Counterfactual Learning, Predictive Safety, Recovery, Scientific Memory,
 * Adversarial Intelligence & External Context.
 */

export type StrategyAction =
  | 'ENTER'
  | 'ADD'
  | 'HOLD'
  | 'REDUCE'
  | 'EXIT'
  | 'AVOID'
  | 'OBSERVE';

export type TimeHorizon =
  | 'MOMENTUM_1M'
  | 'SHORT_5M'
  | 'MEDIUM_15M'
  | 'LONG_1H';

export type UrgencyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface StrategyIntent {
  readonly intent_id: string;
  readonly strategy_id: string;
  readonly strategy_version: string;
  readonly mint: string;
  readonly opportunity_id: string;
  readonly thesis_id: string;
  readonly action: StrategyAction;
  readonly requested_size: number;
  readonly minimum_size: number;
  readonly maximum_size: number;
  readonly urgency: UrgencyLevel;
  readonly horizon: TimeHorizon;
  readonly expected_edge: number;
  readonly uncertainty: number;
  readonly belief_version: string;
  readonly state_version: string;
  readonly evidence_refs: readonly string[];
  readonly risk_domains: readonly string[];
  readonly valid_until: number;
  readonly created_at: number;
}

export interface CanonicalOpportunity {
  readonly opportunity_id: string;
  readonly mint: string;
  readonly symbol?: string;
  readonly edge_family: string;
  readonly situation: string;
  readonly evidence_lineage: readonly string[];
  readonly wallet_cohort: string;
  readonly theme: string;
  readonly effective_independent_families: number;
  readonly supporting_strategies: readonly string[];
  readonly opposing_strategies: readonly string[];
  readonly consensus_score: number;
  readonly internal_crowding: 'LOW' | 'MODERATE' | 'HIGH';
  readonly external_crowding: 'LOW' | 'MODERATE' | 'HIGH';
  readonly lifecycle_state: 'EMERGING' | 'PEAK' | 'DECAYING' | 'EXPIRED';
  readonly remaining_life_sec: number;
  readonly capacity_sol: number;
}

export interface ResolvedPortfolioIntent {
  readonly resolution_id: string;
  readonly mint: string;
  readonly canonical_opportunity_id: string;
  readonly net_action: StrategyAction;
  readonly net_size_sol: number;
  readonly physical_execution_required: boolean;
  readonly internal_reallocations: readonly {
    readonly strategy_id: string;
    readonly virtual_claim_delta: number;
    readonly resulting_claim: number;
  }[];
  readonly prevented_round_trip_volume_sol: number;
  readonly governing_policy_version: string;
  readonly timestamp_ms: number;
}

export interface CapitalState {
  readonly available_sol: number;
  readonly reserved_sol: number;
  readonly deployed_sol: number;
  readonly releasing_sol: number;
  readonly pending_sol: number;
  readonly exit_reserve_sol: number;
  readonly execution_reserve_sol: number;
  readonly risk_budget_sol: number;
  readonly commitments: Readonly<Record<string, number>>;
  readonly positions: Readonly<Record<string, number>>;
  readonly timestamp_ms: number;
}

export type MissionMode =
  | 'NORMAL'
  | 'OPPORTUNITY_RICH'
  | 'CAPITAL_SCARCE'
  | 'DEFENSIVE'
  | 'PRESERVATION'
  | 'RECOVERY'
  | 'DATA_DEGRADED'
  | 'EXECUTION_DEGRADED'
  | 'RESEARCH';

export type PolicyAuthorityLayer =
  | 'CONSTITUTIONAL'
  | 'SAFETY_CRITICAL'
  | 'MISSION_CRITICAL'
  | 'CERTIFIED_POLICY'
  | 'ADAPTIVE_POLICY'
  | 'RUNTIME_PARAMETER'
  | 'EXPERIMENTAL';

export interface PolicyRecord {
  readonly policy_id: string;
  readonly version: string;
  readonly rule_class: PolicyAuthorityLayer;
  readonly status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED' | 'TRIAL';
  readonly authorized_modifier: string;
  readonly dependencies: readonly string[];
  readonly constraints: readonly string[];
  readonly effective_from: number;
  readonly expires_at: number;
  readonly certification_id: string;
  readonly hash: string;
  readonly supersedes?: string;
  readonly rollback_target?: string;
}

export interface PolicyLineage {
  readonly constitution_version: string;
  readonly safety_policy_id: string;
  readonly mission_policy_id: string;
  readonly capital_policy_id: string;
  readonly strategy_policy_id: string;
  readonly decision_id: string;
  readonly intent_id: string;
  readonly transaction_signature?: string;
}

export type ShadowBranchType = 'LIVE' | 'SKIP' | 'WAIT' | 'ENTER_25' | 'ENTER_75';

export interface ShadowPortfolioBranch {
  readonly branch_id: string;
  readonly branch_type: ShadowBranchType;
  readonly decision_epoch: number;
  readonly simulated_cash_sol: number;
  readonly simulated_position_units: number;
  readonly simulated_cost_basis_sol: number;
  readonly realized_pnl_sol: number;
  readonly unrealized_pnl_sol: number;
  readonly total_fees_paid_sol: number;
  readonly max_drawdown_pct: number;
  readonly opportunity_cost_sol: number;
  readonly decision_regret_sol: number;
  readonly active: boolean;
}

export interface NearMissEvent {
  readonly event_id: string;
  readonly boundary_name: string;
  readonly timestamp_ms: number;
  readonly closest_approach_pct: number;
  readonly duration_ms: number;
  readonly contributing_factors: readonly string[];
  readonly protective_controls_triggered: readonly string[];
  readonly actual_outcome: 'SUCCESS' | 'CONTAINED' | 'DEGRADED';
  readonly counterfactual_failure_probability: number;
}

export type PhoenixStage =
  | 'IDLE'
  | 'FAILURE'
  | 'CONTAIN'
  | 'FREEZE_EVIDENCE'
  | 'CLASSIFY'
  | 'BLAST_RADIUS'
  | 'LAST_KNOWN_GOOD'
  | 'CHAIN_RECONCILIATION'
  | 'POSITION_RECONCILIATION'
  | 'TRANSACTION_RECONCILIATION'
  | 'STATE_REBUILD'
  | 'FEATURE_REBUILD'
  | 'CAPABILITY_PROOFS'
  | 'LIMITED_OPERATION'
  | 'RECERTIFICATION'
  | 'NORMAL';

export type KnowledgeStatus =
  | 'PROPOSED'
  | 'TESTING'
  | 'PRELIMINARY'
  | 'REPLICATED'
  | 'PROVISIONAL'
  | 'ESTABLISHED'
  | 'WEAKENING'
  | 'CONTESTED'
  | 'SUPERSEDED'
  | 'FALSIFIED'
  | 'STALE';

export interface ApplicabilityEnvelope {
  readonly valid_regimes: readonly string[];
  readonly min_token_age_sec: number;
  readonly max_token_age_sec: number;
  readonly min_liquidity_usd: number;
  readonly max_liquidity_usd: number;
  readonly max_crowding_pct: number;
  readonly horizons: readonly TimeHorizon[];
}

export interface SpilloverEvent {
  readonly event_id: string;
  readonly source_market: 'BITCOIN' | 'ETHEREUM' | 'SOLANA_MACRO' | 'STABLECOINS' | 'CROSS_DEX';
  readonly target_scope: 'GLOBAL' | 'MEME_ECOSYSTEM' | 'THEMATIC_CLUSTER' | 'TOKEN_SPECIFIC';
  readonly start_time: number;
  readonly as_of_slot: number;
  readonly observations: readonly string[];
  readonly possible_causes: readonly string[];
  readonly possible_transmission_paths: readonly string[];
  readonly affected_themes: readonly string[];
  readonly affected_tokens: readonly string[];
  readonly affected_positions: readonly string[];
  readonly confidence: number;
  readonly uncertainty: number;
  readonly state_version: string;
}

export type CapabilityState =
  | 'AVAILABLE'
  | 'DEGRADED'
  | 'LIMITED'
  | 'BLOCKED'
  | 'UNKNOWN'
  | 'RECOVERING';

export type PlatformCapability =
  | 'TOKEN_DISCOVERY'
  | 'MARKET_MONITORING'
  | 'TOKEN_ANALYSIS'
  | 'FORECASTING'
  | 'OPPORTUNITY_RANKING'
  | 'NEW_ENTRY'
  | 'POSITION_MANAGEMENT'
  | 'PARTIAL_EXIT'
  | 'EMERGENCY_EXIT'
  | 'TX_RECONCILIATION'
  | 'RESEARCH'
  | 'REPLAY';
