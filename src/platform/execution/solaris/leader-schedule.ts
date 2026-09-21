/**
 * SOLARIS-NEXUS: Leader Schedule Tracking Engine
 * Tracks Solana's 432,000-slot epoch leader schedule, identifying Jito-Solana validators
 * and predicting block packaging characteristics 32 slots in advance.
 */

import { LeaderSlotInfo } from './types.js';

export const SLOTS_PER_EPOCH = 432_000;
export const SLOTS_PER_LEADER_CHUNK = 4;

export interface ValidatorStakeRecord {
  readonly pubkey: string;
  readonly stakeLamports: bigint;
  readonly isJito: boolean;
}

export class LeaderScheduleTracker {
  private currentEpoch = 0;
  private scheduleBySlot = new Map<number, LeaderSlotInfo>();
  private jitoValidators = new Set<string>();
  private validatorStakes = new Map<string, bigint>();
  private totalActiveStakeLamports = 100_000_000_000_000_000n; // default ~100M SOL
  private lastRefreshedEpoch = -1;

  constructor(initialJitoPubkeys: string[] = []) {
    for (const key of initialJitoPubkeys) {
      this.jitoValidators.add(key);
    }
  }

  public registerJitoValidators(pubkeys: string[]): void {
    for (const key of pubkeys) {
      this.jitoValidators.add(key);
    }
    // Update any already-cached slot records
    for (const [slot, info] of this.scheduleBySlot.entries()) {
      if (this.jitoValidators.has(info.leaderPubkey) && !info.isJitoLeader) {
        this.scheduleBySlot.set(slot, { ...info, isJitoLeader: true });
      }
    }
  }

  public registerValidatorStakes(records: ValidatorStakeRecord[]): void {
    let sum = 0n;
    for (const rec of records) {
      this.validatorStakes.set(rec.pubkey, rec.stakeLamports);
      sum += rec.stakeLamports;
      if (rec.isJito) {
        this.jitoValidators.add(rec.pubkey);
      }
    }
    if (sum > 0n) {
      this.totalActiveStakeLamports = sum;
    }
  }

  public loadEpochSchedule(
    epoch: number,
    schedule: Map<string, number[]> | Record<string, number[]>,
    firstSlotOfEpoch?: number
  ): void {
    this.currentEpoch = epoch;
    this.lastRefreshedEpoch = epoch;
    this.scheduleBySlot.clear();

    const startSlot = firstSlotOfEpoch ?? epoch * SLOTS_PER_EPOCH;
    const entries = schedule instanceof Map ? schedule.entries() : Object.entries(schedule);

    for (const [pubkey, slotIndices] of entries) {
      const isJito = this.jitoValidators.has(pubkey);
      const stake = this.validatorStakes.get(pubkey) ?? 10_000_000_000_000n;
      const stakeShareBps = this.totalActiveStakeLamports > 0n
        ? Number((stake * 10_000n) / this.totalActiveStakeLamports)
        : 100;

      for (const idx of slotIndices) {
        const absoluteSlot = startSlot + idx;
        this.scheduleBySlot.set(absoluteSlot, {
          slot: absoluteSlot,
          leaderPubkey: pubkey,
          isJitoLeader: isJito,
          stakeWeightLamports: stake,
          epochSlotIndex: idx,
          clusterStakeShareBps: stakeShareBps,
        });
      }
    }
  }

  public getSlotLeader(slot: number): LeaderSlotInfo {
    const existing = this.scheduleBySlot.get(slot);
    if (existing) {
      return existing;
    }

    // Deterministic fallback heuristic if slot is beyond cached index
    const chunkIndex = Math.floor(slot / SLOTS_PER_LEADER_CHUNK);
    const mockValidatorIndex = (chunkIndex * 2654435761) >>> 0;
    const isJito = (mockValidatorIndex % 100) < 80; // ~80% of top stake runs Jito
    const fallbackPubkey = `val_${(mockValidatorIndex % 1000).toString().padStart(4, '0')}111111111111111111111111111111`;

    const info: LeaderSlotInfo = {
      slot,
      leaderPubkey: fallbackPubkey,
      isJitoLeader: this.jitoValidators.has(fallbackPubkey) || isJito,
      stakeWeightLamports: 500_000_000_000_000n,
      epochSlotIndex: slot % SLOTS_PER_EPOCH,
      clusterStakeShareBps: 250,
    };
    this.scheduleBySlot.set(slot, info);
    return info;
  }

  public getUpcomingWindow(startSlot: number, count = 16): LeaderSlotInfo[] {
    const window: LeaderSlotInfo[] = [];
    for (let s = startSlot; s < startSlot + count; s++) {
      window.push(this.getSlotLeader(s));
    }
    return window;
  }

  public isJitoLeaderAtSlot(slot: number): boolean {
    return this.getSlotLeader(slot).isJitoLeader;
  }

  public calculateChunkInfo(slot: number): {
    chunkStartSlot: number;
    chunkEndSlot: number;
    remainingSlotsInChunk: number;
  } {
    const chunkStartSlot = Math.floor(slot / SLOTS_PER_LEADER_CHUNK) * SLOTS_PER_LEADER_CHUNK;
    const chunkEndSlot = chunkStartSlot + SLOTS_PER_LEADER_CHUNK - 1;
    const remainingSlotsInChunk = chunkEndSlot - slot;
    return { chunkStartSlot, chunkEndSlot, remainingSlotsInChunk };
  }

  public getStats(): {
    currentEpoch: number;
    cachedSlotCount: number;
    knownJitoCount: number;
    totalStakedLamports: string;
  } {
    return {
      currentEpoch: this.currentEpoch,
      cachedSlotCount: this.scheduleBySlot.size,
      knownJitoCount: this.jitoValidators.size,
      totalStakedLamports: this.totalActiveStakeLamports.toString(),
    };
  }
}
