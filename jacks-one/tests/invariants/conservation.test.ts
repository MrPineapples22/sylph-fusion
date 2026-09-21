import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHand } from '../../src/core/hand.ts';
import { verifyDenominatorConservation, verifyCardOrderInvariance, verifySuitIsomorphismInvariance } from '../../src/verification/invariants.ts';

test('Invariants: Denominator and Probability Conservation', () => {
  const hand = parseHand('Kh Qd Jc Ts 9h');
  const results = verifyDenominatorConservation(hand);
  for (const res of results) {
    assert.equal(res.passed, true, `Failed invariant ${res.invariant}: ${res.details}`);
  }
});

test('Invariants: Card Order Invariance', () => {
  const hand = parseHand('As Ks Qs Js 9c');
  const result = verifyCardOrderInvariance(hand);
  assert.equal(result.passed, true, result.details);
});

test('Invariants: Suit Isomorphism Invariance', () => {
  const hand = parseHand('Ah Kh Qh Jh 9c');
  const result = verifySuitIsomorphismInvariance(hand);
  assert.equal(result.passed, true, result.details);
});
