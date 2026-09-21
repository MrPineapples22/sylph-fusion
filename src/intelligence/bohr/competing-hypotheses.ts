/**
 * SOL-SYLPH BOHR — Competing-Hypothesis & Evidence-Discrimination Engine
 * Part VIII — Competing Token Hypotheses, Unknown Mass Preservation & System Diagnosis
 */

export type TokenHypothesisType =
  | 'ORGANIC_EXPANSION'
  | 'COORDINATED_PUMP'
  | 'SYBIL_ACTIVITY'
  | 'WHALE_ACCUMULATION'
  | 'LIQUIDITY_MANIPULATION'
  | 'EXIT_LIQUIDITY_FORMATION'
  | 'SYSTEMIC_ROTATION'
  | 'UNKNOWN_MECHANISM';

export interface TokenHypothesis {
  readonly hypothesis_id: string;
  readonly type: TokenHypothesisType;
  readonly prior_probability: number;
  readonly posterior_probability: number;
  readonly supporting_evidence: readonly string[];
  readonly contradicting_evidence: readonly string[];
  readonly required_conditions: readonly string[];
  readonly falsification_conditions: readonly string[];
}

export interface DiscriminatingEvidenceNeed {
  readonly discriminating_question: string;
  readonly competing_hypotheses: readonly [TokenHypothesisType, TokenHypothesisType];
  readonly observation_target: string;
  readonly information_value_score: number; // 0 to 1.0
  readonly deadline_sec: number;
}

export interface HypothesisSet {
  readonly set_id: string;
  readonly token_mint: string;
  readonly dominant_hypothesis: TokenHypothesisType;
  readonly material_alternative: TokenHypothesisType;
  readonly hypotheses: readonly TokenHypothesis[];
  readonly unknown_mass: number; // Strictly >= 0.05
  readonly discriminating_need?: DiscriminatingEvidenceNeed;
  readonly diagnosed_issue?: string;
  readonly evaluated_at_ms: number;
}

