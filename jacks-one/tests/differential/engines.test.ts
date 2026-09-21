import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHand } from '../../src/core/hand.ts';
import { runDifferentialCheck } from '../../src/verification/differential.ts';

test('Differential: Engine A and Engine B agreement across canonical hands', () => {
  const handsToTest = [
    'As Ks Qs Js 9c', // 4 to Royal vs High Cards
    'Kh Kd 8s 8d 2c', // Two Pair
    '4h 4d 8d 7d 2d', // Low pair vs 4 to a Flush
    '9s 8h 7c 6d 2s', // 4 to open-ended straight
    '2c 4d 6h 8s Tc', // Garbage hand (Hold 0)
  ];

  for (const handStr of handsToTest) {
    const hand = parseHand(handStr);
    const report = runDifferentialCheck(hand);
    assert.equal(report.fullAgreement, true, `Differential failure on ${handStr}: ${JSON.stringify(report.holdDifferences)}`);
  }
});
