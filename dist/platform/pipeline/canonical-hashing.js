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
export function normalizeCanonical(val) {
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
        const sortedObj = Object.create(null);
        const keys = Object.keys(val).sort();
        for (const key of keys) {
            const v = val[key];
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
export function canonicalJson(value) {
    const normalized = normalizeCanonical(value);
    return JSON.stringify(normalized);
}
/**
 * Computes deterministic SHA-256 hex digest of canonical JSON.
 */
export function hashCanonical(value) {
    const json = canonicalJson(value);
    return createHash('sha256').update(json, 'utf8').digest('hex');
}
//# sourceMappingURL=canonical-hashing.js.map