export class BohrCompetingHypothesisEngine {
  /**
   * Evaluate competing hypotheses for a token based on multi-dimensional telemetry.
   */
  public evaluateTokenHypotheses(params: {
    mint: string;
    effective_participants: number;
    raw_wallet_count: number;
    top_cluster_share: number;
    liquidity_sol: number;
    volume_sol: number;
    hsi_score: number;
    pump_score: number;
    pod_score: number;
    sol_macro_regime: string;
    is_liquidity_locked: boolean;
  }): HypothesisSet {
    const rawWallets = Math.max(1, params.raw_wallet_count);
    const diversityRatio = params.effective_participants / rawWallets;

    // Calculate unnormalized scores for each candidate
    let organicScore = 0.2;
    let pumpScore = 0.15;
    let sybilScore = 0.1;
    let whaleScore = 0.1;
    let manipulationScore = 0.1;
    let exitFormationScore = 0.1;
    let rotationScore = 0.1;
    let unknownMass = 0.15; // Invariant: Unknown must always exist!

    // Evidence Evaluation
    const supporting: Record<TokenHypothesisType, string[]> = {
      ORGANIC_EXPANSION: [],
      COORDINATED_PUMP: [],
      SYBIL_ACTIVITY: [],
      WHALE_ACCUMULATION: [],
      LIQUIDITY_MANIPULATION: [],
      EXIT_LIQUIDITY_FORMATION: [],
      SYSTEMIC_ROTATION: [],
      UNKNOWN_MECHANISM: ['Residual epistemic uncertainty; unmodeled market actors.'],
    };

    const contradicting: Record<TokenHypothesisType, string[]> = {
      ORGANIC_EXPANSION: [],
      COORDINATED_PUMP: [],
      SYBIL_ACTIVITY: [],
      WHALE_ACCUMULATION: [],
      LIQUIDITY_MANIPULATION: [],
      EXIT_LIQUIDITY_FORMATION: [],
      SYSTEMIC_ROTATION: [],
      UNKNOWN_MECHANISM: [],
    };

    if (diversityRatio >= 0.6 && params.pump_score > 55 && params.pod_score < 40) {
      organicScore += 0.5;
      supporting.ORGANIC_EXPANSION.push('High wallet diversity and dispersed entry timing.');
      contradicting.SYBIL_ACTIVITY.push('Dispersed funding ancestry across buyers.');
    } else if (diversityRatio < 0.3) {
      sybilScore += 0.45;
      supporting.SYBIL_ACTIVITY.push('Shared funding root across multiple ostensibly independent buyers.');
      contradicting.ORGANIC_EXPANSION.push('Extreme buyer cluster concentration.');
    }

    if (params.top_cluster_share > 0.45 || params.hsi_score > 60) {
      pumpScore += 0.4;
      manipulationScore += 0.3;
      supporting.COORDINATED_PUMP.push('Top cluster holds >45% of supply; rapid curve acceleration.');
      supporting.LIQUIDITY_MANIPULATION.push('High suspicious HSI and coordinated micro-buys.');
    }

    if (params.pod_score > 65) {
      exitFormationScore += 0.5;
      supporting.EXIT_LIQUIDITY_FORMATION.push('High PoD score; early snipers preparing liquidity exit trap.');
      contradicting.ORGANIC_EXPANSION.push('Dangerous sell overhang from unbonded blocks.');
    }

    if (params.volume_sol > params.liquidity_sol * 3 && diversityRatio < 0.4) {
      whaleScore += 0.3;
      supporting.WHALE_ACCUMULATION.push('High volume to pool depth ratio driven by concentrated wallets.');
    }

    if (params.sol_macro_regime === 'MEME_ROTATION' || params.sol_macro_regime === 'RISK_ON') {
      rotationScore += 0.25;
      supporting.SYSTEMIC_ROTATION.push('Broader DEX capital rotation favoring new launches.');
    }

    // Normalize probabilities ensuring Unknown mass is strictly >= 0.05
    const totalScore =
      organicScore +
      pumpScore +
      sybilScore +
      whaleScore +
      manipulationScore +
      exitFormationScore +
      rotationScore +
      unknownMass;

    const probMap: Record<TokenHypothesisType, number> = {
      ORGANIC_EXPANSION: Number((organicScore / totalScore).toFixed(3)),
      COORDINATED_PUMP: Number((pumpScore / totalScore).toFixed(3)),
      SYBIL_ACTIVITY: Number((sybilScore / totalScore).toFixed(3)),
      WHALE_ACCUMULATION: Number((whaleScore / totalScore).toFixed(3)),
      LIQUIDITY_MANIPULATION: Number((manipulationScore / totalScore).toFixed(3)),
      EXIT_LIQUIDITY_FORMATION: Number((exitFormationScore / totalScore).toFixed(3)),
      SYSTEMIC_ROTATION: Number((rotationScore / totalScore).toFixed(3)),
      UNKNOWN_MECHANISM: Math.max(0.05, Number((unknownMass / totalScore).toFixed(3))),
    };

    // Sort hypotheses
    const sorted = (Object.keys(probMap) as TokenHypothesisType[]).sort((a, b) => probMap[b] - probMap[a]);
    const dominant = sorted[0];
    const materialAlternative = sorted[1];

    // Determine discriminating evidence need
    let discriminatingNeed: DiscriminatingEvidenceNeed | undefined;
    if (probMap[dominant] - probMap[materialAlternative] < 0.25) {
      discriminatingNeed = {
        discriminating_question: `Does subsequent 60s trading preserve wallet diversity or exhibit synchronized dumps?`,
        competing_hypotheses: [dominant, materialAlternative],
        observation_target: 'next_block_buyer_lineage',
        information_value_score: Number((1.0 - (probMap[dominant] - probMap[materialAlternative])).toFixed(2)),
        deadline_sec: 45,
      };
    }

    const hypothesesList: TokenHypothesis[] = sorted.map((type) => ({
      hypothesis_id: `hyp_${params.mint.slice(0, 6)}_${type.toLowerCase()}`,
      type,
      prior_probability: 0.125,
      posterior_probability: probMap[type],
      supporting_evidence: supporting[type],
      contradicting_evidence: contradicting[type],
      required_conditions: [
        type === 'ORGANIC_EXPANSION' ? 'Diversity > 0.5' : 'Concentration > 0.35',
      ],
      falsification_conditions: [
        type === 'ORGANIC_EXPANSION' ? 'Single wallet sells > 20% supply' : '10 independent buyers arrive',
      ],
    }));

    return {
      set_id: `hset_${params.mint.slice(0, 8)}_${Date.now()}`,
      token_mint: params.mint,
      dominant_hypothesis: dominant,
      material_alternative: materialAlternative,
      hypotheses: hypothesesList,
      unknown_mass: probMap.UNKNOWN_MECHANISM,
      discriminating_need: discriminatingNeed,
      evaluated_at_ms: Date.now(),
    };
  }

