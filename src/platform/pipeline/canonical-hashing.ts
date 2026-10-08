/**
 * SYLPH FUSION — CANONICAL SERIALIZATION & HASHING
 * Specification: Prompt 4
 *
 * Requirements:
 * 1. Object key order must not affect hashes (keys sorted recursively).
 * 2. bigint must serialize deterministically (no JSON.stringify runtime crash).
 * 3. undefined fields must not cause nondeterministic representations (normalized/omitted).
 * 4. Arrays must retain semantic order.
 * 5. Roots must use SHA-256 unless another canonical hash is specified.
 * 6. Live and replay must generate identical roots from identical input.
 */

import { createHash } from 'node:crypto';

/**
 * Normalizes an arbitrary value for deterministic serialization.
 * - Objects have keys sorted lexicographically.
 * - bigint is serialized as `<val>n`.
 * - undefined properties are omitted from objects.
 * - Arrays retain element order with each element normalized.
 * - Dates serialize as ISO strings.
 * - Sets serialize as sorted arrays.
 * - Maps serialize as sorted key-value tuples.
 */
export function normalizeCanonical(val: unknown): unknown {
  if (val === null || val === undefined) {
    return val;
  }
  if (typeof val === 'bigint') {
    return `${val.toString()}n`;
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new Error(`CANONICAL_SERIALIZE_ERROR: Non-finite number ${val} cannot be canonically serialized`);
    }
    return val;
  }
  if (typeof val === 'string' || typeof val === 'boolean') {
    return val;
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (val instanceof Set) {
    const arr = Array.from(val).map(normalizeCanonical);
    return arr.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (val instanceof Map) {
    const entries = Array.from(val.entries()).map(([k, v]) => [
      normalizeCanonical(k),
      normalizeCanonical(v),
    ]);
    return entries.sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])));
  }
  if (Array.isArray(val)) {
    return val.map(normalizeCanonical);
  }
  if (typeof val === 'object') {
    // A null-prototype map preserves an own `__proto__` JSON property as data
    // instead of invoking Object.prototype's legacy prototype setter.
    const sortedObj = Object.create(null) as Record<string, unknown>;
    const keys = Object.keys(val as Record<string, unknown>).sort();
    for (const key of keys) {
      const v = (val as Record<string, unknown>)[key];
      if (v !== undefined) {
        sortedObj[key] = normalizeCanonical(v);
      }
    }
    return sortedObj;
  }
  return String(val);
}

/**
 * Deterministic JSON string representation of any value.
 * Key order is guaranteed to be lexicographical.
 * BigInt values are safely encoded.
 */
export function canonicalJson(value: unknown): string {
  const normalized = normalizeCanonical(value);
  return JSON.stringify(normalized);
}

/**
 * Computes deterministic SHA-256 hex digest of canonical JSON.
 */
export function hashCanonical(value: unknown): string {
  const json = canonicalJson(value);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/** Canonicalization V10 for signed runtime telemetry JSON trees: NFC-normalized
 * strings and keys, finite JSON numbers, sorted object keys, and array-order preservation. */
export function hashCanonicalV10(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown, inArray = false): unknown => {
    if (input === null) return null;
    if (input === undefined) return inArray ? null : undefined;
    if (typeof input === 'string') return input.normalize('NFC');
    if (typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error('CANONICAL_V10_ERROR: Non-finite number rejected');
      return Object.is(input, -0) ? 0 : input;
    }
    if (typeof input === 'bigint') return `${input}n`;
    if (input instanceof Date) {
      if (!Number.isFinite(input.getTime())) throw new Error('CANONICAL_V10_ERROR: Invalid Date rejected');
      return input.toISOString();
    }
    if (typeof input !== 'object') throw new Error(`CANONICAL_V10_ERROR: Unsupported ${typeof input}`);
    if (seen.has(input)) throw new Error('CANONICAL_V10_ERROR: Circular reference detected');
    seen.add(input);
    try {
      if (Array.isArray(input)) return input.map(item => normalize(item, true));
      const result = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(input).sort()) {
        const normalized = normalize((input as Record<string, unknown>)[key]);
        if (normalized !== undefined) result[key.normalize('NFC')] = normalized;
      }
      return result;
    } finally { seen.delete(input); }
  };
  const json = JSON.stringify(normalize(value));
  if (json === undefined || json.length === 0) throw new Error('CANONICAL_V10_ERROR: Empty payload rejected');
  return createHash('sha256').update(json, 'utf8').digest('hex');
}
