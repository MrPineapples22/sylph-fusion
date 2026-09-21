import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, formatCard, DECK, isHighCard } from '../../src/core/card.ts';
import { makeRational, addRational, subRational, mulRational, divRational, compareRational, rationalToDecimalString } from '../../src/core/rational.ts';
import { getHoldMaskInfo, maskFromIndices, getHeldCards } from '../../src/core/hold_mask.ts';
import { parseHand, formatHand, canonicalizeHand } from '../../src/core/hand.ts';
import { evaluate5Cards } from '../../src/engine_a/evaluator.ts';
import { independentEvaluate5Cards } from '../../src/engine_b/independent_evaluator.ts';

test('Core: Card parsing and formatting', () => {
  const c1 = parseCard('As');
  assert.equal(c1.rank, 12);
  assert.equal(c1.suit, 3);
  assert.equal(formatCard(c1), 'As');
  assert.equal(isHighCard(c1), true);

  const c2 = parseCard('10h');
  assert.equal(c2.rank, 8);
  assert.equal(c2.suit, 2);
  assert.equal(formatCard(c2), 'Th');
  assert.equal(isHighCard(c2), false);

  const c3 = parseCard('2c');
  assert.equal(c3.rank, 0);
  assert.equal(c3.suit, 0);
  assert.equal(isHighCard(c3), false);
});

test('Core: Exact Rational Arithmetic', () => {
  const r1 = makeRational(1n, 2n);
  const r2 = makeRational(1n, 3n);

  const sum = addRational(r1, r2);
  assert.equal(sum.num, 5n);
  assert.equal(sum.den, 6n);

  const diff = subRational(r1, r2);
  assert.equal(diff.num, 1n);
  assert.equal(diff.den, 6n);

  const prod = mulRational(r1, r2);
  assert.equal(prod.num, 1n);
  assert.equal(prod.den, 6n);

  const quot = divRational(r1, r2);
  assert.equal(quot.num, 3n);
  assert.equal(quot.den, 2n);

  assert.equal(compareRational(r1, r2), 1);
  assert.equal(rationalToDecimalString(r1, 2), '0.50');
});

test('Core: Hold Mask Operations', () => {
  const mask = maskFromIndices([0, 1, 4]); // 1 + 2 + 16 = 19
  assert.equal(mask, 19);

  const info = getHoldMaskInfo(mask);
  assert.equal(info.heldCount, 3);
  assert.equal(info.drawCount, 2);

  const hand = parseHand('As Ks Qs Js Ts');
  const held = getHeldCards(hand.cards, mask);
  assert.equal(held.length, 3);
  assert.equal(held[0].symbol, 'As');
  assert.equal(held[1].symbol, 'Ks');
  assert.equal(held[2].symbol, 'Ts');
});

test('Core: Hand parsing and validation', () => {
  const hand = parseHand('Ah Kh Qh Jh Th');
  assert.equal(hand.cards.length, 5);
  assert.equal(formatHand(hand), 'Ah Kh Qh Jh Th');

  // Duplicate card error
  assert.throws(() => {
    parseHand('Ah Ah Qh Jh Th');
  }, /Duplicate card/);
});

test('Core: Evaluator agreement on hand types', () => {
  const testCases: Array<[string, string]> = [
    ['As Ks Qs Js Ts', 'ROYAL_FLUSH'],
    ['9s 8s 7s 6s 5s', 'STRAIGHT_FLUSH'],
    ['5h 4h 3h 2h Ah', 'STRAIGHT_FLUSH'],
    ['Ac Ah As Ad Kh', 'FOUR_OF_A_KIND'],
    ['Kh Kd Kc 8s 8d', 'FULL_HOUSE'],
    ['As Js 8s 4s 2s', 'FLUSH'],
    ['9h 8c 7d 6s 5h', 'STRAIGHT'],
    ['5c 4h 3d 2s Ah', 'STRAIGHT'],
    ['Qc Qd Qs 9h 4d', 'THREE_OF_A_KIND'],
    ['Jc Jd 9s 9h 2c', 'TWO_PAIR'],
    ['Ac Ad 8s 7h 2c', 'JACKS_OR_BETTER'],
    ['Tc Td 8s 7h 2c', 'NOTHING'],
    ['Ah Kd Qs Jh 9c', 'NOTHING'],
  ];

  for (const [cardsStr, expectedCat] of testCases) {
    const hand = parseHand(cardsStr);
    const catA = evaluate5Cards(...hand.cards);
    const catB = independentEvaluate5Cards(...hand.cards);
    assert.equal(catA, expectedCat);
    assert.equal(catB, expectedCat);
  }
});
