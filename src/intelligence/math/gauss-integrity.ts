/**
 * GAUSS: Mathematical & Numerical Integrity Engine
 * Blueprint Engine #2
 * 
 * Enforces numerical invariants across Solana token decimals, lamports, USD/SOL conversions,
 * balances, PnL accounting, and probability bounds. Reconciles multi-source discrepancies
 * (Jupiter vs DexScreener vs on-chain RPC) without blind averaging.
 */

export interface GaussReconciliationResult {
  readonly authoritative_price_sol: number;
  readonly authoritative_price_usd: number;
  readonly discrepancy_bps: number;
  readonly consensus_confidence: number;
  readonly reconciled_sources: readonly string[];
  readonly outliers_rejected: readonly string[];
}

export interface BalanceIntegrityCheck {
  readonly is_valid: boolean;
  readonly current_balance: number;
  readonly attempted_debit: number;
  readonly post_balance: number;
  readonly violation_reason?: string;
}

export class GaussNumericalIntegrityEngine {
  public static readonly VERSION = '1.0.0';
  public static readonly LAMPORTS_PER_SOL = 1_000_000_000;
  public static readonly MAX_FEASIBLE_SUPPLY = 1_000_000_000_000_000; // 1 quadrillion
  public static readonly MAX_ACCEPTABLE_SLIPPAGE_BPS = 2500; // 25% hard sanity cap

