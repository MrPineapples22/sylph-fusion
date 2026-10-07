import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCanonicalV10,
  canonicalJsonV10,
  canonicalBytesV10,
  hashCanonicalV10,
  assertDigestMatch,
  EMPTY_SHA256_HEX,
} from '../scripts/canonicalization-v10.mjs';

test('Canonicalization V10: Unicode NFC normalization', () => {
  const decomposed = 'e\u0301'; // 'e' + combining acute accent
  const composed = '\u00e9';   // 'é' precomposed

  assert.notEqual(decomposed, composed);
  assert.equal(decomposed.length, 2);
  assert.equal(composed.length, 1);

  const json1 = canonicalJsonV10({ text: decomposed });
  const json2 = canonicalJsonV10({ text: composed });

  assert.equal(json1, json2);
  assert.equal(hashCanonicalV10({ text: decomposed }), hashCanonicalV10({ text: composed }));
});

test('Canonicalization V10: Recursive lexicographic key ordering', () => {
  const obj1 = { z: 1, b: { y: 2, x: 3 }, a: 4 };
  const obj2 = { a: 4, b: { x: 3, y: 2 }, z: 1 };

  const json1 = canonicalJsonV10(obj1);
  const json2 = canonicalJsonV10(obj2);

  assert.equal(json1, '{"a":4,"b":{"x":3,"y":2},"z":1}');
  assert.equal(json1, json2);
  assert.equal(hashCanonicalV10(obj1), hashCanonicalV10(obj2));
});

test('Canonicalization V10: Array order preservation', () => {
  const arr1 = [3, 1, 2];
  const arr2 = [1, 2, 3];

  assert.notEqual(canonicalJsonV10(arr1), canonicalJsonV10(arr2));
  assert.equal(canonicalJsonV10(arr1), '[3,1,2]');
});

test('Canonicalization V10: Undefined handling', () => {
  const objWithUndef = { a: 1, b: undefined, c: 2 };
  assert.equal(canonicalJsonV10(objWithUndef), '{"a":1,"c":2}');

  const arrWithUndef = [1, undefined, 3];
  assert.equal(canonicalJsonV10(arrWithUndef), '[1,null,3]');
});

test('Canonicalization V10: Non-finite number rejection', () => {
  assert.throws(() => canonicalJsonV10({ val: NaN }), /CANONICAL_V10_ERROR: Non-finite/);
  assert.throws(() => canonicalJsonV10({ val: Infinity }), /CANONICAL_V10_ERROR: Non-finite/);
  assert.throws(() => canonicalJsonV10({ val: -Infinity }), /CANONICAL_V10_ERROR: Non-finite/);
});

test('Canonicalization V10: Negative zero normalized to zero', () => {
  assert.equal(canonicalJsonV10({ val: -0 }), '{"val":0}');
  assert.equal(hashCanonicalV10({ val: -0 }), hashCanonicalV10({ val: 0 }));
});

test('Canonicalization V10: Empty payload guard', () => {
  assert.throws(() => canonicalJsonV10(undefined), /Cannot serialize undefined/);
  assert.throws(() => canonicalBytesV10(undefined), /Cannot serialize undefined/);
  assert.throws(() => hashCanonicalV10(undefined), /Cannot serialize undefined/);
});

test('Canonicalization V10: Digest validation and exact 64-hex', () => {
  const hash = hashCanonicalV10({ test: 'payload' });
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, EMPTY_SHA256_HEX);

  assert.doesNotThrow(() => assertDigestMatch(hash, hash));
  assert.throws(() => assertDigestMatch(hash, hash.slice(0, 32)), /Non-standard 64-hex length/);
  assert.throws(() => assertDigestMatch(hash, '0'.repeat(64)), /Hash mismatch/);
});
