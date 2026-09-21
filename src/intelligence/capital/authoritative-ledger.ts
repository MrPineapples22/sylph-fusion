/**
 * SOL-SYLPH Authoritative Capital Ledger & Execution Ambiguity State Machine
 * Parts XVII & XVIII — Multi-Dimensional Exposures, Shared-Gene Exposure & Non-Ambiguous Reconciling
 */

export type ExecutionLifecycleState =
  | 'CREATED'
  | 'AUTHORIZED'
  | 'SIGNED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'UNKNOWN_RECONCILING'
  | 'EXPIRED';

export interface PendingTransaction {
  readonly tx_id: string;
  readonly mint: string;
  readonly strategy_id: string;
  readonly gene_ids: readonly string[];
  readonly amount_sol: number;
  readonly signed_tx_signature: string;
  readonly state: ExecutionLifecycleState;
  readonly submitted_at_slot: number;
  readonly submitted_at_ms: number;
  readonly last_checked_slot: number;
  readonly blockhash_expiration_slot: number;
}

export interface PositionRecord {
  readonly mint: string;
  readonly strategy_id: string;
  readonly gene_ids: readonly string[];
  readonly creator_address?: string;
  readonly wallet_cluster_id?: string;
  readonly amount_sol: number;
  readonly entry_price_sol: number;
  readonly current_price_sol: number;
  readonly unrealized_pnl_sol: number;
  readonly entered_at_ms: number;
}

export interface MultiDimensionalExposureReport {
  readonly total_portfolio_exposure_sol: number;
  readonly available_cash_sol: number;
  readonly reserved_capital_sol: number;
  readonly exposure_by_token: Readonly<Record<string, number>>;
  readonly exposure_by_strategy: Readonly<Record<string, number>>;
  readonly exposure_by_gene: Readonly<Record<string, number>>;
  readonly exposure_by_creator: Readonly<Record<string, number>>;
  readonly hidden_shared_gene_risk_detected: boolean;
}

export class AuthoritativeCapitalLedger {
  private availableCashSol = 100.0; // Default paper portfolio
  private reservedSol = 0.0;
  private readonly positions = new Map<string, PositionRecord>(); // key = mint
  private readonly pendingTxs = new Map<string, PendingTransaction>(); // key = tx_id
  private realizedPnlSol = 0.0;
  private totalFeesPaidSol = 0.0;

  /**
   * Reserve capital before transaction signing.
   */
  public reserveCapital(amount_sol: number): boolean {
    if (this.availableCashSol < amount_sol) return false;
    this.availableCashSol -= amount_sol;
    this.reservedSol += amount_sol;
    return true;
  }

  /**
   * Register pending execution in CREATED or SUBMITTED state.
   */
  public registerPendingTransaction(tx: PendingTransaction): void {
    this.pendingTxs.set(tx.tx_id, tx);
  }

  /**
   * Part XVIII: Handle execution ambiguity on timeout.
   * NEVER assume timeout = failed! Mark UNKNOWN_RECONCILING.
   */
  public handleSubmissionTimeout(tx_id: string, current_slot: number): {
    action: 'WAIT_FOR_CONFIRMATION' | 'RESEND_SAME_SIGNED_TX' | 'REBUILD_NEW_TX';
    tx_state: ExecutionLifecycleState;
  } {
    const tx = this.pendingTxs.get(tx_id);
    if (!tx) throw new Error(`Unknown tx ${tx_id}`);

    if (current_slot <= tx.blockhash_expiration_slot) {
      // Blockhash is still valid: Do NOT send a new transaction! Either wait or resend the exact same signature.
      const updated: PendingTransaction = {
        ...tx,
        state: 'UNKNOWN_RECONCILING',
        last_checked_slot: current_slot,
      };
      this.pendingTxs.set(tx_id, updated);
      return {
        action: 'RESEND_SAME_SIGNED_TX',
        tx_state: 'UNKNOWN_RECONCILING',
      };
    }

    // Blockhash expired: safe to conclude unlanded and rebuild with new quote/permit if desired.
    const expired: PendingTransaction = {
      ...tx,
      state: 'EXPIRED',
      last_checked_slot: current_slot,
    };
    this.pendingTxs.set(tx_id, expired);
    this.reservedSol = Math.max(0, this.reservedSol - tx.amount_sol);
    this.availableCashSol += tx.amount_sol; // release capital

    return {
      action: 'REBUILD_NEW_TX',
      tx_state: 'EXPIRED',
    };
  }

  /**
   * Confirm successful fill on chain. Convert reservation into position.
   */
  public confirmFill(tx_id: string, entry_price_sol: number): PositionRecord {
    const tx = this.pendingTxs.get(tx_id);
    if (!tx) throw new Error(`Pending tx not found: ${tx_id}`);

    this.reservedSol = Math.max(0, this.reservedSol - tx.amount_sol);
    const pos: PositionRecord = {
      mint: tx.mint,
      strategy_id: tx.strategy_id,
      gene_ids: tx.gene_ids,
      amount_sol: tx.amount_sol,
      entry_price_sol,
      current_price_sol: entry_price_sol,
      unrealized_pnl_sol: 0.0,
      entered_at_ms: Date.now(),
    };

    this.positions.set(tx.mint, pos);
    this.pendingTxs.delete(tx_id);
    return pos;
  }

  /**
   * Part XVII: Multi-Dimensional Exposure Audit.
   * Computes exposure by token, strategy, creator, and crucially by GENE.
   */
  public auditExposures(): MultiDimensionalExposureReport {
    const byToken: Record<string, number> = {};
    const byStrategy: Record<string, number> = {};
    const byGene: Record<string, number> = {};
    const byCreator: Record<string, number> = {};
    let totalExposure = 0;

    for (const pos of this.positions.values()) {
      totalExposure += pos.amount_sol;
      byToken[pos.mint] = (byToken[pos.mint] || 0) + pos.amount_sol;
      byStrategy[pos.strategy_id] = (byStrategy[pos.strategy_id] || 0) + pos.amount_sol;

      if (pos.creator_address) {
        byCreator[pos.creator_address] = (byCreator[pos.creator_address] || 0) + pos.amount_sol;
      }

      // Shared gene exposure detection
      for (const gid of pos.gene_ids) {
        byGene[gid] = (byGene[gid] || 0) + pos.amount_sol;
      }
    }

    // Flag if any single gene controls >40% of total capital across multiple strategies
    const maxGeneExposure = Math.max(0, ...Object.values(byGene));
    const hiddenGeneRisk = totalExposure > 5.0 && maxGeneExposure / totalExposure > 0.4;

    return {
      total_portfolio_exposure_sol: Number(totalExposure.toFixed(3)),
      available_cash_sol: Number(this.availableCashSol.toFixed(3)),
      reserved_capital_sol: Number(this.reservedSol.toFixed(3)),
      exposure_by_token: byToken,
      exposure_by_strategy: byStrategy,
      exposure_by_gene: byGene,
      exposure_by_creator: byCreator,
      hidden_shared_gene_risk_detected: hiddenGeneRisk,
    };
  }
}