  /**
   * Diagnose system-level operational discrepancies (e.g. Liquidity = 0)
   */
  public diagnoseSystemDiscrepancy(params: {
    reported_liquidity_sol: number;
    provider_age_ms: number;
    rpc_healthy: boolean;
    pool_exists_on_chain: boolean;
  }): {
    diagnosis: string;
    is_data_failure: boolean;
    recommended_action: string;
  } {
    if (params.reported_liquidity_sol === 0) {
      if (!params.pool_exists_on_chain) {
        return {
          diagnosis: 'REAL_REMOVAL: Pool does not exist on chain (LP burned/rugged or pair closed).',
          is_data_failure: false,
          recommended_action: 'HALT_TRADING_AND_EMERGENCY_EXIT',
        };
      }
      if (params.provider_age_ms > 10_000 || !params.rpc_healthy) {
        return {
          diagnosis: 'PROVIDER_FAILURE: DexScreener/RPC feed stale or desynchronized.',
          is_data_failure: true,
          recommended_action: 'RETRY_ON_BACKUP_RPC_BEFORE_CONCLUSION',
        };
      }
    }
    return {
      diagnosis: 'NOMINAL: Operational state corroborated on-chain.',
      is_data_failure: false,
      recommended_action: 'CONTINUE_MONITORING',
    };
  }

  /**
   * Blueprint Engine #9: Multi-Resolution Attention Tiers (A0-A6)
   * Invariant: Critical events receive immediate bypass priority.
   */
  public computeAttentionTier(params: {
    is_emergency: boolean;
    is_live_position: boolean;
    pod_score: number;
    dominant_hypothesis: TokenHypothesisType;
    unique_buyers: number;
    whale_activity: boolean;
  }): {
    tier: 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6';
    label: string;
    refresh_rate_ms: number;
  } {
    if (params.is_emergency) {
      return { tier: 'A6', label: 'EMERGENCY', refresh_rate_ms: 100 };
    }
    if (params.is_live_position) {
      return { tier: 'A5', label: 'LIVE_POSITION', refresh_rate_ms: 250 };
    }
    if (params.pod_score > 0.75 || params.dominant_hypothesis === 'LIQUIDITY_MANIPULATION') {
      return { tier: 'A4', label: 'CRITICAL', refresh_rate_ms: 500 };
    }
    if (params.whale_activity || params.dominant_hypothesis === 'WHALE_ACCUMULATION') {
      return { tier: 'A3', label: 'INVESTIGATE', refresh_rate_ms: 1000 };
    }
    if (params.unique_buyers >= 15 || params.dominant_hypothesis === 'ORGANIC_EXPANSION') {
      return { tier: 'A2', label: 'INTERESTING', refresh_rate_ms: 3000 };
    }
    if (params.unique_buyers >= 5) {
      return { tier: 'A1', label: 'WATCH', refresh_rate_ms: 5000 };
    }
    return { tier: 'A0', label: 'BACKGROUND', refresh_rate_ms: 15000 };
  }
}

