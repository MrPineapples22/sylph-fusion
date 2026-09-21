/**
 * SOL-SYLPH Master Implementation Blueprint - HORIZON
 * Cross-Market Causal Spillover & External Reality Intelligence
 * Specifications: Parts 52-56.
 */

import { SpilloverEvent } from '../contracts/blueprint-contracts.js';

export type ExternalRegimeContext =
  | 'RISK_ON'
  | 'RISK_OFF'
  | 'SOL_SPECIFIC_STRENGTH'
  | 'SOL_SPECIFIC_WEAKNESS'
  | 'NETWORK_STRESS'
  | 'LIQUIDITY_EXPANSION'
  | 'LIQUIDITY_CONTRACTION'
  | 'MEME_ROTATION';

export interface ExternalMarketTelemetry {
  readonly btc_price_usd: number;
  readonly btc_1h_change_pct: number;
  readonly sol_price_usd: number;
  readonly sol_1h_change_pct: number;
  readonly solana_tps: number;
  readonly priority_fee_median_micro_lamports: number;
  readonly network_congestion_score: number; // 0 to 1.0
  readonly dex_total_liquidity_usd: number;
  readonly stablecoin_net_inflow_24h_usd: number;
}

export interface HorizonContextSnapshot {
  readonly primary_regime: ExternalRegimeContext;
  readonly regime_confidence: number;
  readonly macro_liquidity_state: 'EXPANDING' | 'NEUTRAL' | 'CONTRACTING';
  readonly network_stress_level: 'NOMINAL' | 'ELEVATED' | 'SEVERE';
  readonly active_spillovers: readonly SpilloverEvent[];
  readonly causal_transmission_chain: string;
  readonly timestamp_ms: number;
}

export class HorizonExternalContext {
  private currentRegime: ExternalRegimeContext = 'RISK_ON';
  private activeSpillovers: SpilloverEvent[] = [];

  /**
   * Part 52 & 55: Evaluate Macro Context & Causal Spillover
   */
  public evaluateContext(telemetry: ExternalMarketTelemetry, slot: number): HorizonContextSnapshot {
    const now = Date.now();
    let regime: ExternalRegimeContext = 'RISK_ON';
    let confidence = 0.8;

    // Detect macro stress and divergence
    if (telemetry.network_congestion_score > 0.75 || telemetry.priority_fee_median_micro_lamports > 500000) {
      regime = 'NETWORK_STRESS';
      confidence = 0.9;
    } else if (telemetry.btc_1h_change_pct < -3.0 && telemetry.sol_1h_change_pct < -4.0) {
      regime = 'RISK_OFF';
      confidence = 0.85;
    } else if (telemetry.sol_1h_change_pct > 2.0 && telemetry.btc_1h_change_pct < 0.5) {
      regime = 'SOL_SPECIFIC_STRENGTH';
      confidence = 0.8;
    } else if (telemetry.stablecoin_net_inflow_24h_usd > 10_000_000) {
      regime = 'LIQUIDITY_EXPANSION';
      confidence = 0.75;
    } else if (telemetry.stablecoin_net_inflow_24h_usd < -10_000_000) {
      regime = 'LIQUIDITY_CONTRACTION';
      confidence = 0.8;
    }

    this.currentRegime = regime;

    // Part 54: Emit Spillover Event if macro shock occurs
    if (regime === 'RISK_OFF' || regime === 'NETWORK_STRESS' || regime === 'LIQUIDITY_CONTRACTION') {
      const spEvent: SpilloverEvent = {
        event_id: `spill_${slot}_${now}`,
        source_market: regime === 'NETWORK_STRESS' ? 'SOLANA_MACRO' : 'BITCOIN',
        target_scope: 'MEME_ECOSYSTEM',
        start_time: now,
        as_of_slot: slot,
        observations: [
          `BTC 1h change: ${telemetry.btc_1h_change_pct.toFixed(1)}%`,
          `SOL 1h change: ${telemetry.sol_1h_change_pct.toFixed(1)}%`,
          `Priority fees: ${telemetry.priority_fee_median_micro_lamports} µ-lamports`,
        ],
        possible_causes: [
          'Global crypto liquidity derisking',
          'Blockspace priority bidding wars',
        ],
        possible_transmission_paths: [
          'BTC sell-off -> SOL validator exit -> DEX pool depth depletion -> bonding curve panic',
        ],
        affected_themes: ['high_beta_meme', 'early_bonding_curve'],
        affected_tokens: ['ALL_ACTIVE_MEMES'],
        affected_positions: ['PAPER_PORTFOLIO_LONG'],
        confidence: Number(confidence.toFixed(2)),
        uncertainty: 0.15,
        state_version: `horizon_v${slot}`,
      };

      this.activeSpillovers.unshift(spEvent);
      if (this.activeSpillovers.length > 20) this.activeSpillovers.pop();
    }

    // Part 56: Connect HORIZON to NEXUS
    const causalChain =
      regime === 'NETWORK_STRESS'
        ? 'High network congestion -> transaction landing failure risk -> wider execution slippage bounds.'
        : regime === 'RISK_OFF'
        ? 'Macro BTC drawdown -> SOL weakness -> DEX pool liquidity contraction -> meme exit depth deterioration.'
        : 'Nominal macro liquidity -> organic capital circulating freely across Solana DEX venues.';

    return {
      primary_regime: this.currentRegime,
      regime_confidence: Number(confidence.toFixed(2)),
      macro_liquidity_state:
        telemetry.stablecoin_net_inflow_24h_usd > 5_000_000
          ? 'EXPANDING'
          : telemetry.stablecoin_net_inflow_24h_usd < -5_000_000
          ? 'CONTRACTING'
          : 'NEUTRAL',
      network_stress_level:
        telemetry.network_congestion_score > 0.75
          ? 'SEVERE'
          : telemetry.network_congestion_score > 0.4
          ? 'ELEVATED'
          : 'NOMINAL',
      active_spillovers: [...this.activeSpillovers],
      causal_transmission_chain: causalChain,
      timestamp_ms: now,
    };
  }

  public getActiveSpillovers(): readonly SpilloverEvent[] {
    return this.activeSpillovers;
  }
}
