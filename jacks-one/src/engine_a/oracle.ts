import type { Hand } from '../core/hand.ts';
import type { Card } from '../core/card.ts';
import { ALL_HOLD_MASKS, getHeldCards, getDiscardedCards } from '../core/hold_mask.ts';
import { compareRational, subRational, ZERO } from '../core/rational.ts';
import type { Rational } from '../core/rational.ts';
import { enumerateDrawOutcomes } from './draw_enumerator.ts';
import type { OutcomeDistribution } from './draw_enumerator.ts';
import { calculateExactEV } from './exact_ev.ts';

export interface HoldEvaluation {
  readonly mask: number;
  readonly heldCards: readonly Card[];
  readonly discardedCards: readonly Card[];
  readonly heldCount: number;
  readonly exactEV: Rational;
  readonly distribution: OutcomeDistribution;
  rank: number; // 1..32 (1 is best)
}

export interface OracleResult {
  readonly hand: Hand;
  readonly allHolds: readonly HoldEvaluation[];
  readonly selectedHold: HoldEvaluation;
  readonly evGap: Rational;
  readonly isTie: boolean;
  readonly tiedMasks: readonly number[];
}

/**
 * Authoritative 32-Hold Oracle.
 * Evaluates all 32 possible hold decisions for an initial 5-card hand with exact rational EV.
 */
export function solveHandOracle(hand: Hand, betUnits = 1): OracleResult {
  const evaluations: HoldEvaluation[] = [];

  for (let mask = 0; mask < 32; mask++) {
    const heldCards = getHeldCards(hand.cards, mask);
    const discardedCards = getDiscardedCards(hand.cards, mask);
    const dist = enumerateDrawOutcomes(hand, mask);
    const ev = calculateExactEV(dist, betUnits);

    evaluations.push({
      mask,
      heldCards,
      discardedCards,
      heldCount: heldCards.length,
      exactEV: ev,
      distribution: dist,
      rank: 0,
    });
  }

  evaluations.sort((a, b) => {
    const cmp = compareRational(b.exactEV, a.exactEV);
    if (cmp !== 0) return cmp;
    return a.mask - b.mask;
  });

  for (let i = 0; i < evaluations.length; i++) {
    evaluations[i].rank = i + 1;
  }

  const selectedHold = evaluations[0];
  const secondBest = evaluations[1];
  const evGap = subRational(selectedHold.exactEV, secondBest.exactEV);

  const tiedMasks: number[] = [];
  for (const ev of evaluations) {
    if (compareRational(ev.exactEV, selectedHold.exactEV) === 0) {
      tiedMasks.push(ev.mask);
    }
  }

  return {
    hand,
    allHolds: evaluations,
    selectedHold,
    evGap,
    isTie: tiedMasks.length > 1,
    tiedMasks,
  };
}
