import type { Card } from '../core/card.ts';
import type { HandCategory } from '../engine_a/payout.ts';

// Prime number assigned to each rank 0..12 (2..A)
const RANK_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41] as const;

// The 10 straight prime products
const STRAIGHT_PRIME_PRODUCTS = new Set([
  23 * 29 * 31 * 37 * 41, // Royal straight: T J Q K A = 31,367,009
  19 * 23 * 29 * 31 * 37, // K high: 9 T J Q K = 14,535,931
  17 * 19 * 23 * 29 * 31, // Q high: 8 9 T J Q = 6,765,907
  13 * 17 * 19 * 23 * 29, // J high: 7 8 9 T J = 2,836,661
  11 * 13 * 17 * 19 * 23, // T high: 6 7 8 9 T = 1,270,721
  7 * 11 * 13 * 17 * 19,  // 9 high: 5 6 7 8 9 = 472,391
  5 * 7 * 11 * 13 * 17,   // 8 high: 4 5 6 7 8 = 130,865
  3 * 5 * 7 * 11 * 13,    // 7 high: 3 4 5 6 7 = 30,030
  2 * 3 * 5 * 7 * 11,     // 6 high: 2 3 4 5 6 = 2,310
  41 * 2 * 3 * 5 * 7,     // Wheel: A 2 3 4 5 = 8,610
]);

const ROYAL_PRIME_PRODUCT = 23 * 29 * 31 * 37 * 41;

/**
 * Independent 5-card evaluator based on prime-product factorization and suit equality.
 * Built independently from Engine A to allow rigorous differential validation.
 */
export function independentEvaluate5Cards(c0: Card, c1: Card, c2: Card, c3: Card, c4: Card): HandCategory {
  const isFlush = (c0.suit === c1.suit) &&
                  (c1.suit === c2.suit) &&
                  (c2.suit === c3.suit) &&
                  (c3.suit === c4.suit);

  const p0 = RANK_PRIMES[c0.rank];
  const p1 = RANK_PRIMES[c1.rank];
  const p2 = RANK_PRIMES[c2.rank];
  const p3 = RANK_PRIMES[c3.rank];
  const p4 = RANK_PRIMES[c4.rank];

  const primeProduct = p0 * p1 * p2 * p3 * p4;

  if (STRAIGHT_PRIME_PRODUCTS.has(primeProduct)) {
    if (isFlush) {
      if (primeProduct === ROYAL_PRIME_PRODUCT) {
        return 'ROYAL_FLUSH';
      }
      return 'STRAIGHT_FLUSH';
    }
    return 'STRAIGHT';
  }

  if (isFlush) {
    return 'FLUSH';
  }

  // Factorization check using prime powers
  for (let r = 0; r < 13; r++) {
    const p = RANK_PRIMES[r];
    const p4 = p * p * p * p;
    if (primeProduct % p4 === 0) {
      return 'FOUR_OF_A_KIND';
    }
  }

  for (let r = 0; r < 13; r++) {
    const p = RANK_PRIMES[r];
    const p3 = p * p * p;
    if (primeProduct % p3 === 0) {
      const rem = primeProduct / p3;
      for (let r2 = 0; r2 < 13; r2++) {
        if (r2 !== r) {
          const pPair = RANK_PRIMES[r2];
          if (rem === pPair * pPair) {
            return 'FULL_HOUSE';
          }
        }
      }
      return 'THREE_OF_A_KIND';
    }
  }

  const pairRanks: number[] = [];
  for (let r = 0; r < 13; r++) {
    const p = RANK_PRIMES[r];
    const p2 = p * p;
    if (primeProduct % p2 === 0) {
      pairRanks.push(r);
    }
  }

  if (pairRanks.length === 2) {
    return 'TWO_PAIR';
  }

  if (pairRanks.length === 1) {
    if (pairRanks[0] >= 9) {
      return 'JACKS_OR_BETTER';
    }
    return 'NOTHING';
  }

  return 'NOTHING';
}
