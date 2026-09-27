/**
 * SOL-SYLPH Authoritative Capital Ledger & Execution Ambiguity State Machine
 * Parts XVII & XVIII — Multi-Dimensional Exposures, Shared-Gene Exposure & Non-Ambiguous Reconciling
 */

import { NumeraireAuthority, asLamports } from '../../platform/ledger/numeraire.js';

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
  /** Exact reservation; all authority quantities are base-unit lamports. */
  readonly amountLamports: bigint;
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
  readonly amountLamports: bigint;
  readonly entered_at_ms: number;
}

export interface MultiDimensionalExposureReport {
  readonly totalPortfolioExposureLamports: bigint;
  readonly availableCashLamports: bigint;
  readonly reservedCapitalLamports: bigint;
  readonly exposureByTokenLamports: Readonly<Record<string, bigint>>;
  readonly exposureByStrategyLamports: Readonly<Record<string, bigint>>;
  readonly exposureByGeneLamports: Readonly<Record<string, bigint>>;
  readonly exposureByCreatorLamports: Readonly<Record<string, bigint>>;
  readonly hidden_shared_gene_risk_detected: boolean;

  // Projections for backward compatibility
  readonly total_portfolio_exposure_sol?: number;
  readonly exposure_by_token?: Record<string, number>;
  readonly exposure_by_strategy?: Record<string, number>;
  readonly exposure_by_gene?: Record<string, number>;
  readonly exposure_by_creator?: Record<string, number>;
}

export class AuthoritativeCapitalLedger {
  /** In-memory research projection only; never grants settlement/signing authority. */
  readonly evidenceClass = 'RESEARCH_ONLY' as const;
  private readonly openingCapitalLamports: bigint;
  private readonly consumedIds = new Set<string>();
  private availableCashLamports: bigint;
  private reservedLamports = 0n;
  private readonly positions = new Map<string, PositionRecord>(); // key = mint
  private readonly pendingTxs = new Map<string, PendingTransaction>(); // key = tx_id
  private realizedPnlLamports = 0n;
  private totalFeesPaidLamports = 0n;

  constructor(initialCapitalLamports: bigint = 100_000_000_000n) {
    if (typeof initialCapitalLamports !== 'bigint' || initialCapitalLamports < 0n) throw new Error('INVALID_INITIAL_CAPITAL');
    this.openingCapitalLamports = initialCapitalLamports;
    this.availableCashLamports = initialCapitalLamports;
  }

  /**
   * Reserve capital before transaction signing.
   */
  public reserveCapital(amountLamports: bigint): boolean {
    if (typeof amountLamports !== 'bigint') return false;
    if (amountLamports <= 0n || amountLamports > this.availableCashLamports) return false;
    this.availableCashLamports -= amountLamports;
    this.reservedLamports += amountLamports;
    return true;
  }

  /**
   * Register pending execution in CREATED or SUBMITTED state.
   */
  public registerPendingTransaction(tx: PendingTransaction): void {
    if (!tx.tx_id || !tx.mint || typeof tx.amountLamports !== 'bigint' || tx.amountLamports <= 0n) throw new Error('INVALID_EXACT_PENDING_AMOUNT');
    if (this.pendingTxs.has(tx.tx_id) || this.consumedIds.has(tx.tx_id)) throw new Error('DUPLICATE_ECONOMIC_INTENT');
    const assigned = [...this.pendingTxs.values()].reduce((sum, item) => sum + item.amountLamports, 0n);
    if (assigned + tx.amountLamports > this.reservedLamports) throw new Error('RESERVATION_REQUIRED');
    this.pendingTxs.set(tx.tx_id, Object.freeze({ ...tx, gene_ids: Object.freeze([...tx.gene_ids]) }));
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

    // Expiry is not proof of non-execution. Capital remains reserved until a
    // reconciler has recorded independent negative chain evidence.
    const expired: PendingTransaction = {
      ...tx,
      state: 'EXPIRED',
      last_checked_slot: current_slot,
    };
    this.pendingTxs.set(tx_id, expired);
    return {
      action: 'WAIT_FOR_CONFIRMATION',
      tx_state: 'EXPIRED',
    };
  }

