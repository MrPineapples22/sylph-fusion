import type { Hand } from '../core/hand.ts';
import { solveHandOracle } from '../engine_a/oracle.ts';
import { independentSolveHand } from '../engine_b/independent_ev.ts';
import { compareRational } from '../core/rational.ts';
import { HAND_CATEGORIES } from '../engine_a/payout.ts';

export interface DifferentialReport {
  readonly hand: Hand;
  readonly fullAgreement: boolean;
  readonly holdDifferences: Array<{
    mask: number;
    issue: string;
  }>;
}

export function runDifferentialCheck(hand: Hand): DifferentialReport {
  const resultA = solveHandOracle(hand);
  const resultB = independentSolveHand(hand);

  const holdDifferences: Array<{ mask: number; issue: string }> = [];

  for (let mask = 0; mask < 32; mask++) {
    const holdA = resultA.allHolds.find((h) => h.mask === mask)!;
    const holdB = resultB.allHolds.find((h) => h.mask === mask)!;

    if (compareRational(holdA.exactEV, holdB.exactEV) !== 0) {
      holdDifferences.push({
        mask,
        issue: `EV mismatch: A=${holdA.exactEV.num}/${holdA.exactEV.den} vs B=${holdB.exactEV.num}/${holdB.exactEV.den}`,
      });
      continue;
    }

    for (const cat of HAND_CATEGORIES) {
      if (holdA.distribution[cat] !== holdB.distribution[cat]) {
        holdDifferences.push({
          mask,
          issue: `Category count mismatch for ${cat}: A=${holdA.distribution[cat]} vs B=${holdB.distribution[cat]}`,
        });
      }
    }
  }

  if (resultA.selectedHold.mask !== resultB.selectedHold.mask) {
    holdDifferences.push({
      mask: resultA.selectedHold.mask,
      issue: `Selected hold mismatch: A=mask ${resultA.selectedHold.mask} vs B=mask ${resultB.selectedHold.mask}`,
    });
  }

  return {
    hand,
    fullAgreement: holdDifferences.length === 0,
    holdDifferences,
  };
}
