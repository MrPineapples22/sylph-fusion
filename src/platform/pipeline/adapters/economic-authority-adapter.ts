/**
 * SYLPH FUSION — ECONOMIC AUTHORITY ADAPTER
 * Specifications: Prompt 2, Prompt 14, Prompt 15, Prompt 42, Prompt 43
 *
 * Integrates EconomicAuthorityStore without replacing it or duplicating its balances.
 * Binds economic truth roots (getLastJournalHash()) into Fusion transitions:
 *   - CAPITAL_RESERVED
 *   - ECONOMIC_RECONCILED
 *   - SETTLED
 *
 * Enforces capital reservation safety:
 *   - CAPITAL_RESERVED strictly requires capitalStateRoot & capitalReservationId.
 *   - Unresolved/ambiguous outcomes preserve capital encumbrance (unknown liability).
 *   - Exact integer lamports/tokens; zero floating-point arithmetic.
 */

import type {
  EconomicAuthorityStore,
  ActiveReservation,
  LotRecord,
  SettleExitResult,
} from '../../../intelligence/capital/economic-authority-store.js';
import type { EconomicOutcome } from '../fusion-envelope.js';
import type { TransitionRequest } from '../fusion-pipeline.js';

export interface CapitalReservationTransitionParams {
  intentId: string;
  maxDebitLamports: bigint;
  expirationSlot: number;
}

export interface SettlementOpenTransitionParams {
  intentId: string;
  reservationId?: string;
  mint: string;
  tokenQtyRaw: bigint;
  principalDebitLamports: bigint;
  feeLamports: bigint;
  tipLamports: bigint;
  rentLamports: bigint;
  slot: number;
  signature: string;
}

export interface SettlementExitTransitionParams {
  intentId: string;
  mint: string;
  tokensToSellRaw: bigint;
  grossProceedsLamports: bigint;
  exitFeeLamports: bigint;
  exitTipLamports: bigint;
  slot: number;
  signature: string;
}

export class EconomicAuthorityAdapter {
  constructor(private readonly store: EconomicAuthorityStore) {}

  /**
   * Returns authoritative underlying store.
   */
  public getStore(): EconomicAuthorityStore {
    return this.store;
  }

  /**
   * Authoritative root hash from EconomicAuthorityStore journal.
   */
  public getEconomicRoot(): string {
    return this.store.getLastJournalHash();
  }

  /**
   * Acquires a cash reservation in EconomicAuthorityStore and produces
   * the exact TransitionRequest to enter CAPITAL_RESERVED in FusionPipeline.
   */
  public acquireReservationAndCreateTransition(
    params: CapitalReservationTransitionParams
  ): { reservation: ActiveReservation; transitionRequest: TransitionRequest } {
    const reservation = this.store.acquireReservation(
      params.intentId,
      params.maxDebitLamports,
      params.expirationSlot
    );

    const capitalStateRoot = this.store.getLastJournalHash();

    const transitionRequest: TransitionRequest = {
      targetState: 'CAPITAL_RESERVED',
      authority: 'RESERVE',
      envelopePatch: {
        capitalReservationId: reservation.reservationId,
        capitalStateRoot,
      },
      economicJournalRoot: capitalStateRoot,
      observedAt: new Date(reservation.acquiredAtMs).toISOString(),
    };

    return { reservation, transitionRequest };
  }

  /**
   * Settles an open buy fill in EconomicAuthorityStore and produces
   * the TransitionRequest for ECONOMIC_RECONCILED.
   */
  public settleOpenAndCreateReconciledTransition(
    params: SettlementOpenTransitionParams
  ): { lot: LotRecord; transitionRequest: TransitionRequest } {
    const lot = this.store.settleOpenFill(params);
    const economicJournalRoot = this.store.getLastJournalHash();

    const totalDebit = params.principalDebitLamports + params.feeLamports + params.tipLamports + params.rentLamports;

    const economicOutcome: EconomicOutcome = Object.freeze({
      deltaCashLamports: -totalDebit,
      deltaTokensRaw: params.tokenQtyRaw,
      mint: params.mint,
      feeLamports: params.feeLamports,
      tipLamports: params.tipLamports,
      rentLamports: params.rentLamports,
      reconciledAt: new Date().toISOString(),
      economicJournalRoot,
    });

    const transitionRequest: TransitionRequest = {
      targetState: 'ECONOMIC_RECONCILED',
      authority: 'SETTLE',
      envelopePatch: {
        economicOutcome,
      },
      economicJournalRoot,
    };

    return { lot, transitionRequest };
  }

  /**
   * Settles an exit/close trade in EconomicAuthorityStore and produces
   * the TransitionRequest for ECONOMIC_RECONCILED.
   */
  public settleExitAndCreateReconciledTransition(
    params: SettlementExitTransitionParams
  ): { exitResult: SettleExitResult; transitionRequest: TransitionRequest } {
    const exitResult = this.store.settlePartialOrFullExit(params);
    const economicJournalRoot = this.store.getLastJournalHash();

    const netCashDelta = params.grossProceedsLamports - params.exitFeeLamports - params.exitTipLamports;

    const economicOutcome: EconomicOutcome = Object.freeze({
      deltaCashLamports: netCashDelta,
      deltaTokensRaw: -params.tokensToSellRaw,
      mint: params.mint,
      feeLamports: params.exitFeeLamports,
      tipLamports: params.exitTipLamports,
      rentLamports: 0n,
      realizedProceedsLamports: exitResult.grossProceedsLamports,
      basisRelievedLamports: exitResult.basisRelievedLamports,
      realizedPnLLamports: exitResult.realizedPnLLamports,
      reconciledAt: new Date().toISOString(),
      economicJournalRoot,
    });

    const transitionRequest: TransitionRequest = {
      targetState: 'ECONOMIC_RECONCILED',
      authority: 'SETTLE',
      envelopePatch: {
        economicOutcome,
      },
      economicJournalRoot,
    };

    return { exitResult, transitionRequest };
  }
}
