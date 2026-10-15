import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedSolTipFloorToLamports, solTipFloorToLamports } from '../../dist/platform/execution/jito-tip-floor.js';

test('Jito decimal SOL tip floor converts to lamports with exact ceiling', () => {
  assert.equal(solTipFloorToLamports(0), 0n);
  assert.equal(solTipFloorToLamports(0.000000001), 1n);
  assert.equal(solTipFloorToLamports(0.0000000011), 2n);
  assert.equal(solTipFloorToLamports(0.0000000001), 1n);
  assert.equal(solTipFloorToLamports(0.000001), 1_000n);
  assert.equal(solTipFloorToLamports(1.25), 1_250_000_000n);
});

test('Jito tip-floor parser rejects malformed or negative API values', () => {
  for (const value of [null, undefined, '0.1', NaN, Infinity, -0.1]) {
    assert.equal(solTipFloorToLamports(value), null);
  }
});

test('Jito tip-floor estimate is bounded by the configured maximum', () => {
  assert.equal(boundedSolTipFloorToLamports(1, 10_000_000), 10_000_000n);
  assert.equal(boundedSolTipFloorToLamports(0.001, 10_000_000), 1_000_000n);
  assert.equal(boundedSolTipFloorToLamports(1, -1), null);
});
