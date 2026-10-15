/**
 * SOLARIS-NEXUS: Post-Graduation AMM Bridge
 * Tracks explicitly observed pool state after bonding-curve completion.
 * A completed curve alone does not identify or price its destination venue.
 */

import type { AmmObservationSource, AmmVenue, GraduatedTokenState, GraduationStatus } from './types.js';
import { isCanonicalPumpSwapObservation } from './pump-swap-pool-reader.js';

export interface AmmBridgeConfig {
  readonly sniperCooldownMs?: number;
  readonly minAmmQuoteReserves?: bigint;
  readonly maxPoolAgeMs?: number;
}

export interface ObservedAmmPool {
  readonly venue: AmmVenue;
  readonly source: AmmObservationSource;
  readonly poolAddress: string;
  readonly quoteMint: string;
  readonly quoteReserves: bigint;
  readonly tokenReserves: bigint;
  readonly effectiveFeeBps: number;
  readonly slot: number;
  readonly observedAtMs: number;
}

export interface AmmObservationSummary {
  readonly status: 'NOT_MIGRATED' | 'WAITING' | 'OBSERVED' | 'UNAVAILABLE' | 'STALE' | 'UNVERIFIED';
  readonly venue?: AmmVenue;
  readonly poolAddress?: string;
  readonly slot?: number;
  readonly observedAtMs?: number;
  readonly source?: AmmObservationSource;
  readonly lastAttemptAtMs?: number;
  readonly lastError?: string;
}

export class PostGraduationAmmBridge {
  private readonly sniperCooldownMs: number;
  private readonly minAmmQuoteReserves: bigint;
  private readonly maxPoolAgeMs: number;
  private tokens = new Map<string, GraduatedTokenState>();

  constructor(cfg: AmmBridgeConfig = {}) {
    this.sniperCooldownMs = cfg.sniperCooldownMs ?? 30_000;
    this.minAmmQuoteReserves = cfg.minAmmQuoteReserves ?? 5_000_000_000n;
    this.maxPoolAgeMs = cfg.maxPoolAgeMs ?? 1_000;
    if (!Number.isSafeInteger(this.maxPoolAgeMs) || this.maxPoolAgeMs <= 0 || this.maxPoolAgeMs > 60_000) {
      throw new Error('INVALID_AMM_POOL_FRESHNESS_POLICY');
    }
  }

  public registerMigration(mint: string, slot: number): GraduatedTokenState {
    if (!mint || !Number.isSafeInteger(slot) || slot <= 0) throw new Error('INVALID_MIGRATION_IDENTITY');
    const existing = this.tokens.get(mint);
    if (existing && slot < existing.migrationTriggeredAtSlot) throw new Error('MIGRATION_SLOT_REGRESSION');
    // Market snapshots repeatedly observe the same completed curve at newer
    // slots. Preserve the first migration boundary, cooldown and any pool data.
    if (existing) return existing;

    const now = Date.now();
    const state: GraduatedTokenState = {
      mint,
      status: 'MIGRATION_PENDING',
      migrationTriggeredAtSlot: slot,
      migrationTriggeredAtMs: now,
      sniperCooldownExpiresAtMs: now + this.sniperCooldownMs,
      sniperDumpObserved: false,
    };
    this.tokens.set(mint, state);
    return state;
  }

  public registerAmmPool(mint: string, pool: ObservedAmmPool): GraduatedTokenState {
    const existing = this.tokens.get(mint);
    if (!existing || existing.status === 'BONDING_CURVE') throw new Error('MIGRATION_NOT_REGISTERED');
    if (!pool || !pool.venue || !pool.source || !pool.poolAddress || !pool.quoteMint ||
        typeof pool.quoteReserves !== 'bigint' || pool.quoteReserves <= 0n ||
        typeof pool.tokenReserves !== 'bigint' || pool.tokenReserves <= 0n ||
        !Number.isInteger(pool.effectiveFeeBps) || pool.effectiveFeeBps < 0 || pool.effectiveFeeBps >= 10_000 ||
        !Number.isSafeInteger(pool.slot) || pool.slot < existing.migrationTriggeredAtSlot ||
        !Number.isSafeInteger(pool.observedAtMs) || pool.observedAtMs <= 0 || pool.observedAtMs > Date.now()) {
      throw new Error('INVALID_AMM_POOL_SNAPSHOT');
    }
    if (Date.now() - pool.observedAtMs > this.maxPoolAgeMs) throw new Error('AMM_POOL_SNAPSHOT_STALE');
    if (existing.poolSlot !== undefined && pool.slot < existing.poolSlot) throw new Error('AMM_POOL_SLOT_REGRESSION');
    if (existing.poolAddress && (existing.poolVenue !== pool.venue || existing.poolAddress !== pool.poolAddress ||
        existing.poolQuoteMint !== pool.quoteMint)) throw new Error('AMM_POOL_IDENTITY_CHANGED');

    const now = Date.now();
    const cooldownExpired = now >= existing.sniperCooldownExpiresAtMs;
    const state: GraduatedTokenState = {
      ...existing,
      status: cooldownExpired ? 'AMM_ACTIVE' : 'SNIPER_COOLDOWN',
      poolVenue: pool.venue,
      poolAddress: pool.poolAddress,
      poolQuoteMint: pool.quoteMint,
      initialPoolQuoteReserves: existing.initialPoolQuoteReserves ?? pool.quoteReserves,
      currentPoolQuoteReserves: pool.quoteReserves,
      currentPoolTokenReserves: pool.tokenReserves,
      poolEffectiveFeeBps: pool.effectiveFeeBps,
      poolSlot: pool.slot,
      poolObservedAtMs: pool.observedAtMs,
      poolObservationAttemptedAtMs: pool.observedAtMs,
      poolObservationError: undefined,
      // Do not trust the caller-supplied source string. Only the exact frozen
      // object produced by the canonical RPC reader can authorize an AMM buy.
      poolObservationSource: isCanonicalPumpSwapObservation(pool)
        ? 'CANONICAL_ON_CHAIN_RPC'
        : 'UNVERIFIED_CALLER',
    };
    this.tokens.set(mint, state);
    return state;
  }

