import { makeRational } from '../core/rational.ts';
import type { Rational } from '../core/rational.ts';
import type { OutcomeDistribution } from './draw_enumerator.ts';
import { PAYOUT_TABLE_9_6, HAND_CATEGORIES } from './payout.ts';

/**
 * Calculates exact rational Expected Value from outcome distribution.
 */
export function calculateExactEV(dist: OutcomeDistribution, betUnits = 1): Rational {
  let totalPayoutUnits = 0n;

  for (const cat of HAND_CATEGORIES) {
    const count = BigInt(dist[cat]);
    const payoutPerUnit = BigInt(PAYOUT_TABLE_9_6[cat]);
    totalPayoutUnits += count * payoutPerUnit;
  }

  const denominator = BigInt(dist.total);
  const ev = makeRational(totalPayoutUnits * BigInt(betUnits), denominator);
  return ev;
}
