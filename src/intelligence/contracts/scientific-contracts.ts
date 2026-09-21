/**
 * SOL-SYLPH Scientific Intelligence & Strategy Evolution - Shared Contracts
 * Parts II, III, XV, XVI
 */

import type { TokenId, EventId } from '../events/canonical-event.js';
import type { EpistemicType, FactStatus } from '../evidence/evidence-registry.js';
import type { MissionMode } from './blueprint-contracts.js';

// ==========================================
// PART II — CANONICAL CONTEXT SNAPSHOT
// ==========================================

export interface CanonicalContextSnapshot {
  readonly snapshot_id: string;
  readonly token_mint: string;

  readonly chain_slot: number;
  readonly chain_timestamp: number;
  readonly market_timestamp: number;
  readonly created_at: number;

  readonly token_state_version: string;

  // Pricing & Liquidity
  readonly price_sol: number;
  readonly price_usd: number;
  readonly liquidity_sol: number;
  readonly market_cap_sol: number;
  readonly volume_24h_sol: number;

  // Transaction Microstructure
  readonly txs: number;
  readonly live_txs_1m: number;
  readonly unique_traders: number;
  readonly sells_count: number;
  readonly buy_sell_ratio: number;

  // Core Intelligence Scores
  readonly HSI: number;
  readonly PumpScore: number;
  readonly PoD: number;
  readonly RugScore: number;

  readonly market_regime: string;

  // Actors & Network
  readonly wallet_graph_version: string;
  readonly creator_risk: number;
  readonly whale_activity_score: number;
  readonly bundle_activity_score: number;
  readonly institutional_score: number;

  // AI & Model Predictors
  readonly AI_model_version: string;
  readonly AI_prediction: number;
  readonly AI_confidence: number;
  readonly OOD_score: number;

  // Source Freshness & Health
  readonly source_health: 'OPTIMAL' | 'DEGRADED' | 'CRITICAL';
  readonly source_freshness_ms: number;
  readonly source_conflicts: readonly string[];

  // Processing & Latency
  readonly queue_depth: number;
  readonly event_age_ms: number;
  readonly inference_latency_ms: number;
  readonly total_latency_ms: number;

  // Portfolio State
  readonly open_positions_count: number;
  readonly portfolio_exposure_sol: number;

  readonly system_mode: MissionMode;
}

// ==========================================
// PART III — EVIDENCE GRAPH
// ==========================================

export type EvidenceRelation =
  | 'SUPPORTS'
  | 'CONTRADICTS'
  | 'CORROBORATES'
  | 'DISCOUNTS'
  | 'INVALIDATES';

export interface Evidence {
  readonly evidence_id: string;
  readonly claim: string;
  readonly epistemic_type: EpistemicType;
  readonly fact_status: FactStatus;
  readonly confidence: number; // 0.0 to 1.0
  readonly observed_at_ms: number;
  readonly known_at_ms: number;
  readonly provider: string;
  readonly source_event_id?: EventId;
  readonly slot: number;
  readonly dependencies: readonly string[]; // evidence_ids this relies on
  readonly is_retracted: boolean;
  readonly retraction_reason?: string;
  readonly revision_number: number;
  readonly content_hash: string;
}

export interface EvidenceDependency {
  readonly parent_evidence_id: string;
  readonly child_evidence_id: string;
  readonly relationship: EvidenceRelation;
  readonly weight: number;
}

export interface EvidenceGroup {
  readonly group_id: string;
  readonly root_id: string;
  readonly target_mint: string;
  readonly evidence_ids: readonly string[];
  readonly aggregate_confidence: number;
  readonly is_corroborated: boolean;
  readonly primary_provider: string;
  readonly created_at: number;
}

export interface EvidenceRevision {
  readonly revision_id: string;
  readonly evidence_id: string;
  readonly prior_version: number;
  readonly new_version: number;
  readonly reason: string;
  readonly modified_by: string;
  readonly timestamp_ms: number;
}

export interface EvidenceRetraction {
  readonly retraction_id: string;
  readonly evidence_id: string;
  readonly reason: string;
  readonly invalidated_downstream_evidence: readonly string[];
  readonly slot: number;
  readonly timestamp_ms: number;
}

// ==========================================
// PART XV — CANONICAL DECISION OBJECT
// ==========================================

export interface DecisionCandidate {
  readonly decision_id: string;
  readonly snapshot_id: string;
  readonly token_mint: string;
  readonly evidence_root: string;

  readonly hypothesis_set_id: string;
  readonly dominant_hypothesis: string;
  readonly belief_state_id: string;
  readonly belief_confidence: number;

  readonly knowledge_claims: readonly string[];
  readonly causal_state: 'IDENTIFIED' | 'PLAUSIBLE' | 'ASSUMPTION_SENSITIVE' | 'NOT_IDENTIFIED' | 'UNKNOWN';

  readonly forecast_id: string;
  readonly strategy_id: string;
  readonly strategy_version: string;
  readonly gene_manifest: readonly string[]; // gene IDs

  readonly risk_state: 'LOW' | 'WATCH' | 'HIGH' | 'BLOCK';
  readonly system_health: 'OPTIMAL' | 'DEGRADED' | 'HALTED';

  readonly decision_deadline_ms: number;
  readonly recommended_action: 'ENTER' | 'ADD' | 'HOLD' | 'REDUCE' | 'EXIT' | 'ABSTAIN';
  readonly recommended_size_sol: number;
  readonly uncertainty: number;

  readonly reason_codes: readonly string[];
  readonly created_at_ms: number;
}

// ==========================================
// PART XVI — REVOCABLE EXECUTION PERMIT
// ==========================================

export interface ScientificExecutionPermit {
  readonly permit_id: string;
  readonly decision_id: string;
  readonly snapshot_id: string;
  readonly token_mint: string;
  readonly side: 'BUY' | 'SELL';

  readonly max_amount_sol: number;
  readonly max_slippage_bps: number;
  readonly max_priority_fee_lamports: bigint;

  readonly issued_at_ms: number;
  readonly expires_at_ms: number;

  readonly evidence_root_hash: string;
  readonly risk_policy_version: string;
  readonly model_version: string;

  readonly required_mode: MissionMode;
  readonly required_sources: readonly string[];

  readonly revocation_epoch: number;
  readonly is_revoked: boolean;
  readonly revocation_reason?: string;
}
