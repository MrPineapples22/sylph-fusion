import { createHash } from 'node:crypto';
import { LedgerEvent, LedgerEventType } from './types.js';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export class EventLedger {
  private events: LedgerEvent[] = [];
  private currentHash: string = GENESIS_HASH;

  constructor(initialEvents: LedgerEvent[] = []) {
    if (initialEvents.length > 0) {
      this.loadAndVerify(initialEvents);
    }
  }

  get length(): number {
    return this.events.length;
  }

  get latestHash(): string {
    return this.currentHash;
  }

  getEvents(): readonly LedgerEvent[] {
    return this.events;
  }

  getEventsByVault(vaultId: string): LedgerEvent[] {
    return this.events.filter(e => e.vaultId === vaultId);
  }

  getEventsByUser(userId: string): LedgerEvent[] {
    return this.events.filter(e => e.userId === userId);
  }

  append(params: Omit<LedgerEvent, 'eventId' | 'sequenceNumber' | 'previousLedgerHash' | 'currentLedgerHash'>): LedgerEvent {
    const sequenceNumber = this.events.length + 1;
    const eventId = `evt-${sequenceNumber}-${Date.now().toString(36)}`;
    const previousLedgerHash = this.currentHash;

    const partialEvent = {
      ...params,
      eventId,
      sequenceNumber,
      previousLedgerHash,
    };

    const currentLedgerHash = this.computeHash(partialEvent);
    const completeEvent: LedgerEvent = {
      ...partialEvent,
      currentLedgerHash,
    };

    this.events.push(completeEvent);
    this.currentHash = currentLedgerHash;
    return completeEvent;
  }

  /**
   * Cryptographically re-verifies the entire hash chain from genesis.
   * Throws an error immediately if any event has been tampered with or reordered.
   */
  verifyChain(): { valid: boolean; error?: string; verifiedEvents: number } {
    let expectedPrevious = GENESIS_HASH;

    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];

      if (event.sequenceNumber !== i + 1) {
        return {
          valid: false,
          error: `Sequence mismatch at index ${i}: expected ${i + 1}, got ${event.sequenceNumber}`,
          verifiedEvents: i,
        };
      }

      if (event.previousLedgerHash !== expectedPrevious) {
        return {
          valid: false,
          error: `Broken chain link at sequence ${event.sequenceNumber}: expected prev ${expectedPrevious}, got ${event.previousLedgerHash}`,
          verifiedEvents: i,
        };
      }

      const recomputed = this.computeHash(event);
      if (recomputed !== event.currentLedgerHash) {
        return {
          valid: false,
          error: `Hash mismatch at sequence ${event.sequenceNumber}: computed ${recomputed}, stored ${event.currentLedgerHash}`,
          verifiedEvents: i,
        };
      }

      expectedPrevious = event.currentLedgerHash;
    }

    return { valid: true, verifiedEvents: this.events.length };
  }

  /**
   * Reconstructs the exact cash balance and cumulative metrics of a vault from ledger events alone.
   */
  reconstructVaultState(vaultId: string): {
    depositsLamports: bigint;
    realizedPnlLamports: bigint;
    feesPaidLamports: bigint;
    settledLamports: bigint;
    netCashBalanceLamports: bigint;
    eventCount: number;
  } {
    let depositsLamports = 0n;
    let realizedPnlLamports = 0n;
    let feesPaidLamports = 0n;
    let settledLamports = 0n;
    let eventCount = 0;

    for (const event of this.events) {
      if (event.vaultId !== vaultId) continue;
      eventCount++;

      switch (event.type) {
        case 'DEPOSIT':
          depositsLamports += event.solValueLamports;
          break;
        case 'REALIZED_PNL':
          realizedPnlLamports += event.solValueLamports;
          break;
        case 'NETWORK_FEE':
        case 'PRIORITY_FEE':
        case 'JITO_TIP':
        case 'SLIPPAGE_COST':
        case 'PLATFORM_FEE':
          feesPaidLamports += event.solValueLamports;
          break;
        case 'SETTLEMENT':
          settledLamports += event.solValueLamports;
          break;
        case 'ADJUSTMENT':
        case 'REVERSAL':
          realizedPnlLamports += event.solValueLamports;
          break;
      }
    }

    const netCashBalanceLamports = depositsLamports + realizedPnlLamports - feesPaidLamports - settledLamports;

    return {
      depositsLamports,
      realizedPnlLamports,
      feesPaidLamports,
      settledLamports,
      netCashBalanceLamports,
      eventCount,
    };
  }

  /**
   * Emit a compensating entry for corrections. Historical financial records are NEVER mutated.
   */
  createCompensatingAdjustment(
    originalEventId: string,
    vaultId: string,
    userId: string,
    deltaLamports: bigint,
    reason: string
  ): LedgerEvent {
    return this.append({
      timestamp: Date.now(),
      type: deltaLamports >= 0n ? 'ADJUSTMENT' : 'REVERSAL',
      userId,
      vaultId,
      asset: 'SOL',
      quantity: deltaLamports.toString(),
      solValueLamports: deltaLamports,
      source: 'reconciliation_engine',
      reason: `Compensating entry for ${originalEventId}: ${reason}`,
    });
  }

  private computeHash(event: Omit<LedgerEvent, 'currentLedgerHash'>): string {
    const payload = [
      event.sequenceNumber,
      event.timestamp,
      event.type,
      event.userId,
      event.vaultId,
      event.cycleId || '',
      event.strategyId || '',
      event.strategyVersion || '',
      event.transactionSignature || '',
      event.asset,
      event.quantity,
      event.solValueLamports.toString(),
      event.source,
      event.reason,
      event.previousLedgerHash,
    ].join('|');

    return createHash('sha256').update(payload, 'utf8').digest('hex');
  }

  private loadAndVerify(events: LedgerEvent[]): void {
    this.events = [];
    this.currentHash = GENESIS_HASH;
    for (const event of events) {
      this.events.push(event);
    }
    const result = this.verifyChain();
    if (!result.valid) {
      throw new Error(`Failed to load ledger: ${result.error}`);
    }
    if (this.events.length > 0) {
      this.currentHash = this.events[this.events.length - 1].currentLedgerHash;
    }
  }
}
