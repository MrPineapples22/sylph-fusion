/**
 * SYLPH FUSION — CANONICALIZATION V10 & CRYPTOGRAPHIC EVIDENCE UTILITY
 * Specifications: Blueprint Sections 27, 28, 29
 *
 * Requirements:
 * 1. Unicode NFC normalization on all strings.
 * 2. Recursive lexicographic object-key ordering.
 * 3. Array element order preservation with canonicalization of elements.
 * 4. JSON-compatible deterministic handling of undefined (omitted from objects, null in arrays).
 * 5. Null preservation.
 * 6. Boolean preservation.
 * 7. Finite numbers only (rejection of NaN, Infinity, -Infinity; normalizes -0 to 0).
 * 8. Deterministic BigInt representation (<val>n).
 * 9. UTF-8 byte serialization.
 * 10. Empty-payload guard: rejects zero-length byte streams and sha256(empty) = e3b0c44298...
 * 11. Full 64-hex SHA-256 digest validation.
 */

import { createHash } from 'node:crypto';

export const EMPTY_SHA256_HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Canonically normalizes an arbitrary value according to Canonicalization V10.
 * @param {unknown} val
 * @param {WeakSet<object>} seen - Circular reference detector
 * @returns {unknown}
 */
export function normalizeCanonicalV10(val, seen = new WeakSet()) {
  if (val === null) {
    return null;
  }
  if (val === undefined) {
    return undefined;
  }
  if (typeof val === 'boolean') {
    return val;
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new Error(`CANONICAL_V10_ERROR: Non-finite number (${val}) rejected`);
    }
    // Normalize -0 to 0
    return Object.is(val, -0) ? 0 : val;
  }
  if (typeof val === 'bigint') {
    return `${val.toString()}n`;
  }
  if (typeof val === 'string') {
    return val.normalize('NFC');
  }
  if (val instanceof Date) {
    if (isNaN(val.getTime())) {
      throw new Error('CANONICAL_V10_ERROR: Invalid Date rejected');
    }
    return val.toISOString();
  }

  if (typeof val === 'object') {
    if (seen.has(val)) {
      throw new Error('CANONICAL_V10_ERROR: Circular reference detected');
    }
    seen.add(val);

    if (Array.isArray(val)) {
      const arr = val.map((elem) => {
        const norm = normalizeCanonicalV10(elem, seen);
        return norm === undefined ? null : norm;
      });
      seen.delete(val);
      return arr;
    }

    if (val instanceof Set) {
      const normalizedItems = Array.from(val).map((item) => normalizeCanonicalV10(item, seen));
      seen.delete(val);
      return normalizedItems.sort((a, b) => {
        const sa = JSON.stringify(a);
        const sb = JSON.stringify(b);
        return sa.localeCompare(sb);
      });
    }

    if (val instanceof Map) {
      const entries = Array.from(val.entries()).map(([k, v]) => [
        normalizeCanonicalV10(k, seen),
        normalizeCanonicalV10(v, seen),
      ]);
      seen.delete(val);
      return entries.sort((a, b) => {
        const sa = JSON.stringify(a[0]);
        const sb = JSON.stringify(b[0]);
        return sa.localeCompare(sb);
      });
    }

    // Normal Object or null-prototype object
    const sortedObj = Object.create(null);
    const keys = Object.keys(val).sort();
    for (const key of keys) {
      const normalizedKey = key.normalize('NFC');
      const propVal = val[key];
      if (propVal !== undefined && typeof propVal !== 'symbol') {
        const normVal = normalizeCanonicalV10(propVal, seen);
        if (normVal !== undefined) {
          sortedObj[normalizedKey] = normVal;
        }
      }
    }
    seen.delete(val);
    return sortedObj;
  }

  throw new Error(`CANONICAL_V10_ERROR: Unsupported type (${typeof val}) cannot be canonically serialized`);
}

/**
 * Deterministically serializes value to canonical JSON string.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJsonV10(value) {
  if (value === undefined) {
    throw new Error('CANONICAL_V10_ERROR: Cannot serialize undefined payload');
  }
  const normalized = normalizeCanonicalV10(value);
  return JSON.stringify(normalized);
}

/**
 * Serializes value to canonical UTF-8 Buffer with empty-payload guard.
 * @param {unknown} value
 * @returns {Buffer}
 */
export function canonicalBytesV10(value) {
  const json = canonicalJsonV10(value);
  const buf = Buffer.from(json, 'utf8');
  if (buf.length === 0) {
    throw new Error('CANONICAL_V10_ERROR: Empty payload rejected (byteLength == 0)');
  }
  return buf;
}

/**
 * Computes deterministic 64-hex SHA-256 with empty-payload guard.
 * @param {unknown} value
 * @returns {string}
 */
export function hashCanonicalV10(value) {
  const buf = canonicalBytesV10(value);
  const digest = createHash('sha256').update(buf).digest('hex');
  if (digest === EMPTY_SHA256_HEX) {
    throw new Error(`CANONICAL_V10_ERROR: Empty-payload digest rejected (${EMPTY_SHA256_HEX})`);
  }
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`CANONICAL_V10_ERROR: Invalid digest format (${digest})`);
  }
  return digest;
}

/**
 * Asserts full 64-hex exact equality between two digests.
 * @param {string} actual
 * @param {string} expected
 * @param {string} [context]
 */
export function assertDigestMatch(actual, expected, context = 'Digest comparison') {
  if (!actual || !expected) {
    throw new Error(`${context}: Empty digest provided (actual: '${actual}', expected: '${expected}')`);
  }
  if (actual.length !== 64 || expected.length !== 64) {
    throw new Error(`${context}: Non-standard 64-hex length (actual: ${actual.length}, expected: ${expected.length})`);
  }
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${context}: Hash mismatch!\nActual:   ${actual}\nExpected: ${expected}`);
  }
}
