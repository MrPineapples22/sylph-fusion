/**
 * SOL-SYLPH Authoritative Capital Ledger & Execution Ambiguity State Machine
 * Parts XVII & XVIII — Multi-Dimensional Exposures, Shared-Gene Exposure & Non-Ambiguous Reconciling
 */
import { NumeraireAuthority, asLamports } from '../../platform/ledger/numeraire.js';
export class AuthoritativeCapitalLedger {
    /** In-memory research projection only; never grants settlement/signing authority. */
    evidenceClass = 'RESEARCH_ONLY';
    openingCapitalLamports;
    consumedIds = new Set();
    availableCashLamports;
    reservedLamports = 0n;
    positions = new Map(); // key = mint
    pendingTxs = new Map(); // key = tx_id
    realizedPnlLamports = 0n;
    totalFeesPaidLamports = 0n;
    constructor(initialCapitalLamports = 100000000000n) {
        if (typeof initialCapitalLamports !== 'bigint' || initialCapitalLamports < 0n)
            throw new Error('INVALID_INITIAL_CAPITAL');
        this.openingCapitalLamports = initialCapitalLamports;
        this.availableCashLamports = initialCapitalLamports;
    }
    /**
     * Reserve capital before transaction signing.
     */
    reserveCapital(amountLamports) {
        if (typeof amountLamports !== 'bigint')
            return false;
        if (amountLamports <= 0n || amountLamports > this.availableCashLamports)
            return false;
        this.availableCashLamports -= amountLamports;
        this.reservedLamports += amountLamports;
        return true;
    }
    /**
     * Register pending execution in CREATED or SUBMITTED state.
     */
    registerPendingTransaction(tx) {
        const rawLamports = tx.amountLamports ?? (typeof tx.amount_sol === 'number' && Number.isFinite(tx.amount_sol) ? BigInt(Math.round(tx.amount_sol * 1e9)) : undefined);
        if (!tx.tx_id || !tx.mint || typeof rawLamports !== 'bigint' || rawLamports <= 0n)
            throw new Error('INVALID_EXACT_PENDING_AMOUNT');
        if (this.pendingTxs.has(tx.tx_id) || this.consumedIds.has(tx.tx_id))
            throw new Error('DUPLICATE_ECONOMIC_INTENT');
        const assigned = [...this.pendingTxs.values()].reduce((sum, item) => sum + (item.amountLamports ?? 0n), 0n);
        if (assigned + rawLamports > this.reservedLamports) {
            if (rawLamports <= this.availableCashLamports) {
                this.availableCashLamports -= rawLamports;
                this.reservedLamports += rawLamports;
            }
            else {
                throw new Error('RESERVATION_REQUIRED');
            }
        }
        const resolvedTx = {
            ...tx,
            amountLamports: rawLamports,
            gene_ids: Object.freeze([...tx.gene_ids]),
        };
        this.pendingTxs.set(tx.tx_id, Object.freeze(resolvedTx));
    }
    /**
     * Part XVIII: Handle execution ambiguity on timeout.
     * NEVER assume timeout = failed! Mark UNKNOWN_RECONCILING.
     */
    handleSubmissionTimeout(tx_id, current_slot) {
        const tx = this.pendingTxs.get(tx_id);
        if (!tx)
            throw new Error(`Unknown tx ${tx_id}`);
        if (current_slot <= tx.blockhash_expiration_slot) {
            // Blockhash is still valid: Do NOT send a new transaction! Either wait or resend the exact same signature.
            const updated = {
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
        // Expiry: safe to conclude unlanded and rebuild with new quote/permit if desired.
        const expired = {
            ...tx,
            state: 'EXPIRED',
            last_checked_slot: current_slot,
        };
        this.pendingTxs.set(tx_id, expired);
        const amount = tx.amountLamports ?? 0n;
        this.reservedLamports = this.reservedLamports >= amount ? this.reservedLamports - amount : 0n;
        this.availableCashLamports += amount;
        return {
            action: 'REBUILD_NEW_TX',
            tx_state: 'EXPIRED',
        };
    }
    /**
     * Confirm successful fill on chain. Convert reservation into position.
     */
    confirmFill(tx_id, executionPrice) {
        const tx = this.pendingTxs.get(tx_id);
        if (!tx)
            throw new Error(`Pending tx not found: ${tx_id}`);
        const amount = tx.amountLamports ?? 0n;
        if (this.reservedLamports < amount)
            throw new Error('RESERVATION_CONSERVATION_BREACH');
        const existing = this.positions.get(tx.mint);
        if (existing && (existing.strategy_id !== tx.strategy_id || JSON.stringify(existing.gene_ids) !== JSON.stringify(tx.gene_ids)))
            throw new Error('POSITION_ATTRIBUTION_CONFLICT');
        this.reservedLamports -= amount;
        const pos = {
            mint: tx.mint,
            strategy_id: tx.strategy_id,
            gene_ids: tx.gene_ids,
            amountLamports: amount + (existing?.amountLamports ?? 0n),
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
    auditExposures() {
        const byToken = {};
        const byStrategy = {};
        const byGene = {};
        const byCreator = {};
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
        const hiddenGeneRisk = totalExposure > 5000000000n && maxGeneExposure * 10n > totalExposure * 4n;
        const exposureByGeneSol = {};
        for (const [k, v] of Object.entries(byGene)) {
            exposureByGeneSol[k] = Number(v) / 1e9;
        }
        const exposureByTokenSol = {};
        for (const [k, v] of Object.entries(byToken)) {
            exposureByTokenSol[k] = Number(v) / 1e9;
        }
        const exposureByStrategySol = {};
        for (const [k, v] of Object.entries(byStrategy)) {
            exposureByStrategySol[k] = Number(v) / 1e9;
        }
        const exposureByCreatorSol = {};
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
//# sourceMappingURL=authoritative-ledger.js.map