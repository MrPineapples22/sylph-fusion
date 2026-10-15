/**
 * SOLARIS-NEXUS: Post-Graduation AMM Bridge
 * Tracks explicitly observed pool state after bonding-curve completion.
 * A completed curve alone does not identify or price its destination venue.
 */
import { isCanonicalPumpSwapObservation } from './pump-swap-pool-reader.js';
export class PostGraduationAmmBridge {
    sniperCooldownMs;
    minAmmQuoteReserves;
    maxPoolAgeMs;
    tokens = new Map();
    constructor(cfg = {}) {
        this.sniperCooldownMs = cfg.sniperCooldownMs ?? 30_000;
        this.minAmmQuoteReserves = cfg.minAmmQuoteReserves ?? 5000000000n;
        this.maxPoolAgeMs = cfg.maxPoolAgeMs ?? 1_000;
        if (!Number.isSafeInteger(this.maxPoolAgeMs) || this.maxPoolAgeMs <= 0 || this.maxPoolAgeMs > 60_000) {
            throw new Error('INVALID_AMM_POOL_FRESHNESS_POLICY');
        }
    }
    registerMigration(mint, slot) {
        if (!mint || !Number.isSafeInteger(slot) || slot <= 0)
            throw new Error('INVALID_MIGRATION_IDENTITY');
        const existing = this.tokens.get(mint);
        if (existing && slot < existing.migrationTriggeredAtSlot)
            throw new Error('MIGRATION_SLOT_REGRESSION');
        // Market snapshots repeatedly observe the same completed curve at newer
        // slots. Preserve the first migration boundary, cooldown and any pool data.
        if (existing)
            return existing;
        const now = Date.now();
        const state = {
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
    registerAmmPool(mint, pool) {
        const existing = this.tokens.get(mint);
        if (!existing || existing.status === 'BONDING_CURVE')
            throw new Error('MIGRATION_NOT_REGISTERED');
        if (!pool || !pool.venue || !pool.source || !pool.poolAddress || !pool.quoteMint ||
            typeof pool.quoteReserves !== 'bigint' || pool.quoteReserves <= 0n ||
            typeof pool.tokenReserves !== 'bigint' || pool.tokenReserves <= 0n ||
            !Number.isInteger(pool.effectiveFeeBps) || pool.effectiveFeeBps < 0 || pool.effectiveFeeBps >= 10_000 ||
            !Number.isSafeInteger(pool.slot) || pool.slot < existing.migrationTriggeredAtSlot ||
            !Number.isSafeInteger(pool.observedAtMs) || pool.observedAtMs <= 0 || pool.observedAtMs > Date.now()) {
            throw new Error('INVALID_AMM_POOL_SNAPSHOT');
        }
        if (Date.now() - pool.observedAtMs > this.maxPoolAgeMs)
            throw new Error('AMM_POOL_SNAPSHOT_STALE');
        if (existing.poolSlot !== undefined && pool.slot < existing.poolSlot)
            throw new Error('AMM_POOL_SLOT_REGRESSION');
        if (existing.poolAddress && (existing.poolVenue !== pool.venue || existing.poolAddress !== pool.poolAddress ||
            existing.poolQuoteMint !== pool.quoteMint))
            throw new Error('AMM_POOL_IDENTITY_CHANGED');
        const now = Date.now();
        const cooldownExpired = now >= existing.sniperCooldownExpiresAtMs;
        const state = {
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
            // Do not trust the caller-supplied source string. Only the exact frozen
            // object produced by the canonical RPC reader can authorize an AMM buy.
            poolObservationSource: isCanonicalPumpSwapObservation(pool)
                ? 'CANONICAL_ON_CHAIN_RPC'
                : 'UNVERIFIED_CALLER',
        };
        this.tokens.set(mint, state);
        return state;
    }
    registerSniperDump(mint) {
        const existing = this.tokens.get(mint);
        if (existing)
            this.tokens.set(mint, { ...existing, sniperDumpObserved: true });
    }
    getGraduatedState(mint) {
        const state = this.tokens.get(mint);
        if (!state)
            return undefined;
        if (state.status === 'SNIPER_COOLDOWN' && Date.now() >= state.sniperCooldownExpiresAtMs) {
            const updated = { ...state, status: 'AMM_ACTIVE' };
            this.tokens.set(mint, updated);
            return updated;
        }
        return state;
    }
    isPoolSnapshotFresh(state, nowMs = Date.now()) {
        return Number.isSafeInteger(nowMs) && state.poolObservedAtMs !== undefined &&
            Number.isSafeInteger(state.poolObservedAtMs) && state.poolObservedAtMs > 0 &&
            state.poolObservedAtMs <= nowMs && nowMs - state.poolObservedAtMs <= this.maxPoolAgeMs;
    }
    canExecuteTrade(mint, side) {
        const state = this.getGraduatedState(mint);
        if (!state)
            return { allowed: true, status: 'BONDING_CURVE' };
        if (side === 'SELL')
            return { allowed: true, status: state.status };
        if (state.status === 'MIGRATION_PENDING')
            return {
                allowed: false, status: state.status, reason: 'Migration in flight; awaiting an observed AMM pool snapshot',
            };
        if (state.status === 'SNIPER_COOLDOWN') {
            const remainingMs = Math.max(0, state.sniperCooldownExpiresAtMs - Date.now());
            return { allowed: false, status: state.status,
                reason: `Sniper stabilization cooldown active (${Math.ceil(remainingMs / 1000)}s remaining)` };
        }
        if (state.status === 'AMM_ACTIVE' || state.status === 'AMM_STABILIZED') {
            if (state.poolObservationSource !== 'CANONICAL_ON_CHAIN_RPC')
                return {
                    allowed: false, status: state.status, reason: 'AMM pool observation is not canonical RPC evidence',
                };
            if (!this.isPoolSnapshotFresh(state))
                return { allowed: false, status: state.status, reason: 'AMM pool snapshot is stale or unavailable' };
            if (state.poolQuoteMint !== 'So11111111111111111111111111111111111111112')
                return {
                    allowed: false, status: state.status, reason: 'AMM quote mint is not valued in native SOL',
                };
            const quoteReserves = state.currentPoolQuoteReserves;
            if (quoteReserves === undefined || quoteReserves < this.minAmmQuoteReserves)
                return {
                    allowed: false, status: state.status,
                    reason: quoteReserves === undefined
                        ? 'AMM quote reserves are unobserved'
                        : `AMM quote reserves below safety floor (${quoteReserves} < ${this.minAmmQuoteReserves})`,
                };
            return { allowed: true, status: state.status };
        }
        return { allowed: true, status: state.status };
    }
    getAllActiveGraduations() {
        return [...this.tokens.values()];
    }
}
//# sourceMappingURL=amm-bridge.js.map