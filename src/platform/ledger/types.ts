export type LedgerEventType =
  | 'DEPOSIT'
  | 'TRADE_ENTRY'
  | 'TRADE_EXIT'
  | 'REALIZED_PNL'
  | 'UNREALIZED_MARK'
  | 'NETWORK_FEE'
  | 'PRIORITY_FEE'
  | 'JITO_TIP'
  | 'SLIPPAGE_COST'
  | 'PLATFORM_FEE'
  | 'SETTLEMENT'
  | 'ADJUSTMENT'
  | 'REVERSAL'
  | 'OPERATIONAL_LOSS';

export type AccountName =
  | 'Assets:CustomerControlled'
  | 'Assets:PlatformTreasury'
  | 'Assets:OperationalReserve'
  | 'Liabilities:CustomerEquity'
  | 'Liabilities:SettlementPayable'
  | 'Revenue:PlatformPerformanceFee'
  | 'Expenses:NetworkFriction'
  | 'Expenses:OperationalLoss';

export interface DoubleEntryPosting {
  account: AccountName;
  debitLamports: bigint;
  creditLamports: bigint;
}

export interface LedgerEvent {
  eventId: string;
  sequenceNumber: number;
  timestamp: number;
  type: LedgerEventType;
  userId: string;
  vaultId: string;
  cycleId?: string;
  strategyId?: string;
  strategyVersion?: string;
  transactionSignature?: string;
  asset: string; // e.g. 'SOL', or token mint address
  quantity: string; // base unit string
  solValueLamports: bigint;
  usdReferenceValue?: number;
  source: string;
  reason: string;
  previousLedgerHash: string;
  currentLedgerHash: string;
}

export interface JournalEntry {
  journalId: string;
  eventId: string;
  timestamp: number;
  postings: DoubleEntryPosting[];
  description: string;
}