  public recordPoolObservationFailure(mint: string, errorCode: string, attemptedAtMs: number = Date.now()): GraduatedTokenState {
    const existing = this.tokens.get(mint);
    if (!existing || existing.status === 'BONDING_CURVE') throw new Error('MIGRATION_NOT_REGISTERED');
    if (!Number.isSafeInteger(attemptedAtMs) || attemptedAtMs <= 0 || attemptedAtMs > Date.now()) {
      throw new Error('INVALID_AMM_OBSERVATION_ATTEMPT_TIME');
    }
    const safeCode = /^[A-Z][A-Z0-9_]{0,79}$/.test(errorCode) ? errorCode : 'PUMP_AMM_RPC_READ_FAILED';
    const state: GraduatedTokenState = {
      ...existing,
      poolObservationAttemptedAtMs: attemptedAtMs,
      poolObservationError: safeCode,
    };
    this.tokens.set(mint, state);
    return state;
  }

  public getObservationSummary(mint: string, nowMs: number = Date.now()): AmmObservationSummary {
    const state = this.tokens.get(mint);
    if (!state) return { status: 'NOT_MIGRATED' };
    let status: AmmObservationSummary['status'];
    if (!state.poolAddress) status = state.poolObservationError ? 'UNAVAILABLE' : 'WAITING';
    else if (state.poolObservationSource !== 'CANONICAL_ON_CHAIN_RPC') status = 'UNVERIFIED';
    else status = this.isPoolSnapshotFresh(state, nowMs) ? 'OBSERVED' : 'STALE';
    return {
      status,
      venue: state.poolVenue,
      poolAddress: state.poolAddress,
      slot: state.poolSlot,
      observedAtMs: state.poolObservedAtMs,
      source: state.poolObservationSource,
      lastAttemptAtMs: state.poolObservationAttemptedAtMs,
      lastError: state.poolObservationError,
    };
  }

  public registerSniperDump(mint: string): void {
    const existing = this.tokens.get(mint);
    if (existing) this.tokens.set(mint, { ...existing, sniperDumpObserved: true });
  }

  public getGraduatedState(mint: string): GraduatedTokenState | undefined {
    const state = this.tokens.get(mint);
    if (!state) return undefined;
    if (state.status === 'SNIPER_COOLDOWN' && Date.now() >= state.sniperCooldownExpiresAtMs) {
      const updated: GraduatedTokenState = { ...state, status: 'AMM_ACTIVE' };
      this.tokens.set(mint, updated);
      return updated;
    }
    return state;
  }

  public isPoolSnapshotFresh(state: GraduatedTokenState, nowMs: number = Date.now()): boolean {
    return Number.isSafeInteger(nowMs) && state.poolObservedAtMs !== undefined &&
      Number.isSafeInteger(state.poolObservedAtMs) && state.poolObservedAtMs > 0 &&
      state.poolObservedAtMs <= nowMs && nowMs - state.poolObservedAtMs <= this.maxPoolAgeMs;
  }

  public canExecuteTrade(
    mint: string,
    side: 'BUY' | 'SELL'
  ): { allowed: boolean; status: GraduationStatus; reason?: string } {
    const state = this.getGraduatedState(mint);
    if (!state) return { allowed: true, status: 'BONDING_CURVE' };
    if (side === 'SELL') return { allowed: true, status: state.status };
    if (state.status === 'MIGRATION_PENDING') return {
      allowed: false, status: state.status, reason: 'Migration in flight; awaiting an observed AMM pool snapshot',
    };
    if (state.status === 'SNIPER_COOLDOWN') {
      const remainingMs = Math.max(0, state.sniperCooldownExpiresAtMs - Date.now());
      return { allowed: false, status: state.status,
        reason: `Sniper stabilization cooldown active (${Math.ceil(remainingMs / 1000)}s remaining)` };
    }
    if (state.status === 'AMM_ACTIVE' || state.status === 'AMM_STABILIZED') {
      if (state.poolObservationSource !== 'CANONICAL_ON_CHAIN_RPC') return {
        allowed: false, status: state.status, reason: 'AMM pool observation is not canonical RPC evidence',
      };
      if (!this.isPoolSnapshotFresh(state)) return { allowed: false, status: state.status, reason: 'AMM pool snapshot is stale or unavailable' };
      if (state.poolQuoteMint !== 'So11111111111111111111111111111111111111112') return {
        allowed: false, status: state.status, reason: 'AMM quote mint is not valued in native SOL',
      };
      const quoteReserves = state.currentPoolQuoteReserves;
      if (quoteReserves === undefined || quoteReserves < this.minAmmQuoteReserves) return {
        allowed: false, status: state.status,
        reason: quoteReserves === undefined
          ? 'AMM quote reserves are unobserved'
          : `AMM quote reserves below safety floor (${quoteReserves} < ${this.minAmmQuoteReserves})`,
      };
      return { allowed: true, status: state.status };
    }
    return { allowed: true, status: state.status };
  }

  public getAllActiveGraduations(): GraduatedTokenState[] {
    return [...this.tokens.values()];
  }
}
