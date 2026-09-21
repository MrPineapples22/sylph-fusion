/**
 * SOL-SYLPH World State, Multi-Horizon Forecasting & Uncertainty Engine
 * Specifications: Parts XXXVII, XXXVIII, XXXIX, XL, XLI, XLII, XLIII
 *
 * Enforces:
 * 1. Global SylphWorldState combining tokens, market state, observability, and portfolio.
 * 2. Multi-horizon state transitions (5s, 15s, 30s, 1m, 5m, 15m) without guaranteed price claims.
 * 3. Explicit forecast invalidation conditions.
 * 4. Separation of Data, Source, Temporal, Model, and Decision uncertainty (DECIDED, PROVISIONAL, DEGRADED, ABSTAIN).
 * 5. Cloned-state counterfactual simulations.
 */

import type { TokenId, ForecastId } from '../events/canonical-event.js';
import type { CanonicalTokenState, TrajectoryState } from '../truth/canonical-store.js';
import type { SylphMarketState } from '../context/market-state.js';

export type ForecastHorizon = '5s' | '15s' | '30s' | '1m' | '5m' | '15m';

export interface StateForecast {
  readonly forecastId: ForecastId;
  readonly mint: TokenId;
  readonly generatedAtMs: number;
  readonly horizon: ForecastHorizon;
  readonly currentTrajectory: TrajectoryState;
  readonly candidateNextStates: readonly {
    readonly state: TrajectoryState;
    readonly probability: number;
  }[];
  readonly calibratedConfidence: number; // 0.0 to 1.0
  readonly uncertainty: number; // 0.0 to 1.0
  readonly invalidationConditions: readonly string[];
  readonly modelVersion: string;
  readonly regime: string;
}

export interface UncertaintyProfile {
  readonly dataUncertainty: number; // missingness, staleness
  readonly sourceUncertainty: number; // 429s, API latency
  readonly temporalUncertainty: number; // high event variance
  readonly modelUncertainty: number; // out-of-distribution distance
  readonly overallUncertainty: number;
  readonly decisionState: 'DECIDED' | 'PROVISIONAL' | 'DEGRADED' | 'ABSTAIN';
}

export interface SylphWorldState {
  readonly marketState: SylphMarketState;
  readonly tokenStates: ReadonlyMap<TokenId, CanonicalTokenState>;
  readonly activeForecasts: ReadonlyMap<TokenId, readonly StateForecast[]>;
  readonly uncertaintyProfiles: ReadonlyMap<TokenId, UncertaintyProfile>;
  readonly timestampMs: number;
}

export class WorldModelEngineV2 {
  public generateForecast(
    token: CanonicalTokenState,
    market: SylphMarketState,
    horizon: ForecastHorizon = '1m',
    now: number = Date.now()
  ): StateForecast {
    let nextStates: { state: TrajectoryState; probability: number }[];
    let invalidation: string[] = [];

    if (token.hsi > 55 && token.pumpScore > 50 && token.podState === 'P') {
      nextStates = [
        { state: 'IMPROVING', probability: 0.65 },
        { state: 'STABLE', probability: 0.25 },
        { state: 'WEAKENING', probability: 0.10 },
      ];
      invalidation = [
        'Real liquidity falls below 20 SOL',
        'PoD transitions from P to D',
        'Sybil coordination score exceeds 0.70',
        'Market regime deteriorates to CHOPPY or LOW_LIQ',
      ];
    } else if (token.podState === 'D' || token.hsi < 30) {
      nextStates = [
        { state: 'WEAKENING', probability: 0.75 },
        { state: 'VOLATILE', probability: 0.20 },
        { state: 'STABLE', probability: 0.05 },
      ];
      invalidation = ['Large organic buy inflow exceeding 25 SOL', 'PoD recovers to P'];
    } else {
      nextStates = [
        { state: 'STABLE', probability: 0.50 },
        { state: 'VOLATILE', probability: 0.30 },
        { state: 'WEAKENING', probability: 0.20 },
      ];
      invalidation = ['Any sudden liquidity shift > 10 SOL', 'Creator sell event'];
    }

    const confidence = Math.max(0.2, Math.min(0.95, (token.hsi / 100) * 0.8 + 0.15));

    return {
      forecastId: `fc_${token.mint.slice(0, 8)}_${horizon}_${now}`,
      mint: token.mint,
      generatedAtMs: now,
      horizon,
      currentTrajectory: token.trajectory,
      candidateNextStates: nextStates,
      calibratedConfidence: confidence,
      uncertainty: 1.0 - confidence,
      invalidationConditions: invalidation,
      modelVersion: 'v4.0.0-institutional',
      regime: market.marketRegime,
    };
  }

  public computeUncertainty(token: CanonicalTokenState, sourceReliability: number = 0.9): UncertaintyProfile {
    const dataUncertainty = token.rugCheckScore > 50 ? 0.60 : 0.15;
    const sourceUncertainty = 1.0 - sourceReliability;
    const temporalUncertainty = token.trajectory === 'VOLATILE' ? 0.50 : 0.20;
    const modelUncertainty = 0.25;

    const overallUncertainty =
      dataUncertainty * 0.35 + sourceUncertainty * 0.25 + temporalUncertainty * 0.20 + modelUncertainty * 0.20;

    let decisionState: UncertaintyProfile['decisionState'] = 'DECIDED';
    if (overallUncertainty > 0.65) {
      decisionState = 'ABSTAIN';
    } else if (overallUncertainty > 0.45) {
      decisionState = 'DEGRADED';
    } else if (overallUncertainty > 0.30) {
      decisionState = 'PROVISIONAL';
    }

    return {
      dataUncertainty,
      sourceUncertainty,
      temporalUncertainty,
      modelUncertainty,
      overallUncertainty,
      decisionState,
    };
  }

  /**
   * Part XLI: Cloned-state counterfactual simulation.
   * Tests "What if liquidity falls by X?" or "What if PoD becomes D?" without modifying production state.
   */
  public runCounterfactual(
    token: CanonicalTokenState,
    scenario: {
      liquidityMultiplier?: number;
      simulatePodDump?: boolean;
    }
  ): CanonicalTokenState {
    const cloned: CanonicalTokenState = { ...token };
    if (scenario.liquidityMultiplier !== undefined) {
      const newLiq = cloned.realLiquiditySol * scenario.liquidityMultiplier;
      const newHsi = Math.max(0, cloned.hsi * scenario.liquidityMultiplier);
      return {
        ...cloned,
        realLiquiditySol: newLiq,
        hsi: newHsi,
        trajectory: newHsi < 30 ? 'WEAKENING' : cloned.trajectory,
        protectionState: newHsi < 25 ? 'REVIEW' : cloned.protectionState,
      };
    }
    if (scenario.simulatePodDump) {
      return {
        ...cloned,
        podState: 'D',
        trajectory: 'WEAKENING',
        protectionState: 'REVIEW',
      };
    }
    return cloned;
  }
}
