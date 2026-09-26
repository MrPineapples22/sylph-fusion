import { createHash } from 'node:crypto';
import { PointInTimeFeatureStore } from '../truth/feature-store.js';
import type { AstraFeatureContext, FeatureDefinition, FeatureName, FeatureObservation } from './contracts.js';

export const FEATURE_SCHEMA = 'astra-features-1';
const define = (name: FeatureName, unit: string, windowMs: number, formula: string,
  minimum: number, maximum: number, freshnessLimitMs = 5000): FeatureDefinition =>
  Object.freeze({ name, type: 'number', unit, windowMs, formula, minimum, maximum,
    freshnessLimitMs, version: FEATURE_SCHEMA, missingPolicy: 'UNKNOWN' });
export const FEATURE_DEFINITIONS: Readonly<Record<FeatureName, FeatureDefinition>> = Object.freeze({
  price_velocity: define('price_velocity', 'fraction/second', 10000, '(price_end / price_start - 1) / elapsed_seconds', -1, 100),
  price_acceleration: define('price_acceleration', 'fraction/second^2', 10000, 'change in price_velocity / elapsed_seconds', -100, 100),
  buy_sell_ratio: define('buy_sell_ratio', 'ratio', 10000, 'verified buy_count / verified sell_count; undefined when denominator zero', 0, 1000),
  liquidity: define('liquidity', 'USD', 0, 'provider reported liquidity USD; not executable depth', 0, 1e15),
  market_cap: define('market_cap', 'USD', 0, 'provider reported market capitalization USD', 0, 1e16),
  liquidity_velocity: define('liquidity_velocity', 'fraction/second', 10000, '(liquidity_end / liquidity_start - 1) / elapsed_seconds', -1, 100),
  wallet_concentration: define('wallet_concentration', 'fraction', 0, 'top ten owner raw balances / verified circulating supply', 0, 1, 45000),
  unique_buyers: define('unique_buyers', 'wallets', 10000, 'distinct verified buyer public keys in window', 0, 1e7),
  first_buyer_quality: define('first_buyer_quality', 'fraction', 10000, 'validated first-buyer quality adapter output', 0, 1),
  bundle_rate: define('bundle_rate', 'fraction', 10000, 'verified bundled transactions / covered transactions', 0, 1),
  wash_ratio: define('wash_ratio', 'fraction', 10000, 'verified circular-volume units / covered volume units', 0, 1),
  rug_score: define('rug_score', 'fraction', 0, 'validated risk adapter score with explicit normalized scale', 0, 1, 45000),
  dev_concentration: define('dev_concentration', 'fraction', 0, 'verified developer-linked balances / supply', 0, 1, 45000),
  volatility: define('volatility', 'fraction', 30000, 'standard deviation of covered one-second returns', 0, 10),
  provider_error_rate: define('provider_error_rate', 'fraction', 60000, 'failed requests / completed requests in measured window', 0, 1),
  provider_slot_lag: define('provider_slot_lag', 'slots', 0, 'independent reference finalized slot minus provider finalized slot', 0, 1e7),
});

export function observationIssue(value: FeatureObservation, now: number): string | null {
  const spec = FEATURE_DEFINITIONS[value?.name];
  if (!spec) return 'UNKNOWN_FEATURE';
  if (!value.evidenceId || !value.source || !value.correlationGroup) return 'MISSING_PROVENANCE';
  if (value.unit !== spec.unit || value.windowMs !== spec.windowMs) return 'SCHEMA_MISMATCH';
  if (!Number.isFinite(value.observedAt) || value.observedAt <= 0 || !Number.isFinite(value.availableAt) ||
      value.availableAt < value.observedAt || value.availableAt > now) return 'INVALID_TIME';
  if (typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value < spec.minimum || value.value > spec.maximum) return 'INVALID_VALUE';
  if ((spec.unit === 'wallets' || spec.unit === 'slots') && !Number.isSafeInteger(value.value)) return 'INVALID_INTEGER';
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 || typeof value.conflict !== 'boolean') return 'INVALID_QUALITY';
  if (now - value.observedAt > spec.freshnessLimitMs) return 'STALE';
  if (value.conflict) return 'SOURCE_CONFLICT';
  return null;
}

/** Adapter into the existing point-in-time store, not a second feature authority. */
export class AstraFeatureAdapter {
  constructor(readonly store = new PointInTimeFeatureStore()) {}
  capture(mint: string, input: readonly FeatureObservation[], now = Date.now(), slot: number | null = null): AstraFeatureContext {
    if (!mint || !Number.isSafeInteger(now) || now <= 0 || slot !== null && (!Number.isSafeInteger(slot) || slot < 0)) throw new Error('Invalid snapshot identity/time');
    const observations: Partial<Record<FeatureName, FeatureObservation>> = {};
    const rejected: string[] = [];
    const duplicates = new Set<FeatureName>();
    for (const raw of input) {
      if (!raw || !FEATURE_DEFINITIONS[raw.name]) { rejected.push('UNKNOWN_FEATURE'); continue; }
      if (observations[raw.name] || duplicates.has(raw.name)) {
        delete observations[raw.name]; duplicates.add(raw.name); rejected.push(`${raw.name}:DUPLICATE_INPUT`); continue;
      }
      const copy = Object.freeze({ ...raw });
      observations[raw.name] = copy;
      const issue = observationIssue(copy, now);
      if (issue) rejected.push(`${raw.name}:${issue}`);
    }
    const ordered = Object.values(observations).sort((a,b) => a.name.localeCompare(b.name));
    const features: Record<string, number | string | boolean> = {
      '$evidence': JSON.stringify(ordered), '$rejected': JSON.stringify([...new Set(rejected)].sort()), '$slotKnown': slot !== null,
    };
    for (const value of ordered) if (!observationIssue(value, now)) features[value.name] = value.value!;
    const digest = createHash('sha256').update(JSON.stringify([mint, slot, now, features])).digest('hex');
    const valid = ordered.filter(x => !observationIssue(x, now));
    const snapshot = this.store.recordSnapshot({ snapshotId: `astra:${digest}`, mint, slot: slot ?? 0,
      timestampMs: now, tokenAgeSeconds: 0, featureSchemaVersion: FEATURE_SCHEMA, features,
      dataQualityScore: valid.length / Object.keys(FEATURE_DEFINITIONS).length,
      freshnessMs: valid.length ? Math.max(...valid.map(x => now-x.observedAt)) : 0 });
    return Object.freeze({snapshot, observations: Object.freeze(observations), rejected: Object.freeze([...new Set(rejected)])});
  }
}
