/**
 * Immutable runtime facts shared across every process composition root.
 * Bootstraps construct this once and inject it; consumers never reread env.
 */
import { createHash, randomUUID } from 'node:crypto';
import { config } from './config.js';
const canonicalJson = (value) => JSON.stringify(value, (_key, field) => typeof field === 'bigint' ? field.toString() : field);
const toSnapshot = (parsed, now, runtimeGeneration) => {
    // A config value must never by itself enable live behavior. That requires a
    // separately reviewed coordinator and current independent evidence.
    const mode = parsed.MODE === 'live' ? 'LIVE_BLOCKED' : 'PAPER';
    const publicConfig = Object.freeze({
        uiPort: parsed.UI_PORT,
        maxPositions: parsed.MAX_POSITIONS,
        feedStaleMs: parsed.FEED_STALE_MS,
        quoteMaxAgeMs: parsed.QUOTE_MAX_AGE_MS,
        rpcTimeoutMs: parsed.RPC_TIMEOUT_MS,
        pollMs: parsed.POLL_MS,
        maxExposureLamports: parsed.MAX_EXPOSURE_LAMPORTS,
        maxDailyLossLamports: parsed.MAX_DAILY_LOSS_LAMPORTS,
        slippageBps: parsed.SLIPPAGE_BPS,
        maxImpactBps: parsed.MAX_IMPACT_BPS,
        maxFeeBps: parsed.MAX_FEE_BPS,
    });
    const configHash = createHash('sha256').update(canonicalJson({ mode, publicConfig })).digest('hex');
    return Object.freeze({ schemaVersion: 1, runtimeGeneration, createdAt: now, configHash, mode, publicConfig });
};
/** Construct once at process bootstrap; no mutable update API is exposed. */
export function createRuntimeContext(env, options = {}) {
    return toSnapshot(config(env), options.now ?? Date.now(), options.runtimeGeneration ?? randomUUID());
}
/** Every cross-plane join must prove both generation and policy fingerprint. */
export function hasMatchingRuntimeContext(left, right) {
    return left.runtimeGeneration === right.runtimeGeneration && left.configHash === right.configHash;
}
//# sourceMappingURL=runtime-context.js.map