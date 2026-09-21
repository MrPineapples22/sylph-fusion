import { AccountName, DoubleEntryPosting, JournalEntry } from './types.js';

export class DoubleEntryJournal {
  private entries: JournalEntry[] = [];
  private balances = new Map<AccountName, bigint>();

  constructor() {
    this.resetBalances();
  }

  private resetBalances(): void {
    const accounts: AccountName[] = [
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

  getBalance(account: AccountName): bigint {
    return this.balances.get(account) ?? 0n;
  }

  getAllBalances(): Record<AccountName, string> {
    const result = {} as Record<AccountName, string>;
    for (const [k, v] of this.balances.entries()) {
      result[k] = v.toString();
    }
    return result;
  }

  /**
   * Post a balanced double-entry transaction.
   * Throws an error if sum(debits) != sum(credits).
   */
  post(eventId: string, postings: DoubleEntryPosting[], description: string): JournalEntry {
    if (postings.length === 0) {
      throw new Error('Cannot post empty journal entry');
    }

    let totalDebits = 0n;
    let totalCredits = 0n;

    for (const p of postings) {
      if (p.debitLamports < 0n || p.creditLamports < 0n) {
        throw new Error(`Negative amounts prohibited in posting for ${p.account}`);
      }
      totalDebits += p.debitLamports;
      totalCredits += p.creditLamports;
    }

    if (totalDebits !== totalCredits) {
      throw new Error(
        `Double-entry imbalance in event ${eventId}: Debits (${totalDebits}) != Credits (${totalCredits})`
      );
    }

    const journalId = `jnl-${this.entries.length + 1}-${Date.now().toString(36)}`;
    const entry: JournalEntry = {
      journalId,
      eventId,
      timestamp: Date.now(),
      postings,
      description,
    };

    // Apply postings to ledger accounts:
    // For Assets and Expenses: Balance = Balance + Debits - Credits
    // For Liabilities and Revenue: Balance = Balance + Credits - Debits
    for (const p of postings) {
      const current = this.balances.get(p.account) ?? 0n;
      if (p.account.startsWith('Assets:') || p.account.startsWith('Expenses:')) {
        this.balances.set(p.account, current + p.debitLamports - p.creditLamports);
      } else {
        this.balances.set(p.account, current + p.creditLamports - p.debitLamports);
      }
    }

    this.entries.push(entry);
    return entry;
  }

  /**
   * Post standard deposit:
   * Debit: Assets:CustomerControlled (+Asset)
   * Credit: Liabilities:CustomerEquity (+Liability)
   */
  postDeposit(eventId: string, amountLamports: bigint, description = 'Customer deposit'): JournalEntry {
    return this.post(
      eventId,
      [
        { account: 'Assets:CustomerControlled', debitLamports: amountLamports, creditLamports: 0n },
        { account: 'Liabilities:CustomerEquity', debitLamports: 0n, creditLamports: amountLamports },
      ],
      description
    );
  }

  /**
   * Post trading performance fee:
   * Debit: Liabilities:CustomerEquity (-Customer Equity)
   * Credit: Revenue:PlatformPerformanceFee (+Platform Revenue)
   */
  postPlatformFee(eventId: string, feeLamports: bigint, description = 'Performance fee'): JournalEntry {
    return this.post(
      eventId,
      [
        { account: 'Liabilities:CustomerEquity', debitLamports: feeLamports, creditLamports: 0n },
        { account: 'Revenue:PlatformPerformanceFee', debitLamports: 0n, creditLamports: feeLamports },
      ],
      description
    );
  }

  /**
   * Post network friction (priority fee, tip, rent):
   * Debit: Expenses:NetworkFriction (+Expense)
   * Credit: Assets:CustomerControlled (-Asset)
   */
  postNetworkFriction(eventId: string, frictionLamports: bigint, description = 'Network friction'): JournalEntry {
    return this.post(
      eventId,
      [
        { account: 'Expenses:NetworkFriction', debitLamports: frictionLamports, creditLamports: 0n },
        { account: 'Assets:CustomerControlled', debitLamports: 0n, creditLamports: frictionLamports },
      ],
      description
    );
  }

  /**
   * Post settlement payable preparation:
   * Debit: Liabilities:CustomerEquity (-Equity)
   * Credit: Liabilities:SettlementPayable (+Payable)
   */
  postSettlementPayable(eventId: string, settlementLamports: bigint, description = 'Settlement payable authorization'): JournalEntry {
    return this.post(
      eventId,
      [
        { account: 'Liabilities:CustomerEquity', debitLamports: settlementLamports, creditLamports: 0n },
        { account: 'Liabilities:SettlementPayable', debitLamports: 0n, creditLamports: settlementLamports },
      ],
      description
    );
  }

  /**
   * Post confirmed settlement payout to customer:
   * Debit: Liabilities:SettlementPayable (-Payable)
   * Credit: Assets:CustomerControlled (-Asset)
   */
  postSettlementPayout(eventId: string, payoutLamports: bigint, description = 'Confirmed settlement withdrawal'): JournalEntry {
    return this.post(
      eventId,
      [
        { account: 'Liabilities:SettlementPayable', debitLamports: payoutLamports, creditLamports: 0n },
        { account: 'Assets:CustomerControlled', debitLamports: 0n, creditLamports: payoutLamports },
      ],
      description
    );
  }

  /**
   * Fundamental Accounting Conservation Check:
   * Controlled Assets == Customer Liabilities + Platform-Owned Assets + Explicit Differences
   */
  checkConservation(): {
    conserved: boolean;
    controlledAssets: bigint;
    customerLiabilities: bigint;
    platformAssets: bigint;
    discrepancyLamports: bigint;
  } {
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
