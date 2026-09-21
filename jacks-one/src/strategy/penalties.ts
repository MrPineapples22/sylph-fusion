import type { Hand } from '../core/hand.ts';
import type { Card } from '../core/card.ts';
import { isHighCard } from '../core/card.ts';
import { getDiscardedCards } from '../core/hold_mask.ts';

export interface PenaltyAnalysis {
  readonly discardedHighCards: Card[];
  readonly flushPenalties: Card[];
  readonly penaltyDescriptions: string[];
}

export function analyzePenaltyCards(hand: Hand, holdMask: number): PenaltyAnalysis {
  const discarded = getDiscardedCards(hand.cards, holdMask);
  const discardedHighCards = discarded.filter(isHighCard);
  const descriptions: string[] = [];

  if (discardedHighCards.length > 0) {
    descriptions.push(
      `Discarded ${discardedHighCards.length} high card(s) (${discardedHighCards.map(c => c.symbol).join(' ')}), forfeiting high-pair outs.`
    );
  }

  // Count discarded suits
  const suitCounts: number[] = [0, 0, 0, 0];
  for (const c of discarded) {
    suitCounts[c.suit]++;
  }

  const flushPenalties: Card[] = [];
  for (const c of discarded) {
    if (suitCounts[c.suit] >= 2) {
      flushPenalties.push(c);
    }
  }

  return {
    discardedHighCards,
    flushPenalties,
    penaltyDescriptions: descriptions,
  };
}
