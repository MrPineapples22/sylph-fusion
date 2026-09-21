import type { Hand } from '../core/hand.ts';
import type { Card } from '../core/card.ts';
import { getHeldCards } from '../core/hold_mask.ts';
import { makeRational, compareRational, subRational } from '../core/rational.ts';
import type { Rational } from '../core/rational.ts';
import { HAND_CATEGORIES, PAYOUT_TABLE_9_6 } from '../engine_a/payout.ts';
import { independentEnumerateOutcomes } from './independent_enumerator.ts';
import type { EngineBDistribution } from './independent_enumerator.ts';

export interface EngineBHoldEvaluation {
  readonly mask: number;
  readonly heldCards: readonly Card[];
  readonly exactEV: Rational;
  readonly distribution: EngineBDistribution;
  rank: number;
}

export interface EngineBOracleResult {
  readonly hand: Hand;
  readonly allHolds: readonly EngineBHoldEvaluation[];
  readonly selectedHold: EngineBHoldEvaluation;
  readonly evGap: Rational;
  readonly isTie: boolean;
  readonly tiedMasks: readonly number[];
}

export function independentCalculateEV(dist: EngineBDistribution, betUnits = 1): Rational {
  let totalPayout = 0n;
  for (const cat of HAND_CATEGORIES) {
    totalPayout += BigInt(dist[cat]) * BigInt(PAYOUT_TABLE_9_6[cat]);
  }
  return makeRational(totalPayout * BigInt(betUnits), BigInt(dist.total));
}

export function independentSolveHand(hand: Hand, betUnits = 1): EngineBOracleResult {
  const evaluations: EngineBHoldEvaluation[] = [];

  for (let mask = 0; mask < 32; mask++) {
    const heldCards = getHeldCards(hand.cards, mask);
    const dist = independentEnumerateOutcomes(hand, mask);
    const ev = independentCalculateEV(dist, betUnits);

    evaluations.push({
      mask,
      heldCards,
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
