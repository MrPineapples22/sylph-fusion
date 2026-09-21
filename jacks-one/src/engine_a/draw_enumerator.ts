import { DECK } from '../core/card.ts';
import type { Card } from '../core/card.ts';
import type { Hand } from '../core/hand.ts';
import { getHeldCards } from '../core/hold_mask.ts';
import { HAND_CATEGORIES } from './payout.ts';
import type { HandCategory } from './payout.ts';
import { evaluate5Cards } from './evaluator.ts';

export type OutcomeDistribution = Record<HandCategory, number> & { total: number };

export function createEmptyDistribution(): OutcomeDistribution {
  return {
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
}

/**
 * Enumerates all possible replacement draws for a given initial hand and hold mask.
 * Returns exact integer frequencies for each hand category.
 */
export function enumerateDrawOutcomes(hand: Hand, mask: number): OutcomeDistribution {
  const held = getHeldCards(hand.cards, mask);
  const k = held.length;

  const handIds = new Set(hand.cards.map((c) => c.id));
  const remaining: Card[] = [];
  for (let i = 0; i < 52; i++) {
    if (!handIds.has(i)) {
      remaining.push(DECK[i]);
    }
  }

  const dist = createEmptyDistribution();

  if (k === 5) {
    const cat = evaluate5Cards(held[0], held[1], held[2], held[3], held[4]);
    dist[cat]++;
    dist.total = 1;
    return dist;
  }

  if (k === 4) {
    const [h0, h1, h2, h3] = held;
    for (let i = 0; i < 47; i++) {
      const cat = evaluate5Cards(h0, h1, h2, h3, remaining[i]);
      dist[cat]++;
    }
    dist.total = 47;
    return dist;
  }

  if (k === 3) {
    const [h0, h1, h2] = held;
    for (let i = 0; i < 46; i++) {
      const r0 = remaining[i];
      for (let j = i + 1; j < 47; j++) {
        const cat = evaluate5Cards(h0, h1, h2, r0, remaining[j]);
        dist[cat]++;
      }
    }
    dist.total = 1081;
    return dist;
  }

  if (k === 2) {
    const [h0, h1] = held;
    for (let i = 0; i < 45; i++) {
      const r0 = remaining[i];
      for (let j = i + 1; j < 46; j++) {
        const r1 = remaining[j];
        for (let m = j + 1; m < 47; m++) {
          const cat = evaluate5Cards(h0, h1, r0, r1, remaining[m]);
          dist[cat]++;
        }
      }
    }
    dist.total = 16215;
    return dist;
  }

  if (k === 1) {
    const [h0] = held;
    for (let i = 0; i < 44; i++) {
      const r0 = remaining[i];
      for (let j = i + 1; j < 45; j++) {
        const r1 = remaining[j];
        for (let m = j + 1; m < 46; m++) {
          const r2 = remaining[m];
          for (let n = m + 1; n < 47; n++) {
            const cat = evaluate5Cards(h0, r0, r1, r2, remaining[n]);
            dist[cat]++;
          }
        }
      }
    }
    dist.total = 178365;
    return dist;
  }

  // k === 0: draw 5 cards from 47
  for (let i = 0; i < 43; i++) {
    const r0 = remaining[i];
    for (let j = i + 1; j < 44; j++) {
      const r1 = remaining[j];
      for (let m = j + 1; m < 45; m++) {
        const r2 = remaining[m];
        for (let n = m + 1; n < 46; n++) {
          const r3 = remaining[n];
          for (let p = n + 1; p < 47; p++) {
            const cat = evaluate5Cards(r0, r1, r2, r3, remaining[p]);
            dist[cat]++;
          }
        }
      }
    }
  }
  dist.total = 1533939;
  return dist;
}
