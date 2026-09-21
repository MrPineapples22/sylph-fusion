/**
 * SOL-SYLPH Master Implementation Blueprint - SCOUT
 * Strategy Coordination, Opportunity Unification & Internal Market Engine
 * Specifications: Parts 5-11.
 */

import {
  StrategyIntent,
  CanonicalOpportunity,
  ResolvedPortfolioIntent,
  StrategyAction,
} from '../contracts/blueprint-contracts.js';

export interface StrategyCorrelationNode {
  readonly strategy_id: string;
  readonly lineage: string;
  readonly evidence_keys: Set<string>;
  readonly feature_keys: Set<string>;
  readonly model_keys: Set<string>;
  readonly target_mints: Set<string>;
}

export interface EdgeCapacityEntry {
  readonly mint: string;
  readonly gross_market_capacity_sol: number;
  readonly executable_capacity_sol: number;
  readonly allocated_capacity_sol: number;
  readonly reserved_capacity_sol: number;
  readonly remaining_capacity_sol: number;
  readonly internal_crowding: 'LOW' | 'MODERATE' | 'HIGH';
  readonly external_crowding: 'LOW' | 'MODERATE' | 'HIGH';
}

export class ScoutStrategyCoordinator {
  // Strategy lineage and correlation graph
  private readonly strategyRegistry = new Map<string, StrategyCorrelationNode>();

  // Virtual Strategy Books: strategyId -> mint -> virtualClaimUnits
  private readonly virtualBooks = new Map<string, Map<string, number>>();

  // Physical positions currently tracked
  private readonly physicalHoldings = new Map<string, number>();

  // Edge capacity ledger per mint
  private readonly capacityLedger = new Map<string, EdgeCapacityEntry>();

  // Active canonical opportunities: mint -> CanonicalOpportunity
  private readonly canonicalOpportunities = new Map<string, CanonicalOpportunity>();

  // History of resolutions
  private readonly resolutions: ResolvedPortfolioIntent[] = [];

  constructor() {
    this.registerDefaultStrategies();
  }

  private registerDefaultStrategies(): void {
    this.registerStrategy({
      strategy_id: 'breakout_momentum_v1',
      lineage: 'momentum_family',
      evidence_keys: new Set(['velocity_4s', 'volume_1h_spike', 'bonding_curve_accel']),
      feature_keys: new Set(['velocity', 'volume1h', 'rsi']),
      model_keys: new Set(['alpha_model_v2', 'timing_model_v1']),
      target_mints: new Set(),
    });

    this.registerStrategy({
      strategy_id: 'dip_recovery_v1',
      lineage: 'mean_reversion_family',
      evidence_keys: new Set(['rsi_oversold_cross', 'ma5_ma20_divergence']),
      feature_keys: new Set(['rsi', 'fast_ma', 'slow_ma']),
      model_keys: new Set(['alpha_model_v2', 'uncertainty_model_v1']),
      target_mints: new Set(),
    });

    this.registerStrategy({
      strategy_id: 'kol_flow_follower_v1',
      lineage: 'momentum_family', // Shares lineage with breakout
      evidence_keys: new Set(['volume_1h_spike', 'kol_accumulation_cluster']),
      feature_keys: new Set(['volume1h', 'kol_sol']),
      model_keys: new Set(['alpha_model_v2']),
      target_mints: new Set(),
    });
  }

  public registerStrategy(node: StrategyCorrelationNode): void {
    this.strategyRegistry.set(node.strategy_id, node);
    if (!this.virtualBooks.has(node.strategy_id)) {
      this.virtualBooks.set(node.strategy_id, new Map());
    }
  }

