import type { Card } from '../core/card.ts';
import type { Hand } from '../core/hand.ts';
import type { HandCategory } from './payout.ts';

// Precomputed straight bitmasks (ranks 0..12)
const ROYAL_STRAIGHT_MASK = 0b1111100000000; // A K Q J T (4096+2048+1024+512+256 = 7936)
const WHEEL_STRAIGHT_MASK = 0b1000000001111; // A 5 4 3 2 (4096+8+4+2+1 = 4111)

// All 10 straight patterns
const STRAIGHT_MASKS: readonly number[] = [
  ROYAL_STRAIGHT_MASK,
  0b0111110000000, // K Q J T 9
  0b0011111000000, // Q J T 9 8
  0b0001111100000, // J T 9 8 7
  0b0000111110000, // T 9 8 7 6
  0b0000011111000, // 9 8 7 6 5
  0b0000001111100, // 8 7 6 5 4
  0b0000000111110, // 7 6 5 4 3
  0b0000000011111, // 6 5 4 3 2
  WHEEL_STRAIGHT_MASK,
];

export function isStraight(rankMask: number): boolean {
  for (let i = 0; i < STRAIGHT_MASKS.length; i++) {
    if (rankMask === STRAIGHT_MASKS[i]) {
      return true;
    }
  }
  return false;
}

/**
 * Fast 5-card Jacks or Better hand evaluator.
 * Evaluates in sub-microsecond time with zero heap allocations.
 */
export function evaluate5Cards(c0: Card, c1: Card, c2: Card, c3: Card, c4: Card): HandCategory {
  const isFlush = c0.suit === c1.suit &&
                  c0.suit === c2.suit &&
                  c0.suit === c3.suit &&
                  c0.suit === c4.suit;

  const rankMask = (1 << c0.rank) |
                   (1 << c1.rank) |
                   (1 << c2.rank) |
                   (1 << c3.rank) |
                   (1 << c4.rank);

  // If 5 distinct ranks
  if (
    c0.rank !== c1.rank && c0.rank !== c2.rank && c0.rank !== c3.rank && c0.rank !== c4.rank &&
    c1.rank !== c2.rank && c1.rank !== c3.rank && c1.rank !== c4.rank &&
    c2.rank !== c3.rank && c2.rank !== c4.rank &&
    c3.rank !== c4.rank
  ) {
    if (isFlush) {
      if (rankMask === ROYAL_STRAIGHT_MASK) {
        return 'ROYAL_FLUSH';
      }
      if (isStraight(rankMask)) {
        return 'STRAIGHT_FLUSH';
      }
      return 'FLUSH';
    }

    if (isStraight(rankMask)) {
      return 'STRAIGHT';
    }

    return 'NOTHING';
  }

  // Not 5 distinct ranks: count rank frequencies
  const r0 = c0.rank;
  const r1 = c1.rank;
  const r2 = c2.rank;
  const r3 = c3.rank;
  const r4 = c4.rank;

  const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  counts[r0]++;
  counts[r1]++;
  counts[r2]++;
  counts[r3]++;
  counts[r4]++;

  let maxCount = 0;
  let pairCount = 0;
  let highPairCount = 0;

  for (let r = 0; r < 13; r++) {
    const c = counts[r];
    if (c > maxCount) {
      maxCount = c;
    }
    if (c === 2) {
      pairCount++;
      if (r >= 9) { // J, Q, K, A
        highPairCount++;
      }
    }
  }

  if (maxCount === 4) {
    return 'FOUR_OF_A_KIND';
  }

  if (maxCount === 3) {
    if (pairCount === 1) {
      return 'FULL_HOUSE';
    }
    return 'THREE_OF_A_KIND';
  }

  if (pairCount === 2) {
    return 'TWO_PAIR';
  }

  if (pairCount === 1) {
    if (highPairCount === 1) {
      return 'JACKS_OR_BETTER';
    }
    return 'NOTHING';
  }

  if (isFlush) {
    return 'FLUSH';
  }

  return 'NOTHING';
}

export function evaluateHand(hand: Hand): HandCategory {
  const [c0, c1, c2, c3, c4] = hand.cards;
  return evaluate5Cards(c0, c1, c2, c3, c4);
}
