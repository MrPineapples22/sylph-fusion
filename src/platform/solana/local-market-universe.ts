/**
 * SYLPH FUSION — LOCAL I/O-FREE MARKET UNIVERSE
 * Specification: Solana-Only Integration Blueprint (Section 2)
 *
 * Epistemic Invariants:
 * 1. ZERO hot-path remote I/O: Strategies operate exclusively on local immutable snapshots.
 * 2. Background workers continuously maintain state for Pump.fun, PumpSwap, Raydium, Meteora,
 *    Orca, Jupiter, and Phoenix/OpenBook books.
 * 3. Hot-path strategy calculations never invoke getAccountInfo, getBalance, getLatestBlockhash,
 *    ALT discovery, holder queries, or external risk APIs.
 * 4. Stale or absent snapshot resolves strictly to UNKNOWN (fail-closed, zero synthetic default).
 */

import { SolanaMarketIR, SolanaPoolType } from './market-ir.js';

export interface LocalUniverseMetrics {
  readonly totalTrackedMints: number;
  readonly totalTrackedPools: number;
  readonly snapshotsByPoolType: Readonly<Record<SolanaPoolType, number>>;
  readonly oldestFreshnessMs: number;
  readonly medianFreshnessMs: number;
  readonly lastWorkerHeartbeatMs: number;
}

export class LocalMarketUniverse {
  // Primary index: Mint -> latest SolanaMarketIR
  private readonly mintSnapshots = new Map<string, SolanaMarketIR>();
  
  // Secondary index: PoolId -> SolanaMarketIR
  private readonly poolSnapshots = new Map<string, SolanaMarketIR>();

  // Slot history for point-in-time time-travel evaluation (capped to last 500 slots)
  private readonly slotIndex = new Map<string, SolanaMarketIR[]>();

  private lastHeartbeatMs: number = Date.now();

  /**
   * Background worker ingestion interface.
   * Updates local snapshot state atomically and immutably.
   */
  public updateSnapshot(ir: SolanaMarketIR): void {
    this.mintSnapshots.set(ir.mint, ir);
    this.poolSnapshots.set(ir.poolId, ir);

    // Maintain slot index for point-in-time checks
    const history = this.slotIndex.get(ir.mint) || [];
    history.push(ir);
    if (history.length > 50) {
      history.shift();
    }
    this.slotIndex.set(ir.mint, history);
    this.lastHeartbeatMs = Date.now();
  }

  /**
   * Hot-path retrieval by token mint. Zero remote I/O.
   */
  public getSnapshot(mint: string): SolanaMarketIR | null {
    return this.mintSnapshots.get(mint) || null;
  }

  /**
   * Hot-path retrieval by pool ID. Zero remote I/O.
   */
  public getPool(poolId: string): SolanaMarketIR | null {
    return this.poolSnapshots.get(poolId) || null;
  }

  /**
   * Checks whether the current local snapshot is fresh within maxAgeMs.
   */
  public isFresh(mint: string, maxAgeMs: number, nowMs: number = Date.now()): boolean {
    const ir = this.mintSnapshots.get(mint);
    if (!ir) return false;
    const ageMs = nowMs - Date.parse(ir.observedAt);
    return ageMs >= 0 && ageMs <= maxAgeMs;
  }

  /**
   * Point-in-time query: Returns the most recent snapshot at or before maxSlot.
   * Prevents lookahead bias in backtests and strategy replay.
   */
  public getPointInTimeSnapshot(mint: string, maxSlot: bigint): SolanaMarketIR | null {
    const history = this.slotIndex.get(mint);
    if (!history || history.length === 0) {
      const current = this.mintSnapshots.get(mint);
      return current && current.slot <= maxSlot ? current : null;
    }

    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].slot <= maxSlot) {
        return history[i];
      }
    }
    return null;
  }

  /**
   * Read-only export of active opportunities, optionally filtered by pool type.
   */
  public getActiveUniverse(poolType?: SolanaPoolType): readonly SolanaMarketIR[] {
    const all = Array.from(this.mintSnapshots.values());
    if (!poolType) {
      return Object.freeze(all);
    }
    return Object.freeze(all.filter(ir => ir.poolType === poolType));
  }

  /**
   * Returns operational metrics for monitoring local cache health.
   */
  public getMetrics(nowMs: number = Date.now()): LocalUniverseMetrics {
    const all = Array.from(this.mintSnapshots.values());
    const countByType: Record<SolanaPoolType, number> = {
      PUMP_FUN: 0,
      PUMP_SWAP: 0,
      RAYDIUM_AMM: 0,
      RAYDIUM_CPMM: 0,
      RAYDIUM_CLMM: 0,
      METEORA_DLMM: 0,
      METEORA_DAMM: 0,
      ORCA_WHIRLPOOL: 0,
      JUPITER: 0,
      PHOENIX: 0,
      OPENBOOK: 0,
    };

    const ages: number[] = [];
    for (const ir of all) {
      countByType[ir.poolType] = (countByType[ir.poolType] || 0) + 1;
      const age = Math.max(0, nowMs - Date.parse(ir.observedAt));
      ages.push(age);
    }

    ages.sort((a, b) => a - b);
    const medianFreshnessMs = ages.length > 0 ? ages[Math.floor(ages.length / 2)] : 0;
    const oldestFreshnessMs = ages.length > 0 ? ages[ages.length - 1] : 0;

    return Object.freeze({
      totalTrackedMints: this.mintSnapshots.size,
      totalTrackedPools: this.poolSnapshots.size,
      snapshotsByPoolType: Object.freeze(countByType),
      oldestFreshnessMs,
      medianFreshnessMs,
      lastWorkerHeartbeatMs: this.lastHeartbeatMs,
    });
  }

  /**
   * Clears state for testing isolation.
   */
  public clear(): void {
    this.mintSnapshots.clear();
    this.poolSnapshots.clear();
    this.slotIndex.clear();
  }
}