  /**
   * Part 6: Canonical Opportunity Identity
   * Deduplicates multiple strategies targeting the same token.
   */
  public canonicalizeOpportunity(
    mint: string,
    intents: readonly StrategyIntent[],
    marketContext: {
      symbol?: string;
      liquidity_sol?: number;
      volume_1h_sol?: number;
      theme?: string;
      wallet_cohort?: string;
    } = {}
  ): CanonicalOpportunity {
    const supporting: string[] = [];
    const opposing: string[] = [];
    const lineageSet = new Set<string>();
    const evidenceSet = new Set<string>();

    for (const intent of intents) {
      if (['ENTER', 'ADD', 'HOLD'].includes(intent.action)) {
        supporting.push(intent.strategy_id);
      } else if (['REDUCE', 'EXIT', 'AVOID'].includes(intent.action)) {
        opposing.push(intent.strategy_id);
      }

      const meta = this.strategyRegistry.get(intent.strategy_id);
      if (meta) {
        lineageSet.add(meta.lineage);
        meta.evidence_keys.forEach((k) => evidenceSet.add(k));
      }
      intent.evidence_refs.forEach((ref) => evidenceSet.add(ref));
    }

    // Effective independent strategy families is bounded by unique lineages and independent evidence
    const effectiveFamilies = Math.max(1, lineageSet.size);

    // Compute consensus score: ratio of supporting weight to total weight
    const totalWeight = supporting.length + opposing.length;
    const consensus = totalWeight > 0 ? supporting.length / totalWeight : 0.5;

    // Internal crowding evaluates how many local strategies are competing for same token
    const internalCrowding: 'LOW' | 'MODERATE' | 'HIGH' =
      supporting.length > 3 ? 'HIGH' : supporting.length > 1 ? 'MODERATE' : 'LOW';

    const liquiditySol = marketContext.liquidity_sol ?? 50;
    const capacitySol = Math.max(0.5, liquiditySol * 0.15); // Max 15% of pool liquidity to prevent destructive price impact

    const canonical: CanonicalOpportunity = {
      opportunity_id: `opp_${mint.slice(0, 8)}_${Date.now()}`,
      mint,
      symbol: marketContext.symbol,
      edge_family: lineageSet.size > 0 ? Array.from(lineageSet).join('+') : 'independent',
      situation: consensus > 0.6 ? 'CONSENSUS_BULLISH' : consensus < 0.4 ? 'CONSENSUS_BEARISH' : 'MIXED_SIGNALS',
      evidence_lineage: Array.from(evidenceSet),
      wallet_cohort: marketContext.wallet_cohort || 'organic_early_adopters',
      theme: marketContext.theme || 'solana_defi_native',
      effective_independent_families: effectiveFamilies,
      supporting_strategies: supporting,
      opposing_strategies: opposing,
      consensus_score: Number(consensus.toFixed(3)),
      internal_crowding: internalCrowding,
      external_crowding: marketContext.volume_1h_sol && marketContext.volume_1h_sol > 500 ? 'HIGH' : 'LOW',
      lifecycle_state: 'EMERGING',
      remaining_life_sec: 180,
      capacity_sol: Number(capacitySol.toFixed(2)),
    };

    this.canonicalOpportunities.set(mint, canonical);
    return canonical;
  }

