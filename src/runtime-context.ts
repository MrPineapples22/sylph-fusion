/**
 * Immutable runtime facts shared across every process composition root.
 * Bootstraps construct this once and inject it; consumers never reread env.
 */
import { createHash, randomUUID } from 'node:crypto';
import { config, type Config } from './config.js';

export type RuntimeMode = 'PAPER' | 'LIVE_BLOCKED';

export interface RuntimeConfigSnapshot {
  readonly schemaVersion: 1;
  readonly runtimeGeneration: string;
  readonly createdAt: number;
  readonly configHash: string;
  readonly mode: RuntimeMode;
  /** Secret-free configuration: safe for projections and execution journals. */
  readonly publicConfig: Readonly<{
    readonly uiPort: number;
    readonly maxPositions: number;
    readonly feedStaleMs: number;
    readonly quoteMaxAgeMs: number;
    readonly riskScanCooldownMs: number;
    readonly rpcTimeoutMs: number;
    readonly pollMs: number;
    readonly maxExposureLamports: number;
    readonly maxDailyLossLamports: number;
    readonly slippageBps: number;
    readonly maxImpactBps: number;
    readonly maxFeeBps: number;
  }>;
}

const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, field) =>
  typeof field === 'bigint' ? field.toString() : field,
);

const toSnapshot = (parsed: Config, now: number, runtimeGeneration: string): RuntimeConfigSnapshot => {
  // A config value must never by itself enable live behavior. That requires a
  // separately reviewed coordinator and current independent evidence.
  const mode: RuntimeMode = parsed.MODE === 'live' ? 'LIVE_BLOCKED' : 'PAPER';
  const publicConfig = Object.freeze({
    uiPort: parsed.UI_PORT,
    maxPositions: parsed.MAX_POSITIONS,
    feedStaleMs: parsed.FEED_STALE_MS,
    quoteMaxAgeMs: parsed.QUOTE_MAX_AGE_MS,
    riskScanCooldownMs: parsed.RISK_SCAN_COOLDOWN_MS,
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
export function createRuntimeContext(env: NodeJS.ProcessEnv, options: {
  readonly now?: number;
  readonly runtimeGeneration?: string;
} = {}): RuntimeConfigSnapshot {
  return toSnapshot(config(env), options.now ?? Date.now(), options.runtimeGeneration ?? randomUUID());
}

/** Every cross-plane join must prove both generation and policy fingerprint. */
export function hasMatchingRuntimeContext(
  left: Pick<RuntimeConfigSnapshot, 'runtimeGeneration' | 'configHash'>,
  right: Pick<RuntimeConfigSnapshot, 'runtimeGeneration' | 'configHash'>,
): boolean {
  return left.runtimeGeneration === right.runtimeGeneration && left.configHash === right.configHash;
}
