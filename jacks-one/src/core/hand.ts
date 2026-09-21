import { parseCard, formatCard, DECK } from './card.ts';
import type { Card, RankIndex, SuitIndex } from './card.ts';

/**
 * Hand domain entity: exactly 5 unique cards.
 */

export interface Hand {
  readonly cards: readonly [Card, Card, Card, Card, Card];
}

export function createHand(cards: readonly Card[]): Hand {
  if (cards.length !== 5) {
    throw new Error(`A hand must contain exactly 5 cards. Received ${cards.length}.`);
  }

  const seenIds = new Set<number>();
  for (const card of cards) {
    if (seenIds.has(card.id)) {
      throw new Error(`Duplicate card in hand: ${card.symbol} (id ${card.id})`);
    }
    seenIds.add(card.id);
  }

  return {
    cards: [cards[0], cards[1], cards[2], cards[3], cards[4]],
  };
}

export function parseHand(input: string | readonly string[]): Hand {
  let tokens: string[];
  if (typeof input === 'string') {
    tokens = input.trim().split(/[\s,]+/);
  } else {
    tokens = [...input];
  }

  if (tokens.length !== 5) {
    throw new Error(`Invalid hand input: "${input}". Must contain 5 card tokens.`);
  }

  const cards = tokens.map((t) => parseCard(t));
  return createHand(cards);
}

export function formatHand(hand: Hand, pretty = false): string {
  return hand.cards.map((c) => formatCard(c, pretty)).join(' ');
}

export function sortHand(hand: Hand): Hand {
  const sorted = [...hand.cards].sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return a.suit - b.suit;
  });
  return {
    cards: [sorted[0], sorted[1], sorted[2], sorted[3], sorted[4]],
  };
}

/**
 * Returns canonical suit-isomorphic representation of a 5-card hand.
 * Two hands are isomorphic under suit permutation S_4 if one can be transformed
 * into the other by a bijection on {C, D, H, S}.
 */
export function canonicalizeHand(hand: Hand): Hand {
  const cards = hand.cards;

  const suitPerms: number[][] = [
    [0,1,2,3], [0,1,3,2], [0,2,1,3], [0,2,3,1], [0,3,1,2], [0,3,2,1],
    [1,0,2,3], [1,0,3,2], [1,2,0,3], [1,2,3,0], [1,3,0,2], [1,3,2,0],
    [2,0,1,3], [2,0,3,1], [2,1,0,3], [2,1,3,0], [2,3,0,1], [2,3,1,0],
    [3,0,1,2], [3,0,2,1], [3,1,0,2], [3,1,2,0], [3,2,0,1], [3,2,1,0],
  ];

  let bestCardIds: number[] | null = null;

  for (const perm of suitPerms) {
    const transformedIds = cards.map((c) => {
      const newSuit = perm[c.suit] as SuitIndex;
      return c.rank * 4 + newSuit;
    });

    transformedIds.sort((a, b) => a - b);

    if (!bestCardIds) {
      bestCardIds = transformedIds;
    } else {
      for (let i = 0; i < 5; i++) {
        if (transformedIds[i] < bestCardIds[i]) {
          bestCardIds = transformedIds;
          break;
        } else if (transformedIds[i] > bestCardIds[i]) {
          break;
        }
      }
    }
  }

  const bestCards = bestCardIds!.map((id) => DECK[id]);
  return {
    cards: [bestCards[0], bestCards[1], bestCards[2], bestCards[3], bestCards[4]],
  };
}