  /**
   * Part 8 & 10: Strategy Conflict Engine & Internal Netting
   * Evaluates concurrent intents from multiple strategies on a single token,
   * arbitrates direction/size conflicts without arrival-order bias,
   * nets opposing positions internally, and updates virtual books.
   */
  public resolveIntents(
    mint: string,
    intents: readonly StrategyIntent[],
    tokenPriceSol: number
  ): ResolvedPortfolioIntent {
    if (intents.length === 0) {
      return {
        resolution_id: `res_noop_${Date.now()}`,
        mint,
        canonical_opportunity_id: 'none',
        net_action: 'OBSERVE',
        net_size_sol: 0,
        physical_execution_required: false,
        internal_reallocations: [],
        prevented_round_trip_volume_sol: 0,
        governing_policy_version: 'scout_v1_conservative',
        timestamp_ms: Date.now(),
      };
    }

    const canonical = this.canonicalOpportunities.get(mint) || this.canonicalizeOpportunity(mint, intents);

    let desiredBuySol = 0;
    let desiredSellSol = 0;
    const reallocations: { strategy_id: string; virtual_claim_delta: number; resulting_claim: number }[] = [];

    // Tally desired exposure by action
    for (const intent of intents) {
      if (intent.action === 'ENTER' || intent.action === 'ADD') {
        desiredBuySol += Math.min(intent.requested_size, canonical.capacity_sol);
      } else if (intent.action === 'REDUCE' || intent.action === 'EXIT') {
        desiredSellSol += intent.requested_size;
      }
    }

    // Part 10: Internal Netting
    // e.g. Strategy A wants BUY 10 SOL, Strategy B wants SELL 6 SOL -> Net Buy is 4 SOL
    // Prevented external round-trip volume = 6 SOL
    const netDeltaSol = desiredBuySol - desiredSellSol;
    const preventedRoundTripSol = Math.min(desiredBuySol, desiredSellSol);

    let netAction: StrategyAction = 'HOLD';
    let netSizeSol = Math.abs(netDeltaSol);

    if (netDeltaSol > 0.01) {
      netAction = 'ENTER';
    } else if (netDeltaSol < -0.01) {
      netAction = 'REDUCE';
    } else {
      netAction = 'HOLD';
      netSizeSol = 0;
    }

    // Part 9: Virtual Strategy Books Update
    for (const intent of intents) {
      const book = this.virtualBooks.get(intent.strategy_id) ?? new Map<string, number>();
      const currentClaim = book.get(mint) ?? 0;
      let claimDelta = 0;

      if (intent.action === 'ENTER' || intent.action === 'ADD') {
        claimDelta = intent.requested_size;
      } else if (intent.action === 'EXIT') {
        claimDelta = -currentClaim; // Strategy exits entire claim, physical position may hold if other strategies remain
      } else if (intent.action === 'REDUCE') {
        claimDelta = -Math.min(currentClaim, intent.requested_size);
      }

      const nextClaim = Math.max(0, currentClaim + claimDelta);
      book.set(mint, nextClaim);
      this.virtualBooks.set(intent.strategy_id, book);

      if (claimDelta !== 0) {
        reallocations.push({
          strategy_id: intent.strategy_id,
          virtual_claim_delta: Number(claimDelta.toFixed(4)),
          resulting_claim: Number(nextClaim.toFixed(4)),
        });
      }
    }

    // Part 11: Edge Capacity Ledger Update
    const remainingCap = Math.max(0, canonical.capacity_sol - (netAction === 'ENTER' ? netSizeSol : 0));
    this.capacityLedger.set(mint, {
      mint,
      gross_market_capacity_sol: canonical.capacity_sol * 2,
      executable_capacity_sol: canonical.capacity_sol,
      allocated_capacity_sol: netAction === 'ENTER' ? netSizeSol : 0,
      reserved_capacity_sol: preventedRoundTripSol,
      remaining_capacity_sol: Number(remainingCap.toFixed(2)),
      internal_crowding: canonical.internal_crowding,
      external_crowding: canonical.external_crowding,
    });

    const resolution: ResolvedPortfolioIntent = {
      resolution_id: `res_${mint.slice(0, 6)}_${Date.now()}`,
      mint,
      canonical_opportunity_id: canonical.opportunity_id,
      net_action: netAction,
      net_size_sol: Number(netSizeSol.toFixed(4)),
      physical_execution_required: netSizeSol >= 0.05, // Only trigger on-chain transaction if net exposure exceeds threshold
      internal_reallocations: reallocations,
      prevented_round_trip_volume_sol: Number(preventedRoundTripSol.toFixed(4)),
      governing_policy_version: 'scout_v1_conservative',
      timestamp_ms: Date.now(),
    };

    this.resolutions.push(resolution);
    return resolution;
  }

  public getVirtualClaim(strategyId: string, mint: string): number {
    return this.virtualBooks.get(strategyId)?.get(mint) ?? 0;
  }

  public getCapacityEntry(mint: string): EdgeCapacityEntry | undefined {
    return this.capacityLedger.get(mint);
  }

  public getCanonicalOpportunity(mint: string): CanonicalOpportunity | undefined {
    return this.canonicalOpportunities.get(mint);
  }

  public getSummary(): {
    totalStrategiesRegistered: number;
    activeCanonicalOpportunities: number;
    totalResolutionsMade: number;
    totalPreventedRoundTripSol: number;
  } {
    const totalPrevented = this.resolutions.reduce((acc, r) => acc + r.prevented_round_trip_volume_sol, 0);
    return {
      totalStrategiesRegistered: this.strategyRegistry.size,
      activeCanonicalOpportunities: this.canonicalOpportunities.size,
      totalResolutionsMade: this.resolutions.length,
      totalPreventedRoundTripSol: Number(totalPrevented.toFixed(4)),
    };
  }
}
