import type { Hand } from '../core/hand.ts';
import { parseHand, createHand } from '../core/hand.ts';
import type { Card, SuitIndex } from '../core/card.ts';
import { DECK } from '../core/card.ts';
import { getHeldCards } from '../core/hold_mask.ts';
import { compareRational } from '../core/rational.ts';
import { solveHandOracle } from '../engine_a/oracle.ts';
import { enumerateDrawOutcomes } from '../engine_a/draw_enumerator.ts';
import { HAND_CATEGORIES } from '../engine_a/payout.ts';

export const THEORETICAL_COMBINATIONS = [
  1533939, // k = 0
  178365,  // k = 1
  16215,   // k = 2
  1081,    // k = 3
  47,      // k = 4
  1,       // k = 5
] as const;

export interface InvariantCheckResult {
  readonly invariant: string;
  readonly passed: boolean;
  readonly details: string;
}

export function verifyDenominatorConservation(hand: Hand): InvariantCheckResult[] {
  const results: InvariantCheckResult[] = [];

  for (let mask = 0; mask < 32; mask++) {
    const held = getHeldCards(hand.cards, mask);
    const k = held.length;
    const expectedTotal = THEORETICAL_COMBINATIONS[k];
    const dist = enumerateDrawOutcomes(hand, mask);

    let sum = 0;
    for (const cat of HAND_CATEGORIES) {
      sum += dist[cat];
    }

    const passed = (sum === expectedTotal) && (dist.total === expectedTotal);
    results.push({
      invariant: `DenominatorConservation(mask=${mask}, k=${k})`,
      passed,
      details: passed ? `Sum equals ${expectedTotal}` : `Expected ${expectedTotal}, got sum=${sum}, total=${dist.total}`,
    });
  }

  return results;
}

export function verifyCardOrderInvariance(hand: Hand): InvariantCheckResult {
  const originalResult = solveHandOracle(hand);
  const originalHeldSymbols = new Set(originalResult.selectedHold.heldCards.map((c) => c.symbol));

  // Permute cards in hand (e.g. reverse)
  const permutedCards = [...hand.cards].reverse();
  const permutedHand = createHand(permutedCards);
  const permutedResult = solveHandOracle(permutedHand);
  const permutedHeldSymbols = new Set(permutedResult.selectedHold.heldCards.map((c) => c.symbol));

  const evMatch = compareRational(originalResult.selectedHold.exactEV, permutedResult.selectedHold.exactEV) === 0;

  let setsMatch = originalHeldSymbols.size === permutedHeldSymbols.size;
  if (setsMatch) {
    for (const s of originalHeldSymbols) {
      if (!permutedHeldSymbols.has(s)) {
        setsMatch = false;
        break;
      }
    }
  }

  const passed = evMatch && setsMatch;
  return {
    invariant: 'CardOrderInvariance',
    passed,
    details: passed
      ? 'Optimal EV and selected cards identical across card permutations.'
      : 'Card permutation resulted in different EV or held cards.',
  };
}

export function verifySuitIsomorphismInvariance(hand: Hand): InvariantCheckResult {
  const originalResult = solveHandOracle(hand);

  // Swap Clubs (0) and Spades (3), Diamonds (1) and Hearts (2)
  const suitMap: SuitIndex[] = [3, 2, 1, 0];
  const transformedCards = hand.cards.map((c) => {
    const newSuit = suitMap[c.suit];
    return DECK[c.rank * 4 + newSuit];
  });
  const transformedHand = createHand(transformedCards);
  const transformedResult = solveHandOracle(transformedHand);

  const evMatch = compareRational(originalResult.selectedHold.exactEV, transformedResult.selectedHold.exactEV) === 0;
  const evGapMatch = compareRational(originalResult.evGap, transformedResult.evGap) === 0;

  const passed = evMatch && evGapMatch;
  return {
    invariant: 'SuitIsomorphismInvariance',
    passed,
    details: passed
      ? 'Exact EV and EV gap strictly preserved under suit automorphism.'
      : 'Suit bijection changed exact EV or gap.',
  };
}
