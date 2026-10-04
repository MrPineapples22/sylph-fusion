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
export class EconomicAuthorityAdapter {
    store;
    constructor(store) {
        this.store = store;
    }
    /**
     * Returns authoritative underlying store.
     */
    getStore() {
        return this.store;
    }
    /**
     * Authoritative root hash from EconomicAuthorityStore journal.
     */
    getEconomicRoot() {
        return this.store.getLastJournalHash();
    }
    /**
     * Acquires a cash reservation in EconomicAuthorityStore and produces
     * the exact TransitionRequest to enter CAPITAL_RESERVED in FusionPipeline.
     */
    acquireReservationAndCreateTransition(params) {
        const reservation = this.store.acquireReservation(params.intentId, params.maxDebitLamports, params.expirationSlot);
        const capitalStateRoot = this.store.getLastJournalHash();
        const transitionRequest = {
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
    settleOpenAndCreateReconciledTransition(params) {
        const lot = this.store.settleOpenFill(params);
        const economicJournalRoot = this.store.getLastJournalHash();
        const totalDebit = params.principalDebitLamports + params.feeLamports + params.tipLamports + params.rentLamports;
        const economicOutcome = Object.freeze({
            deltaCashLamports: -totalDebit,
            deltaTokensRaw: params.tokenQtyRaw,
            mint: params.mint,
            feeLamports: params.feeLamports,
            tipLamports: params.tipLamports,
            rentLamports: params.rentLamports,
            reconciledAt: new Date().toISOString(),
            economicJournalRoot,
        });
        const transitionRequest = {
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
    settleExitAndCreateReconciledTransition(params) {
        const exitResult = this.store.settlePartialOrFullExit(params);
        const economicJournalRoot = this.store.getLastJournalHash();
        const netCashDelta = params.grossProceedsLamports - params.exitFeeLamports - params.exitTipLamports;
        const economicOutcome = Object.freeze({
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
        const transitionRequest = {
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
//# sourceMappingURL=economic-authority-adapter.js.map