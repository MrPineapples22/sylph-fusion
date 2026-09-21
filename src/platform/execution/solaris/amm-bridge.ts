/**
 * SOLARIS-NEXUS: Post-Graduation AMM Bridge
 * Manages token lifecycle after 100% bonding curve completion (~85 SOL),
 * tracking Raydium migration and enforcing a 30-second sniper stabilization cooldown.
 */

import { GraduatedTokenState, GraduationStatus } from './types.js';

export interface AmmBridgeConfig {
  readonly sniperCooldownMs?: number;
  readonly minRaydiumSolReserves?: bigint;
}

export class PostGraduationAmmBridge {
  private readonly sniperCooldownMs: number;
  private readonly minRaydiumSolReserves: bigint;
  private tokens = new Map<string, GraduatedTokenState>();

  constructor(cfg: AmmBridgeConfig = {}) {
    this.sniperCooldownMs = cfg.sniperCooldownMs ?? 30_000; // 30-second sniper dump cooldown
    this.minRaydiumSolReserves = cfg.minRaydiumSolReserves ?? 5_000_000_000n; // 5 SOL minimum pool
  }

  public registerMigration(
    mint: string,
    slot: number,
    initialSolReserves = 85_000_000_000n
  ): GraduatedTokenState {
    const now = Date.now();
    const existing = this.tokens.get(mint);

    const state: GraduatedTokenState = {
      mint,
      status: 'MIGRATION_PENDING',
      migrationTriggeredAtSlot: slot,
      migrationTriggeredAtMs: now,
      sniperCooldownExpiresAtMs: now + this.sniperCooldownMs,
      initialPoolSolLamports: initialSolReserves,
      currentPoolSolLamports: initialSolReserves,
      sniperDumpObserved: false,
      raydiumPoolAddress: existing?.raydiumPoolAddress,
    };

    this.tokens.set(mint, state);
    return state;
  }

  public registerRaydiumPool(
    mint: string,
    poolAddress: string,
    poolSolReserves: bigint
  ): GraduatedTokenState {
    const existing = this.tokens.get(mint);
    const now = Date.now();

    const cooldownExpired = existing
      ? now >= existing.sniperCooldownExpiresAtMs
      : false;

    const status: GraduationStatus = cooldownExpired ? 'RAYDIUM_ACTIVE' : 'SNIPER_COOLDOWN';

    const state: GraduatedTokenState = {
      mint,
      status,
      migrationTriggeredAtSlot: existing?.migrationTriggeredAtSlot ?? 0,
      migrationTriggeredAtMs: existing?.migrationTriggeredAtMs ?? now,
      sniperCooldownExpiresAtMs: existing?.sniperCooldownExpiresAtMs ?? (now + this.sniperCooldownMs),
      raydiumPoolAddress: poolAddress,
      initialPoolSolLamports: existing?.initialPoolSolLamports ?? poolSolReserves,
      currentPoolSolLamports: poolSolReserves,
      sniperDumpObserved: existing?.sniperDumpObserved ?? false,
    };

    this.tokens.set(mint, state);
    return state;
  }

  public registerSniperDump(mint: string): void {
    const existing = this.tokens.get(mint);
    if (existing) {
      this.tokens.set(mint, {
        ...existing,
        sniperDumpObserved: true,
      });
    }
  }

  public getGraduatedState(mint: string): GraduatedTokenState | undefined {
    const state = this.tokens.get(mint);
    if (!state) return undefined;

    // Dynamically check if cooldown has elapsed
    if (state.status === 'SNIPER_COOLDOWN' && Date.now() >= state.sniperCooldownExpiresAtMs) {
      const updated: GraduatedTokenState = {
        ...state,
        status: 'RAYDIUM_ACTIVE',
      };
      this.tokens.set(mint, updated);
      return updated;
    }

    return state;
  }

  public canExecuteTrade(
    mint: string,
    side: 'BUY' | 'SELL'
  ): { allowed: boolean; status: GraduationStatus; reason?: string } {
    const state = this.getGraduatedState(mint);
    if (!state) {
      return { allowed: true, status: 'BONDING_CURVE' };
    }

    // Exits (SELL) are ALWAYS permitted to prevent trapped capital
    if (side === 'SELL') {
      return { allowed: true, status: state.status };
    }

    // Buys must respect graduation progression
    if (state.status === 'MIGRATION_PENDING') {
      return {
        allowed: false,
        status: state.status,
        reason: 'Migration in flight; awaiting Raydium pool initialization',
      };
    }

    if (state.status === 'SNIPER_COOLDOWN') {
      const remainingMs = Math.max(0, state.sniperCooldownExpiresAtMs - Date.now());
      return {
        allowed: false,
        status: state.status,
        reason: `Sniper stabilization cooldown active (${Math.ceil(remainingMs / 1000)}s remaining)`,
      };
    }

    if (state.status === 'RAYDIUM_ACTIVE' || state.status === 'AMM_STABILIZED') {
      if (
        state.currentPoolSolLamports !== undefined &&
        state.currentPoolSolLamports < this.minRaydiumSolReserves
      ) {
        return {
          allowed: false,
          status: state.status,
          reason: `Raydium pool reserves below safety floor (${state.currentPoolSolLamports} < ${this.minRaydiumSolReserves})`,
        };
      }
      return { allowed: true, status: state.status };
    }

    return { allowed: true, status: state.status };
  }

  public getAllActiveGraduations(): GraduatedTokenState[] {
    return [...this.tokens.values()];
  }
}
