export class DoubleEntryJournal {
    entries = [];
    entriesByPostingIdentity = new Map();
    balances = new Map();
    constructor() {
        this.resetBalances();
    }
    resetBalances() {
        const accounts = [
            'Assets:CustomerControlled',
            'Assets:PlatformTreasury',
            'Assets:OperationalReserve',
            'Liabilities:CustomerEquity',
            'Liabilities:SettlementPayable',
            'Revenue:PlatformPerformanceFee',
            'Expenses:NetworkFriction',
            'Expenses:OperationalLoss',
        ];
        for (const acc of accounts) {
            this.balances.set(acc, 0n);
        }
    }
    getBalance(account) {
        return this.balances.get(account) ?? 0n;
    }
    getAllBalances() {
        const result = {};
        for (const [k, v] of this.balances.entries()) {
            result[k] = v.toString();
        }
        return result;
    }
    /**
     * Post a balanced double-entry transaction.
     * Throws an error if sum(debits) != sum(credits).
     */
    post(eventId, postings, description) {
        if (typeof eventId !== 'string' || eventId.trim().length === 0) {
            throw new Error('Journal eventId is required');
        }
        if (postings.length === 0) {
            throw new Error('Cannot post empty journal entry');
        }
        const normalizedPostings = postings.map(p => ({ ...p }));
        // One source event can legitimately produce several accounting legs
        // (fee, payable, payout). The idempotency identity therefore includes the
        // account/direction shape, while amount changes for the same leg conflict.
        const postingShape = normalizedPostings
            .map(p => `${p.account}:${p.debitLamports > 0n ? 'D' : ''}${p.creditLamports > 0n ? 'C' : ''}`)
            .join('|');
        const postingIdentity = `${eventId}|${postingShape}`;
        const existing = this.entriesByPostingIdentity.get(postingIdentity);
        if (existing) {
            const sameDescription = existing.description === description;
            const samePostings = existing.postings.length === normalizedPostings.length &&
                existing.postings.every((p, index) => {
                    const candidate = normalizedPostings[index];
                    return candidate !== undefined && p.account === candidate.account &&
                        p.debitLamports === candidate.debitLamports &&
                        p.creditLamports === candidate.creditLamports;
                });
            if (!sameDescription || !samePostings) {
                throw new Error(`Conflicting replay for journal event ${eventId}`);
            }
            return existing;
        }
        let totalDebits = 0n;
        let totalCredits = 0n;
        for (const p of normalizedPostings) {
            if (p.debitLamports < 0n || p.creditLamports < 0n) {
                throw new Error(`Negative amounts prohibited in posting for ${p.account}`);
            }
            totalDebits += p.debitLamports;
            totalCredits += p.creditLamports;
        }
        if (totalDebits !== totalCredits) {
            throw new Error(`Double-entry imbalance in event ${eventId}: Debits (${totalDebits}) != Credits (${totalCredits})`);
        }
        const journalId = `jnl-${this.entries.length + 1}-${Date.now().toString(36)}`;
        const entry = {
            journalId,
            eventId,
            timestamp: Date.now(),
            postings: normalizedPostings,
            description,
        };
        // Apply postings to ledger accounts:
        // For Assets and Expenses: Balance = Balance + Debits - Credits
        // For Liabilities and Revenue: Balance = Balance + Credits - Debits
        for (const p of normalizedPostings) {
            const current = this.balances.get(p.account) ?? 0n;
            if (p.account.startsWith('Assets:') || p.account.startsWith('Expenses:')) {
                this.balances.set(p.account, current + p.debitLamports - p.creditLamports);
            }
            else {
                this.balances.set(p.account, current + p.creditLamports - p.debitLamports);
            }
        }
        this.entries.push(entry);
        this.entriesByPostingIdentity.set(postingIdentity, entry);
        return entry;
    }
    /**
     * Post standard deposit:
     * Debit: Assets:CustomerControlled (+Asset)
     * Credit: Liabilities:CustomerEquity (+Liability)
     */
    postDeposit(eventId, amountLamports, description = 'Customer deposit') {
        return this.post(eventId, [
            { account: 'Assets:CustomerControlled', debitLamports: amountLamports, creditLamports: 0n },
            { account: 'Liabilities:CustomerEquity', debitLamports: 0n, creditLamports: amountLamports },
        ], description);
    }
    /**
     * Post trading performance fee:
     * Debit: Liabilities:CustomerEquity (-Customer Equity)
     * Credit: Revenue:PlatformPerformanceFee (+Platform Revenue)
     */
    postPlatformFee(eventId, feeLamports, description = 'Performance fee') {
        return this.post(eventId, [
            { account: 'Liabilities:CustomerEquity', debitLamports: feeLamports, creditLamports: 0n },
            { account: 'Revenue:PlatformPerformanceFee', debitLamports: 0n, creditLamports: feeLamports },
        ], description);
    }
    /**
     * Post network friction (priority fee, tip, rent):
     * Debit: Expenses:NetworkFriction (+Expense)
     * Credit: Assets:CustomerControlled (-Asset)
     */
    postNetworkFriction(eventId, frictionLamports, description = 'Network friction') {
        return this.post(eventId, [
            { account: 'Expenses:NetworkFriction', debitLamports: frictionLamports, creditLamports: 0n },
            { account: 'Assets:CustomerControlled', debitLamports: 0n, creditLamports: frictionLamports },
        ], description);
    }
    /**
     * Post settlement payable preparation:
     * Debit: Liabilities:CustomerEquity (-Equity)
     * Credit: Liabilities:SettlementPayable (+Payable)
     */
    postSettlementPayable(eventId, settlementLamports, description = 'Settlement payable authorization') {
        return this.post(eventId, [
            { account: 'Liabilities:CustomerEquity', debitLamports: settlementLamports, creditLamports: 0n },
            { account: 'Liabilities:SettlementPayable', debitLamports: 0n, creditLamports: settlementLamports },
        ], description);
    }
    /**
     * Post confirmed settlement payout to customer:
     * Debit: Liabilities:SettlementPayable (-Payable)
     * Credit: Assets:CustomerControlled (-Asset)
     */
    postSettlementPayout(eventId, payoutLamports, description = 'Confirmed settlement withdrawal') {
        return this.post(eventId, [
            { account: 'Liabilities:SettlementPayable', debitLamports: payoutLamports, creditLamports: 0n },
            { account: 'Assets:CustomerControlled', debitLamports: 0n, creditLamports: payoutLamports },
        ], description);
    }
    /**
     * Fundamental Accounting Conservation Check:
     * Controlled Assets == Customer Liabilities + Platform-Owned Assets + Explicit Differences
     */
    checkConservation() {
        const controlledAssets = this.getBalance('Assets:CustomerControlled');
        const customerLiabilities = this.getBalance('Liabilities:CustomerEquity') + this.getBalance('Liabilities:SettlementPayable');
        const platformAssets = this.getBalance('Assets:PlatformTreasury') + this.getBalance('Assets:OperationalReserve');
        const platformRevenue = this.getBalance('Revenue:PlatformPerformanceFee');
        const expenses = this.getBalance('Expenses:NetworkFriction') + this.getBalance('Expenses:OperationalLoss');
        // Total Assets = Total Liabilities + Equity (Platform Revenue - Expenses)
        const totalAssets = controlledAssets + platformAssets;
        const totalClaims = customerLiabilities + platformRevenue - expenses;
        const discrepancyLamports = totalAssets - totalClaims;
        return {
            conserved: discrepancyLamports === 0n,
            controlledAssets,
            customerLiabilities,
            platformAssets,
            discrepancyLamports,
        };
    }
}
//# sourceMappingURL=double-entry.js.map