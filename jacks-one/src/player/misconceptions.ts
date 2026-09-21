export type MisconceptionCategory =
  | 'OVERHOLDING_KICKERS'
  | 'CHASING_GUTSHOT'
  | 'FAILING_TO_DRAW_TO_ROYAL'
  | 'BREAKING_HIGH_PAIR_FOR_FLUSH'
  | 'KEEPING_GARBAGE'
  | 'UNFAVORABLE_LOW_PAIR_DISCARD'
  | 'GENERAL_SUBOPTIMAL';

export interface MisconceptionDiagnosis {
  readonly category: MisconceptionCategory;
  readonly title: string;
  readonly description: string;
}

export function diagnoseMistake(
  handCards: string[],
  chosenMask: number,
  optimalMask: number,
  evLoss: number
): MisconceptionDiagnosis {
  if (chosenMask === optimalMask || evLoss <= 0.0001) {
    return {
      category: 'GENERAL_SUBOPTIMAL',
      title: 'Optimal Play',
      description: 'No mistake was made.',
    };
  }

  // Check if optimal was 4 to Royal (mask of 4 cards) and user held two pair
  const chosenCount = countBits(chosenMask);
  const optimalCount = countBits(optimalMask);

  if (optimalCount === 4 && chosenCount === 5) {
    return {
      category: 'FAILING_TO_DRAW_TO_ROYAL',
      title: 'Reluctance to Break Made Hand for Royal',
      description: 'You held a made hand (flush or two pair) instead of drawing 1 card to the 800-to-1 Royal Flush.',
    };
  }

  if (chosenCount === 3 && optimalCount === 2) {
    return {
      category: 'OVERHOLDING_KICKERS',
      title: 'Kicker Preservation Fallacy',
      description: 'In Jacks or Better, holding a kicker alongside a pair reduces the draw possibilities for trips/full house with zero upside.',
    };
  }

  if (optimalCount === 0 && chosenCount > 0) {
    return {
      category: 'KEEPING_GARBAGE',
      title: 'Hesitance to Redraw All 5',
      description: 'Holding unsuited low cards or disjoint cards has negative EV compared to drawing 5 new cards.',
    };
  }

  return {
    category: 'GENERAL_SUBOPTIMAL',
    title: 'Suboptimal Hold',
    description: `Decision incurred an EV loss of ${evLoss.toFixed(4)} coins compared to the certified strategy.`,
  };
}

function countBits(n: number): number {
  let c = 0;
  for (let i = 0; i < 5; i++) {
    if ((n & (1 << i)) !== 0) c++;
  }
  return c;
}
