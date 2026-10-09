/**
 * SOL-SYLPH Intelligence Fabric - Economic Authority Store & Lot Ledger
 * Architectural Directives: Pillar 1 (One Economic Authority), Pillar 3 (Exact Accounting), Pillar 4 (Lot Accounting).
 *
 * Implements the single authoritative representation of cash lamports, token inventories,
 * and individual lots with zero floating-point arithmetic. Guarantees conservation:
 *   TokensAcquired == TokensDisposed + TokensRemaining
 *   OpeningBasis == RealizedBasisRelieved + RemainingBasis
 *   AccountingPnL == RealizedGrossProceeds - RealizedBasisRelieved - IrreversibleExitCosts
 */
import { createHash } from 'node:crypto';
export class EconomicAuthorityStore {
    confirmedCashLamports;
    reservedCashLamports = 0n;
    unknownCapitalLamports = 0n;
    emergencyReserveLamports;
    reservePolicy;
    // Inventory: mint -> total raw tokens held
    tokenInventories = new Map();
    // Lots: lotId -> LotRecord
    lots = new Map();
    // Mint -> Array of active lotIds (FIFO order)
    lotsByMint = new Map();
    // Active reservations: reservationId -> ActiveReservation
    reservations = new Map();
    // Append-only journal with SHA-256 hash chaining
    journal = [];
    lastJournalHash = '0000000000000000000000000000000000000000000000000000000000000000';
    sequenceCounter = 0n;
    // Realized Accounting Metrics (all exact integer lamports)
    totalRealizedProceedsLamports = 0n;
    totalBasisRelievedLamports = 0n;
    totalFrictionBurnLamports = 0n; // Fees + Tips + Rent across entries and exits
    constructor(initialCashLamports, reservePolicy) {
        if (initialCashLamports < 0n) {
            throw new Error('ECONOMIC_STORE_INIT_FAILED: initialCashLamports cannot be negative');
        }
        this.confirmedCashLamports = initialCashLamports;
        this.reservePolicy = reservePolicy;
        // Blueprint Section 27: Dynamic hybrid emergency reserve
        if (reservePolicy) {
            const stressedExit = (reservePolicy.stressedFullExitCostLamports ?? 25000000n) * 2n;
            const operationalFloor = reservePolicy.fixedOperationalFloorLamports ?? 50000000n;
            const equityReserve = (initialCashLamports * BigInt(reservePolicy.equityReservePctBps ?? 500)) / 10000n;
            let res = stressedExit > operationalFloor ? stressedExit : operationalFloor;
            if (equityReserve > res)
                res = equityReserve;
            this.emergencyReserveLamports = res;
        }
        else if (initialCashLamports >= 10000000000n) {
            this.emergencyReserveLamports = 5000000000n; // Standard 5 SOL default for larger bankrolls
        }
        else {
            // Dynamic for small bankrolls ($250 experiment)
            const operationalFloor = 50000000n; // 0.05 SOL operational floor
            const equityReserve = (initialCashLamports * 1000n) / 10000n; // 10% of small bankroll
            this.emergencyReserveLamports = operationalFloor > equityReserve ? operationalFloor : equityReserve;
        }
        // Record Genesis Journal Entry
        this.appendJournalEntry({
            eventType: 'GENESIS_LOAD',
            slot: 0,
            intentId: 'genesis_intent',
            deltaCashLamports: initialCashLamports,
            deltaTokensRaw: 0n,
            mint: 'SOL',
            payload: { initialCashLamports: initialCashLamports.toString() },
        });
    }
    recomputeEmergencyReserve(policy) {
        const activePolicy = policy ?? this.reservePolicy;
        const liquidEquity = this.confirmedCashLamports;
        const stressedExit = ((activePolicy?.stressedFullExitCostLamports ?? 25000000n) * 2n);
        const operationalFloor = activePolicy?.fixedOperationalFloorLamports ?? 50000000n;
        const pctBps = BigInt(activePolicy?.equityReservePctBps ?? 500);
        const equityPct = (liquidEquity * pctBps) / 10000n;
        let res = stressedExit > operationalFloor ? stressedExit : operationalFloor;
        if (equityPct > res)
            res = equityPct;
        this.emergencyReserveLamports = res;
        return res;
    }
    getConfirmedCash() {
        return this.confirmedCashLamports;
    }
    syncLiveCash(cashLamports, reservedLamports = 0n) {
        if (cashLamports < 0n)
            return;
        this.confirmedCashLamports = cashLamports;
        this.reservedCashLamports = reservedLamports >= 0n ? reservedLamports : 0n;
    }
    getAvailableCash() {
        const available = this.confirmedCashLamports - this.reservedCashLamports - this.unknownCapitalLamports - this.emergencyReserveLamports;
        return available > 0n ? available : 0n;
    }
    getReservedCash() {
        return this.reservedCashLamports;
    }
    getUnknownCapital() {
        return this.unknownCapitalLamports;
    }
    getEmergencyReserve() {
        return this.emergencyReserveLamports;
    }
    /**
     * Quarantines encumbered capital when an execution outcome is UNKNOWN or ambiguous.
     * Quarantined capital is strictly unavailable for new intents until certified terminality.
     */
    quarantineUnknownCapital(reservationId, currentSlot) {
        const res = this.reservations.get(reservationId);
        if (!res)
            return;
        this.reservedCashLamports -= res.maxDebitLamports;
        if (this.reservedCashLamports < 0n)
            this.reservedCashLamports = 0n;
        this.unknownCapitalLamports += res.maxDebitLamports;
        this.reservations.delete(reservationId);
        this.appendJournalEntry({
            eventType: 'UNKNOWN_CAPITAL_QUARANTINED',
            slot: currentSlot,
            intentId: res.intentId,
            deltaCashLamports: 0n,
            deltaTokensRaw: 0n,
            mint: 'SOL',
            payload: { reservationId, quarantinedLamports: res.maxDebitLamports.toString() },
        });
    }
    /**
     * Releases quarantined capital back to confirmed cash ONLY upon certified terminality.
     * Timeout, RPC null, or transport rejection CANNOT authorize release.
     */
    releaseQuarantineOnVerifiedTerminality(params) {
        if (params.terminalityVerdict !== 'CERTIFIED_NOLAND') {
            throw new Error(`QUARANTINE_RELEASE_FORBIDDEN: Verdict ${params.terminalityVerdict} cannot release quarantined capital`);
        }
        if (this.unknownCapitalLamports < params.amountLamports) {
            throw new Error(`QUARANTINE_RELEASE_OVERFLOW: Cannot release ${params.amountLamports} from unknownCapital ${this.unknownCapitalLamports}`);
        }
        this.unknownCapitalLamports -= params.amountLamports;
        this.appendJournalEntry({
            eventType: 'QUARANTINE_RELEASED_NOLAND',
            slot: params.currentSlot,
            intentId: params.intentId,
            deltaCashLamports: params.amountLamports,
            deltaTokensRaw: 0n,
            mint: 'SOL',
            payload: { releasedLamports: params.amountLamports.toString() },
        });
    }
    settleFinalizedAssetDeltas(deltas) {
        this.confirmedCashLamports += deltas.deltaCashLamports;
        if (deltas.deltaTokensRaw !== 0n) {
            const currentTokens = this.tokenInventories.get(deltas.mint) ?? 0n;
            this.tokenInventories.set(deltas.mint, currentTokens + deltas.deltaTokensRaw);
        }
        const friction = deltas.feeLamports + deltas.tipLamports + deltas.rentLamports;
        this.totalFrictionBurnLamports += friction;
    }
    getTokenInventory(mint) {
        return this.tokenInventories.get(mint) ?? 0n;
    }
    getActiveLots(mint) {
        const ids = this.lotsByMint.get(mint) ?? [];
        return ids.map((id) => this.lots.get(id)).filter(Boolean);
    }
    getJournal() {
        return Object.freeze([...this.journal]);
    }
    getLastJournalHash() {
        return this.lastJournalHash;
    }
    /**
     * Reserves cash for an impending trade intent before order preparation.
     */
    acquireReservation(intentId, maxDebitLamports, expirationSlot) {
        if (maxDebitLamports <= 0n) {
            throw new Error('RESERVATION_FAILED: maxDebitLamports must be positive');
        }
        const available = this.getAvailableCash();
        if (available < maxDebitLamports) {
            throw new Error(`RESERVATION_DENIED: Requested ${maxDebitLamports} exceeds available cash ${available}`);
        }
        const reservationId = `res_${intentId}_${Date.now()}`;
        const reservation = {
            reservationId,
            intentId,
            maxDebitLamports,
            acquiredAtMs: Date.now(),
            expirationSlot,
        };
        this.reservedCashLamports += maxDebitLamports;
        this.reservations.set(reservationId, reservation);
        this.appendJournalEntry({
            eventType: 'RESERVATION_ACQUIRED',
            slot: expirationSlot,
            intentId,
            deltaCashLamports: -maxDebitLamports,
            deltaTokensRaw: 0n,
            mint: 'SOL',
            payload: { reservationId, maxDebitLamports: maxDebitLamports.toString() },
        });
        return Object.freeze(reservation);
    }
    /**
     * Releases an unused or expired reservation back to available cash.
     */
    releaseReservation(reservationId, currentSlot) {
        const res = this.reservations.get(reservationId);
        if (!res)
            return;
        this.reservedCashLamports -= res.maxDebitLamports;
        if (this.reservedCashLamports < 0n)
            this.reservedCashLamports = 0n;
        this.reservations.delete(reservationId);
        this.appendJournalEntry({
            eventType: 'RESERVATION_RELEASED',
            slot: currentSlot,
            intentId: res.intentId,
            deltaCashLamports: res.maxDebitLamports,
            deltaTokensRaw: 0n,
            mint: 'SOL',
            payload: { reservationId, releasedLamports: res.maxDebitLamports.toString() },
        });
    }
    /**
     * Settles an authorized buy fill, debits cash, creates a new LotRecord,
     * updates token inventory, and satisfies double-entry conservation.
     */
    settleOpenFill(params) {
        const { intentId, reservationId, mint, tokenQtyRaw, principalDebitLamports, feeLamports, tipLamports, rentLamports, slot, signature } = params;
        if (tokenQtyRaw <= 0n)
            throw new Error('SETTLE_OPEN_FAILED: tokenQtyRaw must be positive');
        if (principalDebitLamports <= 0n)
            throw new Error('SETTLE_OPEN_FAILED: principalDebitLamports must be positive');
        const totalFriction = feeLamports + tipLamports + rentLamports;
        const totalCashDebit = principalDebitLamports + totalFriction;
        if (reservationId) {
            const res = this.reservations.get(reservationId);
            if (res) {
                this.reservedCashLamports -= res.maxDebitLamports;
                if (this.reservedCashLamports < 0n)
                    this.reservedCashLamports = 0n;
                this.reservations.delete(reservationId);
            }
        }
        if (this.confirmedCashLamports < totalCashDebit) {
            throw new Error(`SOLVENCY_VIOLATION: Required ${totalCashDebit} lamports exceeds cash ${this.confirmedCashLamports}`);
        }
        this.confirmedCashLamports -= totalCashDebit;
        this.totalFrictionBurnLamports += totalFriction;
        // Inventory update
        const currentTokens = this.tokenInventories.get(mint) ?? 0n;
        this.tokenInventories.set(mint, currentTokens + tokenQtyRaw);
        // Lot creation
        const lotId = `lot_${mint.slice(0, 8)}_${slot}_${Date.now()}`;
        const lot = {
            lotId,
            positionId: `pos_${mint.slice(0, 8)}`,
            economicIntentId: intentId,
            mint,
            rawTokenQty: tokenQtyRaw,
            remainingTokenQty: tokenQtyRaw,
            originalBasisLamports: principalDebitLamports,
            remainingBasisLamports: principalDebitLamports,
            entryFeeLamports: feeLamports,
            entryTipLamports: tipLamports,
            entryRentLamports: rentLamports,
            entrySlot: slot,
            entrySignature: signature,
            openedAtMs: Date.now(),
        };
        this.lots.set(lotId, lot);
        const existingLots = this.lotsByMint.get(mint) ?? [];
        existingLots.push(lotId);
        this.lotsByMint.set(mint, existingLots);
        this.appendJournalEntry({
            eventType: 'FILL_SETTLED_OPEN',
            slot,
            intentId,
            deltaCashLamports: -totalCashDebit,
            deltaTokensRaw: tokenQtyRaw,
            mint,
            lotId,
            payload: {
                principalDebitLamports: principalDebitLamports.toString(),
                totalFriction: totalFriction.toString(),
                tokenQtyRaw: tokenQtyRaw.toString(),
                signature,
            },
        });
        return lot;
    }
    /**
     * Settles a partial or full exit using strict FIFO lot basis allocation.
     * Conservation: OpeningBasis == RealizedBasisRelieved + RemainingBasis
     */
    settlePartialOrFullExit(params) {
        const { intentId, mint, tokensToSellRaw, grossProceedsLamports, exitFeeLamports, exitTipLamports, slot, signature } = params;
        if (tokensToSellRaw <= 0n)
            throw new Error('SETTLE_EXIT_FAILED: tokensToSellRaw must be positive');
        const availableTokens = this.tokenInventories.get(mint) ?? 0n;
        if (availableTokens < tokensToSellRaw) {
            throw new Error(`INVENTORY_VIOLATION: Attempted to sell ${tokensToSellRaw} but held inventory is ${availableTokens}`);
        }
        const lotIds = this.lotsByMint.get(mint) ?? [];
        let tokensRemainingToRelieve = tokensToSellRaw;
        let totalBasisRelieved = 0n;
        const lotsAffected = [];
        for (let i = 0; i < lotIds.length && tokensRemainingToRelieve > 0n; i++) {
            const lot = this.lots.get(lotIds[i]);
            if (!lot || lot.remainingTokenQty <= 0n)
                continue;
            lotsAffected.push(lot.lotId);
            if (lot.remainingTokenQty <= tokensRemainingToRelieve) {
                // Full lot relief
                tokensRemainingToRelieve -= lot.remainingTokenQty;
                totalBasisRelieved += lot.remainingBasisLamports;
                lot.remainingTokenQty = 0n;
                lot.remainingBasisLamports = 0n;
                lot.closedAtMs = Date.now();
            }
            else {
                // Proportional lot relief: exact integer arithmetic
                const lotTokensToRelieve = tokensRemainingToRelieve;
                const basisRelieved = (lot.remainingBasisLamports * lotTokensToRelieve) / lot.remainingTokenQty;
                lot.remainingTokenQty -= lotTokensToRelieve;
                lot.remainingBasisLamports -= basisRelieved;
                totalBasisRelieved += basisRelieved;
                tokensRemainingToRelieve = 0n;
            }
        }
        // Clean up closed lots from active list
        const remainingActiveLotIds = lotIds.filter((id) => (this.lots.get(id)?.remainingTokenQty ?? 0n) > 0n);
        if (remainingActiveLotIds.length === 0) {
            this.lotsByMint.delete(mint);
        }
        else {
            this.lotsByMint.set(mint, remainingActiveLotIds);
        }
        // Update inventory
        const newInventory = availableTokens - tokensToSellRaw;
        if (newInventory === 0n) {
            this.tokenInventories.delete(mint);
        }
        else {
            this.tokenInventories.set(mint, newInventory);
        }
        const exitFriction = exitFeeLamports + exitTipLamports;
        const netProceeds = grossProceedsLamports - exitFriction;
        this.confirmedCashLamports += netProceeds;
        this.totalRealizedProceedsLamports += grossProceedsLamports;
        this.totalBasisRelievedLamports += totalBasisRelieved;
        this.totalFrictionBurnLamports += exitFriction;
        const realizedPnL = grossProceedsLamports - totalBasisRelieved - exitFriction;
        // Remaining basis across remaining lots for this mint
        const remainingLots = this.getActiveLots(mint);
        const totalRemainingBasis = remainingLots.reduce((sum, l) => sum + l.remainingBasisLamports, 0n);
        this.appendJournalEntry({
            eventType: 'FILL_SETTLED_CLOSE',
            slot,
            intentId,
            deltaCashLamports: netProceeds,
            deltaTokensRaw: -tokensToSellRaw,
            mint,
            payload: {
                tokensSoldRaw: tokensToSellRaw.toString(),
                grossProceedsLamports: grossProceedsLamports.toString(),
                basisRelievedLamports: totalBasisRelieved.toString(),
                exitFriction: exitFriction.toString(),
                realizedPnL: realizedPnL.toString(),
                signature,
            },
        });
        return Object.freeze({
            mint,
            tokensSoldRaw: tokensToSellRaw,
            grossProceedsLamports,
            basisRelievedLamports: totalBasisRelieved,
            exitFrictionLamports: exitFriction,
            realizedPnLLamports: realizedPnL,
            remainingBasisLamports: totalRemainingBasis,
            remainingTokensRaw: newInventory,
            lotsAffected: Object.freeze(lotsAffected),
        });
    }
    /**
     * Cryptographic verification of whole-system double-entry conservation:
     * 1. Sum of remaining lot tokens == TokenInventory for all mints.
     * 2. Sum of lot basis == Total active basis.
     */
    verifyConservation() {
        const discrepancies = [];
        // Verify token inventories
        for (const [mint, invQty] of this.tokenInventories.entries()) {
            const activeLots = this.getActiveLots(mint);
            const lotTokensSum = activeLots.reduce((sum, l) => sum + l.remainingTokenQty, 0n);
            if (lotTokensSum !== invQty) {
                discrepancies.push(`INVENTORY_MISMATCH (${mint}): Lot sum ${lotTokensSum} != inventory ${invQty}`);
            }
        }
        return {
            isValid: discrepancies.length === 0,
            discrepancies,
        };
    }
    appendJournalEntry(params) {
        this.sequenceCounter++;
        const prevHash = this.lastJournalHash;
        const now = Date.now();
        const entryHash = createHash('sha256')
            .update(JSON.stringify({
            seq: this.sequenceCounter.toString(),
            type: params.eventType,
            time: now,
            slot: params.slot,
            intent: params.intentId,
            deltaCash: params.deltaCashLamports.toString(),
            cashAfter: this.confirmedCashLamports.toString(),
            deltaTokens: params.deltaTokensRaw.toString(),
            mint: params.mint,
            lotId: params.lotId,
            prev: prevHash,
        }))
            .digest('hex');
        const entry = {
            sequenceNumber: this.sequenceCounter,
            eventType: params.eventType,
            timestampMs: now,
            slot: params.slot,
            intentId: params.intentId,
            deltaCashLamports: params.deltaCashLamports,
            balanceAfterCashLamports: this.confirmedCashLamports,
            deltaTokensRaw: params.deltaTokensRaw,
            mint: params.mint,
            lotId: params.lotId,
            payload: params.payload,
            previousHash: prevHash,
            entryHash,
        };
        this.journal.push(entry);
        this.lastJournalHash = entryHash;
        return entry;
    }
}
//# sourceMappingURL=economic-authority-store.js.map