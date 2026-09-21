/**
 * Strategy Precedence Hierarchy for 9/6 Full Pay Jacks or Better.
 * Every rule has a descriptive name, priority rank (1 = highest), and description.
 */

export interface StrategyTier {
  readonly priority: number;
  readonly name: string;
  readonly description: string;
}

export const STRATEGY_PRECEDENCE: readonly StrategyTier[] = [
  { priority: 1, name: 'PAT_ROYAL_FLUSH', description: 'Royal Flush (Pat)' },
  { priority: 2, name: 'PAT_STRAIGHT_FLUSH', description: 'Straight Flush (Pat)' },
  { priority: 3, name: 'FOUR_OF_A_KIND', description: 'Four of a Kind (Pat)' },
  { priority: 4, name: 'FOUR_TO_ROYAL', description: '4 cards to a Royal Flush' },
  { priority: 5, name: 'PAT_FULL_HOUSE', description: 'Full House (Pat)' },
  { priority: 6, name: 'PAT_FLUSH', description: 'Flush (Pat)' },
  { priority: 7, name: 'THREE_OF_A_KIND', description: 'Three of a Kind' },
  { priority: 8, name: 'PAT_STRAIGHT', description: 'Straight (Pat)' },
  { priority: 9, name: 'FOUR_TO_STRAIGHT_FLUSH', description: '4 cards to a Straight Flush' },
  { priority: 10, name: 'TWO_PAIR', description: 'Two Pair' },
  { priority: 11, name: 'HIGH_PAIR', description: 'High Pair (Jacks, Queens, Kings, or Aces)' },
  { priority: 12, name: 'THREE_TO_ROYAL', description: '3 cards to a Royal Flush' },
  { priority: 13, name: 'FOUR_TO_FLUSH', description: '4 cards to a Flush' },
  { priority: 14, name: 'LOW_PAIR', description: 'Low Pair (Tens or lower)' },
  { priority: 15, name: 'FOUR_TO_OUTSIDE_STRAIGHT', description: '4 cards to an Outside (Open-Ended) Straight' },
  { priority: 16, name: 'TWO_SUITED_HIGH_CARDS', description: '2 Suited High Cards' },
  { priority: 17, name: 'THREE_TO_STRAIGHT_FLUSH', description: '3 cards to a Straight Flush' },
  { priority: 18, name: 'TWO_UNSUITED_HIGH_CARDS', description: '2 Unsuited High Cards (lowest if more than 2)' },
  { priority: 19, name: 'ONE_HIGH_CARD', description: '1 High Card (J, Q, K, or A)' },
  { priority: 20, name: 'DISCARD_ALL_5', description: 'Garbage Hand: Discard all 5 cards' },
];

export function getStrategyTierByName(name: string): StrategyTier | undefined {
  return STRATEGY_PRECEDENCE.find((t) => t.name === name);
}
