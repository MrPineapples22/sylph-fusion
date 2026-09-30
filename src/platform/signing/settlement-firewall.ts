/**
 * SOL-SYLPH Multi-User Platform - Settlement Firewall
 * Specifications: Sections XLIII (Withdrawal / Settlement Firewall), XLV (Idempotent Settlement).
 *
 * Rules:
 * 1. Independent policy verification on every settlement transaction.
 * 2. Mandatory destination verification (must match confirmed user destination).
 * 3. Amount verification (cannot exceed liquid balance).
 * 4. Cycle state check (must be SETTLEMENT_READY).
 * 5. Reconciliation invariant (halts if reconciliation is unclean).
 * 6. Idempotent settlement records prevent duplicate payouts across restarts.
 */

import type {
  SettlementAuthorizationRequest,
  SettlementDecision,
  SettlementState,
} from './types.js';

export interface SettlementRecord {
  readonly settlementId: string;
  readonly vaultId: string;
  readonly userId: string;
  readonly cycleId: string;
  readonly destinationAddress: string;
  readonly netPayableLamports: bigint;
  readonly platformFeeLamports: bigint;
  state: SettlementState;
  authorizedAt?: number;
  submittedAt?: number;
  confirmedAt?: number;
  failedAt?: number;
  rejectionReason?: string;
  txSignature?: string;
}

export class SettlementFirewall {
  private readonly settlementStore: Map<string, SettlementRecord> = new Map();
  private readonly settlementByCycle: Map<string, string> = new Map();
  private readonly confirmedDestinationsByVault: Map<string, string> = new Map();
  private readonly durableStore?: DurableSettlementStore;

  constructor(durableStore?: DurableSettlementStore) {
    this.durableStore = durableStore;
  }

  /**
   * Hydrates in-memory cache from durable storage to prevent duplicate settlements across process restarts.
   */
  public async init(): Promise<void> {
    if (!this.durableStore) return;
    if (typeof this.durableStore.getAllRecords === 'function') {
      const records = await this.durableStore.getAllRecords();
      for (const rec of records) {
        this.settlementStore.set(rec.settlementId, rec);
        this.settlementByCycle.set(this.cycleKey(rec.vaultId, rec.cycleId), rec.settlementId);
      }
    }
    if (typeof this.durableStore.getAllConfirmedDestinations === 'function') {
      const dests = await this.durableStore.getAllConfirmedDestinations();
      for (const [vaultId, dest] of Object.entries(dests)) {
        this.confirmedDestinationsByVault.set(vaultId, dest);
      }
    }
  }

  private cycleKey(vaultId: string, cycleId: string): string {
    return JSON.stringify([vaultId, cycleId]);
  }

  /**
   * Register the user's confirmed payout destination during vault initialization.
   */
  public registerConfirmedDestination(vaultId: string, confirmedDestinationAddress: string): void {
    if (!confirmedDestinationAddress || confirmedDestinationAddress.length < 32) {
      throw new Error(`Invalid Solana destination address: ${confirmedDestinationAddress}`);
    }
    const existing = this.confirmedDestinationsByVault.get(vaultId);
    if (existing && existing !== confirmedDestinationAddress) {
      throw new Error(`Confirmed destination is immutable for vault ${vaultId}`);
    }
    this.confirmedDestinationsByVault.set(vaultId, confirmedDestinationAddress);
    if (this.durableStore) {
      this.durableStore.saveConfirmedDestination(vaultId, confirmedDestinationAddress).catch(() => {});
    }
  }

  public getConfirmedDestination(vaultId: string): string | undefined {
    return this.confirmedDestinationsByVault.get(vaultId);
  }

