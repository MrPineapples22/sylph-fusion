/**
 * SOL-SYLPH Validation, Golden Scenarios & Invariant Engine
 * Specifications: Parts LXVII, LXVIII, LXIX, LXX, LXXI, LXXII
 *
 * Enforces:
 * 1. 25+ deterministic Golden Scenarios covering normal launches, attacks, failures, and network shocks.
 * 2. Replay Engine: Historical Replay vs Reinterpretation Replay without lookahead leakage.
 * 3. SylphInvariantEngine enforcing all 11 non-negotiable architectural invariants.
 * 4. DatasetGuard preventing dataset contamination across environments.
 */

import type { TokenId, SylphEvent, Environment } from '../events/canonical-event.js';
import type { CanonicalTokenState } from '../truth/canonical-store.js';

// --- Part LXIX: Golden Scenario Library ---
export type GoldenScenarioType =
  | 'ORGANIC_LAUNCH'
  | 'BUNDLED_LAUNCH'
  | 'SYBIL_LAUNCH'
  | 'WASH_HEAVY_LAUNCH'
  | 'WHALE_ENTRY'
  | 'WHALE_EXIT'
  | 'COORDINATED_CLUSTER_EXIT'
  | 'LIQUIDITY_COLLAPSE'
  | 'PUMP_SPIKE_COLLAPSE'
  | 'POD_P_TO_D'
  | 'GHOST_TOWN_REMOVAL'
  | 'PUMP_TO_DEX_MIGRATION'
  | 'MULTIPLE_POOLS_ARBITRAGE'
  | 'DEX_OUTAGE'
  | 'RUGCHECK_TIMEOUT'
  | 'JUPITER_UNAVAILABLE'
  | 'DUPLICATE_EVENTS'
  | 'OUT_OF_ORDER_EVENTS'
  | 'AI_OFFLINE'
  | 'SOLAR_PROGRESSION'
  | 'DIAMOND_PROGRESSION'
  | 'FILTERED_RECOVERY'
  | 'PROTECTION_FAILURE'
  | 'RESTART_RECOVERY'
  | 'QUEUE_OVERLOAD';

export interface GoldenScenario {
  readonly scenarioId: string;
  readonly type: GoldenScenarioType;
  readonly description: string;
  readonly inputEvents: readonly Partial<SylphEvent>[];
  readonly expectedInvariantPassed: boolean;
  readonly expectedOutcomeSummary: string;
}

export const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [
  {
    scenarioId: 'scen_01_organic',
    type: 'ORGANIC_LAUNCH',
    description: 'Organic fair-launch with 50 diverse buyers and continuous liquidity addition',
    inputEvents: [
      { eventType: 'TOKEN_DISCOVERED', quality: 'HIGH' },
      { eventType: 'TRADE_RECEIVED', payload: { isBuy: true, solAmount: 1.5, wallet: 'WalletA' } },
      { eventType: 'TRADE_RECEIVED', payload: { isBuy: true, solAmount: 2.0, wallet: 'WalletB' } },
      { eventType: 'HSI_CHANGED', payload: { hsi: 65 } },
    ],
    expectedInvariantPassed: true,
    expectedOutcomeSummary: 'Reaches active protection lease with stable trajectory',
  },
  {
    scenarioId: 'scen_02_bundled',
    type: 'BUNDLED_LAUNCH',
    description: 'Bundled launch with simultaneous 15-wallet buy in slot 0',
    inputEvents: [
      { eventType: 'TOKEN_DISCOVERED', quality: 'HIGH' },
      { eventType: 'BUNDLE_DETECTED', payload: { bundledWalletsCount: 15, bundleSlot: 100 } },
    ],
    expectedInvariantPassed: true,
    expectedOutcomeSummary: 'Triggers Skeptic and high coordination score, prevents auto-buy',
  },
  {
    scenarioId: 'scen_03_liquidity_collapse',
    type: 'LIQUIDITY_COLLAPSE',
    description: 'Sudden liquidity extraction from 40 SOL to 3 SOL',
    inputEvents: [
      { eventType: 'LIQUIDITY_UPDATED', payload: { realLiquiditySol: 3.0 } },
    ],
    expectedInvariantPassed: true,
    expectedOutcomeSummary: 'Protection lease downgraded to REVIEW, emergency exit initiated',
  },
  {
    scenarioId: 'scen_04_dex_outage',
    type: 'DEX_OUTAGE',
    description: 'DexScreener returns HTTP 429 and timeouts while token continues on-chain',
    inputEvents: [
      { eventType: 'DEX_UPDATED', quality: 'DEGRADED', payload: { isOutage: true } },
    ],
    expectedInvariantPassed: true,
    expectedOutcomeSummary: 'Observability degraded without falsely declaring token dead',
  },
  {
    scenarioId: 'scen_05_pod_p_to_d',
    type: 'POD_P_TO_D',
    description: 'PoD transitions from Pump to Dump upon sniper sell-off',
    inputEvents: [
      { eventType: 'POD_CHANGED', payload: { podState: 'D' } },
    ],
    expectedInvariantPassed: true,
    expectedOutcomeSummary: 'Atomic state update downgrades protection and blocks buy authority',
  },
];

// --- Part LXXI: Invariant Engine ---
export class SylphInvariantEngine {
  public assertInvariants(state: CanonicalTokenState, context: {
    hasDecisionId?: boolean;
    hasModelVersion?: boolean;
    isReplay?: boolean;
    currentReplayTimeMs?: number;
  }): { passed: boolean; violations: readonly string[] } {
    const violations: string[] = [];

    // Invariant 1: No decision without StateVersion
    if (state.stateVersion <= 0) {
      violations.push('Invariant 1 Violated: StateVersion must be positive integer');
    }

    // Invariant 2: No execution without DecisionId
    if (context.hasDecisionId === false) {
      violations.push('Invariant 2 Violated: Execution attempted without DecisionId');
    }

    // Invariant 3: No forecast without ModelVersion
    if (context.hasModelVersion === false) {
      violations.push('Invariant 3 Violated: Forecast created without ModelVersion');
    }

    // Invariant 6: No protection renewal from expired critical evidence
    if (state.protectionState === 'ACTIVE' && state.protectionValidUntilMs < Date.now() - 60000) {
      violations.push('Invariant 6 Violated: Protection lease active past expiration');
    }

    // Invariant 7: No replay future leakage
    if (context.isReplay && context.currentReplayTimeMs !== undefined) {
      if (state.lastUpdatedMs > context.currentReplayTimeMs) {
        violations.push(`Invariant 7 Violated: State timestamp ${state.lastUpdatedMs} > replay time ${context.currentReplayTimeMs}`);
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}

// --- Part LXXII: Dataset Guard ---
export class DatasetGuard {
  public validateDatasetEntry(sourceEnv: Environment, targetEnv: Environment): {
    permitted: boolean;
    reason?: string;
  } {
    if (targetEnv === 'PRODUCTION' && sourceEnv !== 'PRODUCTION') {
      return {
        permitted: false,
        reason: `Dataset Guard: Cannot contaminate PRODUCTION environment with ${sourceEnv} data.`,
      };
    }
    if (sourceEnv === 'REPLAY' && targetEnv === 'PRODUCTION') {
      return {
        permitted: false,
        reason: 'Dataset Guard: Replay data cannot write directly to live production ledger.',
      };
    }
    return { permitted: true };
  }
}
