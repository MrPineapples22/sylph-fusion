import { DECK } from '../core/card.ts';
import type { Card } from '../core/card.ts';
import type { Hand } from '../core/hand.ts';
import { getHeldCards } from '../core/hold_mask.ts';
import type { HandCategory } from '../engine_a/payout.ts';
import { independentEvaluate5Cards } from './independent_evaluator.ts';

export type EngineBDistribution = Record<HandCategory, number> & { total: number };

export function* combinationsGenerator<T>(elements: readonly T[], k: number): Generator<T[]> {
  const n = elements.length;
  if (k === 0) {
    yield [];
    return;
  }
  if (k > n) return;

  const indices = Array.from({ length: k }, (_, i) => i);
  yield indices.map((i) => elements[i]);

  while (true) {
    let i = k - 1;
    while (i >= 0 && indices[i] === i + n - k) {
      i--;
    }
    if (i < 0) break;

    indices[i]++;
    for (let j = i + 1; j < k; j++) {
      indices[j] = indices[j - 1] + 1;
    }
    yield indices.map((idx) => elements[idx]);
  }
}

/**
 * Independent combination enumeration using generic combination generator.
 */
export function independentEnumerateOutcomes(hand: Hand, mask: number): EngineBDistribution {
  const held = getHeldCards(hand.cards, mask);
  const k = held.length;
  const drawCount = 5 - k;

  const handIds = new Set(hand.cards.map((c) => c.id));
  const remaining: Card[] = [];
  for (let i = 0; i < 52; i++) {
    if (!handIds.has(i)) {
      remaining.push(DECK[i]);
    }
  }

  const dist: EngineBDistribution = {
    ROYAL_FLUSH: 0,
    STRAIGHT_FLUSH: 0,
    FOUR_OF_A_KIND: 0,
    FULL_HOUSE: 0,
    FLUSH: 0,
    STRAIGHT: 0,
    THREE_OF_A_KIND: 0,
    TWO_PAIR: 0,
    JACKS_OR_BETTER: 0,
    NOTHING: 0,
    total: 0,
  };

  const combGen = combinationsGenerator(remaining, drawCount);
  for (const draw of combGen) {
    const fullHand = [...held, ...draw];
    const cat = independentEvaluate5Cards(
      fullHand[0],
      fullHand[1],
      fullHand[2],
      fullHand[3],
      fullHand[4]
    );
    dist[cat]++;
    dist.total++;
  }

  return dist;
}
