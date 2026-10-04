/**
 * SYLPH FUSION — PROFIT COMPILER-X: ECONOMIC POSTINGS
 * Specifications: Master Blueprint Section VIII (Double-Entry Economic Model), XLVIII
 *
 * Accounts:
 * TRADING_CASH, TRADING_INVENTORY, FEE_RESERVE, EMERGENCY_EXIT_RESERVE,
 * PENDING_SETTLEMENT, REALIZED_PROFIT_PENDING_SWEEP, TREASURY_CAPITAL,
 * RECOVERY_RESERVE, NETWORK_FEE_EXPENSE, PRIORITY_FEE_EXPENSE, JITO_TIP_EXPENSE,
 * ROUTE_FEE_EXPENSE, RENT_EXPENSE, REALIZED_PNL.
 *
 * Invariant: Every finalized economic event must balance (sum of debits == sum of credits).
 */

export type CanonicalAccount =
  | 'TRADING_CASH'
  | 'TRADING_INVENTORY'
  | 'FEE_RESERVE'
  | 'EMERGENCY_EXIT_RESERVE'
  | 'PENDING_SETTLEMENT'
  | 'REALIZED_PROFIT_PENDING_SWEEP'
  | 'TREASURY_CAPITAL'
  | 'RECOVERY_RESERVE'
  | 'NETWORK_FEE_EXPENSE'
  | 'PRIORITY_FEE_EXPENSE'
  | 'JITO_TIP_EXPENSE'
  | 'ROUTE_FEE_EXPENSE'
  | 'RENT_EXPENSE'
  | 'REALIZED_PNL';

export interface EconomicPosting {
  readonly account: CanonicalAccount;
  readonly debitLamports: bigint;
  readonly creditLamports: bigint;
}

export interface EconomicPostingBatch {
  readonly batchId: string;
  readonly slot: bigint;
  readonly transactionSignature: string;
  readonly postings: readonly EconomicPosting[];
  readonly timestampMs: number;
}

export function verifyEconomicConservation(batch: EconomicPostingBatch): { isConserved: boolean; imbalanceLamports: bigint } {
  let totalDebits = 0n;
  let totalCredits = 0n;

  for (const p of batch.postings) {
    totalDebits += p.debitLamports;
    totalCredits += p.creditLamports;
  }

  const imbalance = totalDebits - totalCredits;
  return {
    isConserved: imbalance === 0n,
    imbalanceLamports: imbalance,
  };
}