  /**
   * Confirm successful fill on chain. Convert reservation into position.
   */
  public confirmFill(tx_id: string, executionPrice?: number): PositionRecord {
    const tx = this.pendingTxs.get(tx_id);
    if (!tx) throw new Error(`Pending tx not found: ${tx_id}`);

    if (this.reservedLamports < tx.amountLamports) throw new Error('RESERVATION_CONSERVATION_BREACH');
    const existing = this.positions.get(tx.mint);
    if (existing && (existing.strategy_id !== tx.strategy_id || JSON.stringify(existing.gene_ids) !== JSON.stringify(tx.gene_ids))) throw new Error('POSITION_ATTRIBUTION_CONFLICT');
    this.reservedLamports -= tx.amountLamports;
    const pos: PositionRecord = {
      mint: tx.mint,
      strategy_id: tx.strategy_id,
      gene_ids: tx.gene_ids,
      amountLamports: tx.amountLamports + (existing?.amountLamports ?? 0n),
      entered_at_ms: Date.now(),
    };

    this.positions.set(tx.mint, Object.freeze(pos));
    this.pendingTxs.delete(tx_id);
    this.consumedIds.add(tx_id);
    return pos;
  }

  /**
   * Part XVII: Multi-Dimensional Exposure Audit.
   * Computes exposure by token, strategy, creator, and crucially by GENE.
   */
  public auditExposures(): MultiDimensionalExposureReport {
    const byToken: Record<string, bigint> = {};
    const byStrategy: Record<string, bigint> = {};
    const byGene: Record<string, bigint> = {};
    const byCreator: Record<string, bigint> = {};
    let totalExposure = 0n;

    for (const pos of this.positions.values()) {
      totalExposure += pos.amountLamports;
      byToken[pos.mint] = (byToken[pos.mint] ?? 0n) + pos.amountLamports;
      byStrategy[pos.strategy_id] = (byStrategy[pos.strategy_id] ?? 0n) + pos.amountLamports;

      if (pos.creator_address) {
        byCreator[pos.creator_address] = (byCreator[pos.creator_address] ?? 0n) + pos.amountLamports;
      }

      // Shared gene exposure detection
      for (const gid of pos.gene_ids) {
        byGene[gid] = (byGene[gid] ?? 0n) + pos.amountLamports;
      }
    }

    // Flag if any single gene controls >40% of total capital across multiple strategies
    NumeraireAuthority.assertConservation({ openingCapital: asLamports(this.openingCapitalLamports), externalDeposits: asLamports(0n), externalWithdrawals: asLamports(0n), realizedEconomicResult: asLamports(this.realizedPnlLamports - this.totalFeesPaidLamports), availableBalance: asLamports(this.availableCashLamports), reservedCapital: asLamports(this.reservedLamports), deployedInPositions: asLamports(totalExposure), pendingSettlement: asLamports(0n) });
    const maxGeneExposure = Object.values(byGene).reduce((max, amount) => amount > max ? amount : max, 0n);
    const hiddenGeneRisk = totalExposure > 5_000_000_000n && maxGeneExposure * 10n > totalExposure * 4n;

    const exposureByGeneSol: Record<string, number> = {};
    for (const [k, v] of Object.entries(byGene)) {
      exposureByGeneSol[k] = Number(v) / 1e9;
    }
    const exposureByTokenSol: Record<string, number> = {};
    for (const [k, v] of Object.entries(byToken)) {
      exposureByTokenSol[k] = Number(v) / 1e9;
    }
    const exposureByStrategySol: Record<string, number> = {};
    for (const [k, v] of Object.entries(byStrategy)) {
      exposureByStrategySol[k] = Number(v) / 1e9;
    }
    const exposureByCreatorSol: Record<string, number> = {};
    for (const [k, v] of Object.entries(byCreator)) {
      exposureByCreatorSol[k] = Number(v) / 1e9;
    }

    return {
      totalPortfolioExposureLamports: totalExposure,
      availableCashLamports: this.availableCashLamports,
      reservedCapitalLamports: this.reservedLamports,
      exposureByTokenLamports: byToken,
      exposureByStrategyLamports: byStrategy,
      exposureByGeneLamports: byGene,
      exposureByCreatorLamports: byCreator,
      hidden_shared_gene_risk_detected: hiddenGeneRisk,

      total_portfolio_exposure_sol: Number(totalExposure) / 1e9,
      exposure_by_token: exposureByTokenSol,
      exposure_by_strategy: exposureByStrategySol,
      exposure_by_gene: exposureByGeneSol,
      exposure_by_creator: exposureByCreatorSol,
    };
  }
}
