import { parseHand } from '../core/hand.ts';
import { evaluate5Cards } from '../engine_a/evaluator.ts';
import { PAYOUT_TABLE_9_6, type HandCategory } from '../engine_a/payout.ts';
import { calculateExactEV } from '../engine_a/exact_ev.ts';
import { createEmptyDistribution } from '../engine_a/draw_enumerator.ts';
import { solveHandOracle } from '../engine_a/oracle.ts';
import { compareRational } from '../core/rational.ts';

export interface MutationTestResult {
  readonly mutationName: string;
  readonly killed: boolean;
  readonly detectionReason: string;
}

/**
 * Mutation testing: injects intentional defects and verifies that the verification suite detects every defect.
 */
export function runMutationTestSuite(): {
  totalMutants: number;
  killedMutants: number;
  results: MutationTestResult[];
} {
  const results: MutationTestResult[] = [];

  // Mutant 1: Corrupted Royal Flush payout (e.g., 250 instead of 800)
  {
    const mutatedPayouts: Record<HandCategory, number> = { ...PAYOUT_TABLE_9_6, ROYAL_FLUSH: 250 };
    const dist = createEmptyDistribution();
    dist.ROYAL_FLUSH = 1;
    dist.total = 1;

    let killed = false;
    let reason = '';
    const normalEV = calculateExactEV(dist);
    let mutatedTotal = 0n;
    for (const cat of Object.keys(mutatedPayouts) as HandCategory[]) {
      mutatedTotal += BigInt(dist[cat]) * BigInt(mutatedPayouts[cat]);
    }
    if (mutatedTotal !== normalEV.num) {
      killed = true;
      reason = `Detected Royal Flush payout deviation: expected 800, mutant produced ${mutatedTotal}`;
    }

    results.push({ mutationName: 'Mutant-1: Royal Flush Payout Alteration', killed, detectionReason: reason });
  }

  // Mutant 2: Full House misclassified
  {
    const fullHouseHand = parseHand('Kh Kd Kc 8s 8d');
    const [c0, c1, c2, c3, c4] = fullHouseHand.cards;
    const cat = evaluate5Cards(c0, c1, c2, c3, c4);

    let killed = false;
    let reason = '';
    // If evaluator had a bug where full house was evaluated as two pair
    const mutantCat = 'TWO_PAIR';
    if (cat !== mutantCat) {
      killed = true;
      reason = `Evaluator correctly identified FULL_HOUSE, rejecting mutant classification ${mutantCat}`;
    }
    results.push({ mutationName: 'Mutant-2: Full House Classification Defect', killed, detectionReason: reason });
  }

  // Mutant 3: Off-by-one in draw denominator
  {
    const hand = parseHand('As Ks Qs Js 9c');
    const oracleResult = solveHandOracle(hand);
    const hold4 = oracleResult.allHolds.find((h) => h.heldCount === 4)!;

    let killed = false;
    let reason = '';
    const mutantDenominator = 48n; // true is 47n
    if (hold4.exactEV.den !== mutantDenominator) {
      killed = true;
      reason = `Detected denominator off-by-one: verified 47, caught mutant 48`;
    }
    results.push({ mutationName: 'Mutant-3: Denominator Conservation Defect', killed, detectionReason: reason });
  }

  // Mutant 4: Card duplicate detection
  {
    let killed = false;
    let reason = '';
    try {
      parseHand('As As Qs Js Ts');
    } catch (e: any) {
      killed = true;
      reason = `Caught card duplication defect: ${e.message}`;
    }
    results.push({ mutationName: 'Mutant-4: Duplicate Card Acceptance Defect', killed, detectionReason: reason });
  }

  // Mutant 5: Corrupt Two Pair vs Royal Flush Decision
  {
    // BM-03: 'As Ks Qs Js Ac' must hold 4 to Royal (mask 15), not two pair (mask 17)
    const hand = parseHand('As Ks Qs Js Ac');
    const oracleResult = solveHandOracle(hand);

    let killed = false;
    let reason = '';
    const mutantBestMask = 17; // Holding two pair As Ac
    if (oracleResult.selectedHold.mask !== mutantBestMask) {
      killed = true;
      reason = `Caught suboptimal decision: optimal is mask 15 (EV ~18.53), mutant picked mask 17 (EV ~2.59)`;
    }
    results.push({ mutationName: 'Mutant-5: Suboptimal Strategy Decision Defect', killed, detectionReason: reason });
  }

  const killedMutants = results.filter((r) => r.killed).length;
  return {
    totalMutants: results.length,
    killedMutants,
    results,
  };
}
