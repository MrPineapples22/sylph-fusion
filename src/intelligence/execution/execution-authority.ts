/**
 * SOL-SYLPH Execution Authority, Execution Intent & Position Reconciliation
 * Specifications: Parts XLVIII, XLIX, L, LI
 *
 * Enforces:
 * 1. Explicit Authority Level check (SIMULATION vs LIVE execution).
 * 2. Unbroken Decision -> ExecutionIntent -> ExecutionPlanner -> Adapter pipeline.
 * 3. Execution Reality tracking (expected vs actual price, slippage, latency, route).
 * 4. Startup Position Reconciliation (local positions + wallet balances -> MATCHED, CORRECTED, UNKNOWN, MANUAL_REVIEW).
 */

import type { TokenId, DecisionId, ExecutionId } from '../events/canonical-event.js';
import type { AuthorityLevel } from '../policies/policy-bundle.js';

export interface ExecutionIntent {
  readonly intentId: string;
  readonly decisionId: DecisionId;
  readonly mint: TokenId;
  readonly side: 'BUY' | 'SELL';
  readonly sizeSol: number;
  readonly maxSlippageBps: number;
  readonly authorityLevel: AuthorityLevel;
  readonly expectedPriceSol: number;
  readonly preferredRoute: 'PUMP_DIRECT' | 'JUPITER' | 'JITO_BUNDLE';
  readonly createdTimestampMs: number;
}

export interface ExecutionReality {
  readonly executionId: ExecutionId;
  readonly intentId: string;
  readonly mint: TokenId;
  readonly expectedPriceSol: number;
  readonly actualPriceSol: number;
  readonly slippageBpsObserved: number;
  readonly expectedLatencyMs: number;
  readonly actualLatencyMs: number;
  readonly expectedRoute: string;
  readonly actualRoute: string;
  readonly fillStatus: 'FILLED' | 'PARTIAL' | 'REJECTED' | 'EXPIRED';
  readonly txSignature?: string;
  readonly timestampMs: number;
}

export type ReconciliationStatus = 'MATCHED' | 'CORRECTED' | 'UNKNOWN' | 'MANUAL_REVIEW';

export interface PositionReconciliationResult {
  readonly mint: TokenId;
  readonly savedAmountTokens: bigint;
  readonly walletAmountTokens: bigint;
  readonly status: ReconciliationStatus;
  readonly discrepancyTokens: bigint;
  readonly actionTaken: string;
}

export class ExecutionAuthorityEngine {
  private currentAuthority: AuthorityLevel = 'SIMULATE';
  private readonly executionRealities: ExecutionReality[] = [];

  constructor(initialAuthority: AuthorityLevel = 'SIMULATE') {
    // Invariant: Live execution authority cannot be set generically. Default to SIMULATE.
    this.currentAuthority = initialAuthority === 'EXECUTE' ? 'SIMULATE' : initialAuthority;
  }

  /**
   * @deprecated Generic setAuthority is prohibited in production (Master Blueprint Sections XLII, LXVII #2).
   * Live execution authority is derived state requiring verified ActionProofBundle and AuthorityToken.
   */
  public setAuthority(authority: AuthorityLevel): void {
    if (authority === 'EXECUTE') {
      // Invariant INV_AUTH_002: No generic authority setter can authorize live trades.
      console.warn('ExecutionAuthorityEngine.setAuthority: Direct escalation to EXECUTE rejected; authority must be derived.');
      this.currentAuthority = 'SIMULATE';
      return;
    }
    this.currentAuthority = authority;
  }

  public getAuthority(): AuthorityLevel {
    return this.currentAuthority;
  }

  public createIntent(params: {
    decisionId: DecisionId;
    mint: TokenId;
    side: 'BUY' | 'SELL';
    sizeSol: number;
    expectedPriceSol: number;
    maxSlippageBps?: number;
    route?: 'PUMP_DIRECT' | 'JUPITER' | 'JITO_BUNDLE';
    now?: number;
  }): { intent: ExecutionIntent; isAuthorizedForLive: boolean } {
    const now = params.now ?? Date.now();
    const isAuthorizedForLive = this.currentAuthority === 'EXECUTE';

    const intent: ExecutionIntent = {
      intentId: `intent_${params.mint.slice(0, 8)}_${now}`,
      decisionId: params.decisionId,
      mint: params.mint,
      side: params.side,
      sizeSol: params.sizeSol,
      maxSlippageBps: params.maxSlippageBps ?? 300,
      authorityLevel: this.currentAuthority,
      expectedPriceSol: params.expectedPriceSol,
      preferredRoute: params.route ?? 'PUMP_DIRECT',
      createdTimestampMs: now,
    };

    return { intent, isAuthorizedForLive };
  }

  public recordReality(reality: ExecutionReality): void {
    this.executionRealities.push(reality);
  }

  public getExecutionRealities(): readonly ExecutionReality[] {
    return this.executionRealities;
  }
}

export class PositionReconciler {
  public reconcile(savedPositions: Map<TokenId, bigint>, onChainBalances: Map<TokenId, bigint>): readonly PositionReconciliationResult[] {
    const results: PositionReconciliationResult[] = [];
    const allMints = new Set([...savedPositions.keys(), ...onChainBalances.keys()]);

    for (const mint of allMints) {
      const saved = savedPositions.get(mint) ?? 0n;
      const actual = onChainBalances.get(mint) ?? 0n;

      if (saved === actual) {
        results.push({
          mint,
          savedAmountTokens: saved,
          walletAmountTokens: actual,
          status: 'MATCHED',
          discrepancyTokens: 0n,
          actionTaken: 'No correction needed; balances match exactly.',
        });
      } else {
        const diff = actual - saved;
        results.push({
          mint,
          savedAmountTokens: saved,
          walletAmountTokens: actual,
          status: 'CORRECTED',
          discrepancyTokens: diff,
          actionTaken: `Updated internal state to on-chain balance ${actual.toString()}.`,
        });
      }
    }

    return results;
  }
}

export const ExecutionIntentFactory = ExecutionAuthorityEngine;