  /**
   * Verify and authorize a settlement payout.
   */
  public authorizeSettlement(req: SettlementAuthorizationRequest): SettlementDecision {
    const now = Date.now();

    // 1. Idempotency Check
    const existing = this.settlementStore.get(req.settlementId);
    if (existing) {
      return {
        approved: false,
        settlementId: req.settlementId,
        netPayableLamports: 0n,
        platformFeeLamports: 0n,
        rejectionReason: `Duplicate settlement request: Settlement ${req.settlementId} is already in state ${existing.state}`,
        timestamp: now,
      };
    }

    const cycleKey = this.cycleKey(req.vaultId, req.cycleId);
    const existingForCycle = this.settlementByCycle.get(cycleKey);
    if (existingForCycle) {
      return {
        approved: false,
        settlementId: req.settlementId,
        netPayableLamports: 0n,
        platformFeeLamports: 0n,
        rejectionReason: `Duplicate settlement cycle: Vault ${req.vaultId} cycle ${req.cycleId} is already bound to settlement ${existingForCycle}`,
        timestamp: now,
      };
    }

    // 2. Cycle State Invariant
    if (req.cycleState !== 'SETTLEMENT_READY') {
      return {
        approved: false,
        settlementId: req.settlementId,
        netPayableLamports: 0n,
        platformFeeLamports: 0n,
        rejectionReason: `Cycle state must be SETTLEMENT_READY to settle (current: ${req.cycleState})`,
        timestamp: now,
      };
    }

    // 3. Destination Address Whitelist / Identity Matching
    const confirmedDest = this.confirmedDestinationsByVault.get(req.vaultId);
    if (!confirmedDest) {
      return {
        approved: false,
        settlementId: req.settlementId,
        netPayableLamports: 0n,
        platformFeeLamports: 0n,
        rejectionReason: `No confirmed destination registered for vault ${req.vaultId}`,
        timestamp: now,
      };
    }

    if (req.userDestinationAddress !== confirmedDest) {
      return {
        approved: false,
        settlementId: req.settlementId,
        netPayableLamports: 0n,
        platformFeeLamports: 0n,
        rejectionReason: `Destination mismatch: Requested ${req.userDestinationAddress} does not match confirmed ${confirmedDest}`,
        timestamp: now,
      };
    }

    // 4. Reconciliation Health Check
    if (!req.isReconciliationClean) {
      return {
        approved: false,
        settlementId: req.settlementId,
        netPayableLamports: 0n,
        platformFeeLamports: 0n,
        rejectionReason: 'Reconciliation alert: Settlement blocked due to active accounting discrepancies',
        timestamp: now,
      };
    }

    // 5. Balance & Solvency Invariant
    if (req.netPayableLamports < 0n || req.platformFeeLamports < 0n || req.verifiedLiquidBalanceLamports < 0n) {
      return {
        approved: false,
        settlementId: req.settlementId,
        netPayableLamports: 0n,
        platformFeeLamports: 0n,
        rejectionReason: 'Settlement amounts and verified liquid balance must be non-negative',
        timestamp: now,
      };
    }
    const totalRequired = req.netPayableLamports + req.platformFeeLamports;
    if (totalRequired > req.verifiedLiquidBalanceLamports) {
      return {
        approved: false,
        settlementId: req.settlementId,
        netPayableLamports: 0n,
        platformFeeLamports: 0n,
        rejectionReason: `Insufficient liquid balance: Required ${totalRequired} lamports > Verified ${req.verifiedLiquidBalanceLamports} lamports`,
        timestamp: now,
      };
    }

    // Authorization Granted
    const record: SettlementRecord = {
      settlementId: req.settlementId,
      vaultId: req.vaultId,
      userId: req.userId,
      cycleId: req.cycleId,
      destinationAddress: req.userDestinationAddress,
      netPayableLamports: req.netPayableLamports,
      platformFeeLamports: req.platformFeeLamports,
      state: 'AUTHORIZED',
      authorizedAt: now,
    };

    this.settlementStore.set(req.settlementId, record);
    this.settlementByCycle.set(cycleKey, req.settlementId);
    if (this.durableStore) {
      this.durableStore.saveSettlementRecord(record).catch(() => {});
    }

    return {
      approved: true,
      settlementId: req.settlementId,
      netPayableLamports: req.netPayableLamports,
      platformFeeLamports: req.platformFeeLamports,
      timestamp: now,
    };
  }

  public recordSubmission(settlementId: string): void {
    const record = this.settlementStore.get(settlementId);
    if (record && record.state === 'AUTHORIZED') {
      record.state = 'SUBMITTED';
      record.submittedAt = Date.now();
      if (this.durableStore) {
        this.durableStore.saveSettlementRecord(record).catch(() => {});
      }
    }
  }

  public recordConfirmation(settlementId: string, txSignature: string): void {
    const record = this.settlementStore.get(settlementId);
    if (record) {
      record.state = 'CONFIRMED';
      record.confirmedAt = Date.now();
      record.txSignature = txSignature;
      if (this.durableStore) {
        this.durableStore.saveSettlementRecord(record).catch(() => {});
      }
    }
  }

  public recordFailure(settlementId: string, reason: string): void {
    const record = this.settlementStore.get(settlementId);
    if (record) {
      record.state = 'FAILED';
      record.failedAt = Date.now();
      record.rejectionReason = reason;
    }
  }

  public getRecord(settlementId: string): SettlementRecord | undefined {
    return this.settlementStore.get(settlementId);
  }
}

export interface DurableSettlementStore {
  saveSettlementRecord(record: SettlementRecord): Promise<void>;
  getSettlementRecord(settlementId: string): Promise<SettlementRecord | undefined>;
  getSettlementByCycle(vaultId: string, cycleId: string): Promise<string | undefined>;
  saveConfirmedDestination(vaultId: string, address: string): Promise<void>;
  getConfirmedDestination(vaultId: string): Promise<string | undefined>;
  getAllRecords?(): Promise<SettlementRecord[]>;
  getAllConfirmedDestinations?(): Promise<Record<string, string>>;
}

export class InMemorySettlementStore implements DurableSettlementStore {
  private readonly records = new Map<string, SettlementRecord>();
  private readonly byCycle = new Map<string, string>();
  private readonly destinations = new Map<string, string>();

  async saveSettlementRecord(record: SettlementRecord): Promise<void> {
    this.records.set(record.settlementId, { ...record });
    this.byCycle.set(JSON.stringify([record.vaultId, record.cycleId]), record.settlementId);
  }
  async getSettlementRecord(settlementId: string): Promise<SettlementRecord | undefined> {
    const r = this.records.get(settlementId);
    return r ? { ...r } : undefined;
  }
  async getSettlementByCycle(vaultId: string, cycleId: string): Promise<string | undefined> {
    return this.byCycle.get(JSON.stringify([vaultId, cycleId]));
  }
  async saveConfirmedDestination(vaultId: string, address: string): Promise<void> {
    this.destinations.set(vaultId, address);
  }
  async getConfirmedDestination(vaultId: string): Promise<string | undefined> {
    return this.destinations.get(vaultId);
  }
  async getAllRecords(): Promise<SettlementRecord[]> {
    return Array.from(this.records.values()).map(r => ({ ...r }));
  }
  async getAllConfirmedDestinations(): Promise<Record<string, string>> {
    return Object.fromEntries(this.destinations.entries());
  }
}
