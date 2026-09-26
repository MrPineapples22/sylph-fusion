/**
 * SOLARIS-NEXUS: Dynamic Tip & Contention Oracle
 * Streams real-time Jito tip floors (p25-p95) and estimates account-contention priority fees.
 */

import { TipFloorSnapshot, AccountContentionEstimate, ContentionTier } from './types.js';

export type TradeUrgency = 'STANDARD' | 'URGENT_BREAKOUT' | 'EMERGENCY_EXIT';

export interface TipOracleConfig {
  readonly minTipLamports?: bigint;
  readonly maxTipLamports?: bigint;
  readonly cacheTtlMs?: number;
  readonly minPriorityFeeMicroLamports?: bigint;
  readonly maxPriorityFeeMicroLamports?: bigint;
}

export class DynamicTipAndContentionOracle {
  private readonly minTip: bigint;
  private readonly maxTip: bigint;
  private readonly cacheTtlMs: number;
  private readonly minPriorityMicroLamports: bigint;
  private readonly maxPriorityMicroLamports: bigint;

  private cachedTipFloor: TipFloorSnapshot;
  private contentionHistory = new Map<string, bigint[]>();

  constructor(cfg: TipOracleConfig = {}) {
    this.minTip = cfg.minTipLamports ?? 10_000n;
    this.maxTip = cfg.maxTipLamports ?? 20_000_000n;
    this.cacheTtlMs = cfg.cacheTtlMs ?? 2_500;
    this.minPriorityMicroLamports = cfg.minPriorityFeeMicroLamports ?? 50_000n;
    this.maxPriorityMicroLamports = cfg.maxPriorityFeeMicroLamports ?? 2_500_000n;

    // Seed with baseline nominal snapshot
    this.cachedTipFloor = {
      p25Lamports: 10_000n,
      p50Lamports: 25_000n,
      p75Lamports: 60_000n,
      p95Lamports: 250_000n,
      polledAtMs: Date.now(),
      isFresh: false,
      source: 'FALLBACK_MANDATE',
    };
  }

  public updateTipFloor(
    p25: bigint,
    p50: bigint,
    p75: bigint,
    p95: bigint,
    source: 'LIVE_API' | 'CACHE' | 'FALLBACK_MANDATE' = 'LIVE_API'
  ): TipFloorSnapshot {
    this.cachedTipFloor = {
      p25Lamports: p25 > 0n ? p25 : this.minTip,
      p50Lamports: p50 >= p25 ? p50 : p25,
      p75Lamports: p75 >= p50 ? p75 : p50,
      p95Lamports: p95 >= p75 ? p95 : p75,
      polledAtMs: Date.now(),
      isFresh: source === 'LIVE_API',
      source,
    };
    return this.cachedTipFloor;
  }

  public getTipFloor(): TipFloorSnapshot {
    const age = Date.now() - this.cachedTipFloor.polledAtMs;
    const isFresh = this.cachedTipFloor.source === 'LIVE_API' && age <= this.cacheTtlMs;
    return {
      ...this.cachedTipFloor,
      isFresh,
    };
  }

  public getRecommendedTip(urgency: TradeUrgency = 'STANDARD'): bigint {
    const floor = this.getTipFloor();
    let targetTip: bigint;

    switch (urgency) {
      case 'EMERGENCY_EXIT':
        targetTip = floor.p95Lamports;
        break;
      case 'URGENT_BREAKOUT':
        targetTip = (floor.p75Lamports + floor.p95Lamports) / 2n;
        break;
      case 'STANDARD':
      default:
        targetTip = floor.p75Lamports;
        break;
    }

    if (targetTip < this.minTip) targetTip = this.minTip;
    if (targetTip > this.maxTip) targetTip = this.maxTip;
    return targetTip;
  }

  public registerAccountPrioritizationSamples(
    accountAddress: string,
    feeSamplesMicroLamports: bigint[]
  ): void {
    const existing = this.contentionHistory.get(accountAddress) ?? [];
    const merged = [...existing, ...feeSamplesMicroLamports].slice(-150); // retain last 150 slots
    this.contentionHistory.set(accountAddress, merged);
  }

  public estimateContention(writeLockedAccounts: string[]): AccountContentionEstimate {
    const allSamples: bigint[] = [];
    for (const acc of writeLockedAccounts) {
      const samples = this.contentionHistory.get(acc);
      if (samples && samples.length > 0) {
        allSamples.push(...samples);
      }
    }

    if (allSamples.length === 0) {
      return {
        writeLockedAccounts,
        medianFeeMicroLamports: this.minPriorityMicroLamports,
        p75FeeMicroLamports: this.minPriorityMicroLamports,
        p95FeeMicroLamports: this.minPriorityMicroLamports * 2n,
        recommendedMicroLamportsPerCu: this.minPriorityMicroLamports,
        contentionTier: 'NOMINAL',
        polledAtMs: Date.now(),
        isObserved: false,
      };
    }

    allSamples.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const median = allSamples[Math.floor(allSamples.length * 0.5)];
    const p75 = allSamples[Math.floor(allSamples.length * 0.75)];
    const p95 = allSamples[Math.floor(allSamples.length * 0.95)];

    let contentionTier: ContentionTier = 'NOMINAL';
    if (p95 > 1_500_000n) {
      contentionTier = 'CRITICAL';
    } else if (p75 > 500_000n) {
      contentionTier = 'HIGH';
    } else if (median > 100_000n) {
      contentionTier = 'ELEVATED';
    }

    let recommended = p75 > this.minPriorityMicroLamports ? p75 : this.minPriorityMicroLamports;
    if (contentionTier === 'CRITICAL') {
      recommended = p95;
    }
    if (recommended > this.maxPriorityMicroLamports) {
      recommended = this.maxPriorityMicroLamports;
    }

    return {
      writeLockedAccounts,
      medianFeeMicroLamports: median,
      p75FeeMicroLamports: p75,
      p95FeeMicroLamports: p95,
      recommendedMicroLamportsPerCu: recommended,
      contentionTier,
      polledAtMs: Date.now(),
      isObserved: true,
    };
  }

  public getRecommendedPriorityFee(
    writeLockedAccounts: string[],
    urgency: TradeUrgency = 'STANDARD'
  ): { priorityMicroLamports: bigint; contentionTier: ContentionTier } {
    const estimate = this.estimateContention(writeLockedAccounts);
    let fee = estimate.recommendedMicroLamportsPerCu;

    if (urgency === 'EMERGENCY_EXIT') {
      fee = estimate.p95FeeMicroLamports * 3n / 2n;
    } else if (urgency === 'URGENT_BREAKOUT') {
      fee = estimate.p75FeeMicroLamports * 6n / 5n;
    }

    if (fee < this.minPriorityMicroLamports) fee = this.minPriorityMicroLamports;
    if (fee > this.maxPriorityMicroLamports) fee = this.maxPriorityMicroLamports;

    return { priorityMicroLamports: fee, contentionTier: estimate.contentionTier };
  }
}
