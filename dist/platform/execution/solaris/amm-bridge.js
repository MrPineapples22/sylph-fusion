/**
 * SOLARIS-NEXUS: Post-Graduation AMM Bridge
 * Manages token lifecycle after 100% bonding curve completion (~85 SOL),
 * tracking Raydium migration and enforcing a 30-second sniper stabilization cooldown.
 */
export class PostGraduationAmmBridge {
    sniperCooldownMs;
    minRaydiumSolReserves;
    tokens = new Map();
    constructor(cfg = {}) {
        this.sniperCooldownMs = cfg.sniperCooldownMs ?? 30_000; // 30-second sniper dump cooldown
        this.minRaydiumSolReserves = cfg.minRaydiumSolReserves ?? 5000000000n; // 5 SOL minimum pool
    }
    registerMigration(mint, slot, initialSolReserves = 85000000000n) {
        const now = Date.now();
        const existing = this.tokens.get(mint);
        const state = {
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
    registerRaydiumPool(mint, poolAddress, poolSolReserves) {
        const existing = this.tokens.get(mint);
        const now = Date.now();
        const cooldownExpired = existing
            ? now >= existing.sniperCooldownExpiresAtMs
            : false;
        const status = cooldownExpired ? 'RAYDIUM_ACTIVE' : 'SNIPER_COOLDOWN';
        const state = {
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
    registerSniperDump(mint) {
        const existing = this.tokens.get(mint);
        if (existing) {
            this.tokens.set(mint, {
                ...existing,
                sniperDumpObserved: true,
            });
        }
    }
    getGraduatedState(mint) {
        const state = this.tokens.get(mint);
        if (!state)
            return undefined;
        // Dynamically check if cooldown has elapsed
        if (state.status === 'SNIPER_COOLDOWN' && Date.now() >= state.sniperCooldownExpiresAtMs) {
            const updated = {
                ...state,
                status: 'RAYDIUM_ACTIVE',
            };
            this.tokens.set(mint, updated);
            return updated;
        }
        return state;
    }
    canExecuteTrade(mint, side) {
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
            if (state.currentPoolSolLamports !== undefined &&
                state.currentPoolSolLamports < this.minRaydiumSolReserves) {
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
    getAllActiveGraduations() {
        return [...this.tokens.values()];
    }
}
//# sourceMappingURL=amm-bridge.js.map