  /**
   * Asserts that a financial floating point number is strictly finite and non-negative.
   */
  public static assertFiniteNonNegative(val: number, context: string): number {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new Error(`[GAUSS] Numerical corruption: ${context} is NaN or Infinite (${val})`);
    }
    if (val < 0) {
      throw new Error(`[GAUSS] Non-negativity violation: ${context} is negative (${val})`);
    }
    return val;
  }

  /**
   * Asserts that a value is a valid probability in [0.0, 1.0].
   */
  public static assertProbability(val: number, context: string): number {
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 1.0) {
      throw new Error(`[GAUSS] Probability domain violation: ${context} must be in [0.0, 1.0], got (${val})`);
    }
    return val;
  }

  /**
   * Safely converts SOL to lamports (integer representation).
   */
  public static solToLamports(sol: number): number {
    this.assertFiniteNonNegative(sol, 'sol_amount');
    const lamports = Math.round(sol * this.LAMPORTS_PER_SOL);
    return lamports;
  }

  /**
   * Safely converts lamports to SOL with controlled 9-decimal precision.
   */
  public static lamportsToSol(lamports: number): number {
    this.assertFiniteNonNegative(lamports, 'lamports');
    if (!Number.isInteger(lamports)) {
      throw new Error(`[GAUSS] Lamports must be an integer, got: ${lamports}`);
    }
    return Number((lamports / this.LAMPORTS_PER_SOL).toFixed(9));
  }

  /**
   * Converts raw token units to UI decimal units given token decimals (0..9).
   */
  public static rawToUiTokens(rawAmount: bigint | number, decimals: number): number {
    if (decimals < 0 || decimals > 9 || !Number.isInteger(decimals)) {
      throw new Error(`[GAUSS] Solana token decimals must be integer between 0 and 9, got: ${decimals}`);
    }
    const factor = Math.pow(10, decimals);
    const rawNum = typeof rawAmount === 'bigint' ? Number(rawAmount) : rawAmount;
    this.assertFiniteNonNegative(rawNum, 'raw_token_amount');
    return Number((rawNum / factor).toFixed(decimals));
  }

  /**
   * Verifies that a proposed balance reduction (sell or transfer) does not exceed balance.
   */
  public static verifyDebit(currentBalance: number, debitAmount: number): BalanceIntegrityCheck {
    this.assertFiniteNonNegative(currentBalance, 'current_balance');
    this.assertFiniteNonNegative(debitAmount, 'debit_amount');

    if (debitAmount > currentBalance + 1e-9) { // 1e-9 epsilon for floating rounding
      return {
        is_valid: false,
        current_balance: currentBalance,
        attempted_debit: debitAmount,
        post_balance: currentBalance - debitAmount,
        violation_reason: `Attempted debit (${debitAmount}) exceeds current balance (${currentBalance})`
      };
    }

    const postBalance = Math.max(0, currentBalance - debitAmount);
    return {
      is_valid: true,
      current_balance: currentBalance,
      attempted_debit: debitAmount,
      post_balance: postBalance
    };
  }

  /**
   * Reconciles multiple price feeds (Jupiter, DexScreener, On-Chain AMM).
   * Rejects outliers exceeding tolerance instead of naive averaging.
   */
  public static reconcilePrices(
    sources: { name: string; priceSol: number; priceUsd: number; weight: number }[],
    maxDivergenceBps: number = 800 // 8% max divergence
  ): GaussReconciliationResult {
    if (!sources || sources.length === 0) {
      throw new Error('[GAUSS] No price sources provided for reconciliation.');
    }

    const validSources = sources.filter(s => 
      Number.isFinite(s.priceSol) && s.priceSol > 0 &&
      Number.isFinite(s.priceUsd) && s.priceUsd > 0
    );

    if (validSources.length === 0) {
      throw new Error('[GAUSS] All provided price sources failed numerical validity checks.');
    }

    if (validSources.length === 1) {
      const single = validSources[0];
      return {
        authoritative_price_sol: single.priceSol,
        authoritative_price_usd: single.priceUsd,
        discrepancy_bps: 0,
        consensus_confidence: 0.85,
        reconciled_sources: [single.name],
        outliers_rejected: []
      };
    }

    // Compute median price
    const sortedSol = [...validSources].sort((a, b) => a.priceSol - b.priceSol);
    const medianSol = sortedSol[Math.floor(sortedSol.length / 2)].priceSol;

    const accepted: typeof sources = [];
    const rejected: string[] = [];

    for (const src of validSources) {
      const divergenceBps = Math.abs(src.priceSol - medianSol) / medianSol * 10000;
      if (divergenceBps <= maxDivergenceBps) {
        accepted.push(src);
      } else {
        rejected.push(src.name);
      }
    }

    if (accepted.length === 0) {
      // In extreme divergence, select highest weighted source but reduce confidence
      const highest = validSources.reduce((prev, curr) => curr.weight > prev.weight ? curr : prev);
      return {
        authoritative_price_sol: highest.priceSol,
        authoritative_price_usd: highest.priceUsd,
        discrepancy_bps: 10000,
        consensus_confidence: 0.30,
        reconciled_sources: [highest.name],
        outliers_rejected: validSources.map(s => s.name).filter(n => n !== highest.name)
      };
    }

    // Weighted average of accepted sources
    let totalWeight = 0;
    let weightedSol = 0;
    let weightedUsd = 0;

    for (const src of accepted) {
      weightedSol += src.priceSol * src.weight;
      weightedUsd += src.priceUsd * src.weight;
      totalWeight += src.weight;
    }

    const authSol = weightedSol / totalWeight;
    const authUsd = weightedUsd / totalWeight;
    
    // Max spread between accepted sources
    let maxSpreadBps = 0;
    for (const src of accepted) {
      const spread = Math.abs(src.priceSol - authSol) / authSol * 10000;
      if (spread > maxSpreadBps) maxSpreadBps = spread;
    }

    const confidence = Math.max(0.4, 1.0 - (maxSpreadBps / 10000) * 0.5 - (rejected.length * 0.15));

    return {
      authoritative_price_sol: authSol,
      authoritative_price_usd: authUsd,
      discrepancy_bps: Math.round(maxSpreadBps),
      consensus_confidence: Number(confidence.toFixed(3)),
      reconciled_sources: accepted.map(s => s.name),
      outliers_rejected: rejected
    };
  }
}
