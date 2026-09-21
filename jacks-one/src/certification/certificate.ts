import type { Hand } from '../core/hand.ts';
import { canonicalizeHand } from '../core/hand.ts';
import { rationalToJSON } from '../core/rational.ts';
import { hashCanonicalObject, sha256Hex } from '../core/hashing.ts';
import { solveHandOracle, type OracleResult } from '../engine_a/oracle.ts';
import { independentSolveHand, type EngineBOracleResult } from '../engine_b/independent_ev.ts';
import { compareRational } from '../core/rational.ts';

export interface HoldCertificateRecord {
  readonly mask: number;
  readonly held_cards: string[];
  readonly exact_ev: {
    numerator: string;
    denominator: string;
    decimal_approx: number;
  };
  readonly total_combinations: number;
  readonly outcome_counts: Record<string, number>;
}

export interface HandCertificate {
  readonly certificate_id: string;
  readonly hand_canonical: string[];
  readonly hand_input: string[];
  readonly ruleset_id: string;
  readonly ruleset_version: string;
  readonly strategy_version: string;
  readonly all_holds: HoldCertificateRecord[];
  readonly selected_hold_mask: number;
  readonly selected_ev: {
    numerator: string;
    denominator: string;
    decimal_approx: number;
  };
  readonly ev_gap_to_second: {
    numerator: string;
    denominator: string;
    decimal_approx: number;
  };
  readonly is_tie: boolean;
  readonly tied_masks: number[];
  readonly engine_a_hash: string;
  readonly engine_b_hash: string;
  readonly engines_in_agreement: true;
  readonly calculation_hash: string;
  readonly timestamp: string;
  readonly manifest_reference: string;
}

export function generateCertificate(
  hand: Hand,
  manifestRef = 'manifest.jacks_one.v1',
  rulesetId = 'jacks_or_better.full_pay_9_6.v1',
  rulesetVersion = '1.0.0',
  strategyVersion = '1.0.0'
): HandCertificate {
  const resultA = solveHandOracle(hand);
  const resultB = independentSolveHand(hand);

  // Verify full agreement
  for (let mask = 0; mask < 32; mask++) {
    const hA = resultA.allHolds.find((h) => h.mask === mask)!;
    const hB = resultB.allHolds.find((h) => h.mask === mask)!;
    if (compareRational(hA.exactEV, hB.exactEV) !== 0) {
      throw new Error(`Engine disagreement at mask ${mask} for hand ${hand.cards.map(c => c.symbol).join(' ')}`);
    }
  }

  const canonicalHand = canonicalizeHand(hand);
  const handInputSymbols = hand.cards.map((c) => c.symbol);
  const handCanonicalSymbols = canonicalHand.cards.map((c) => c.symbol);

  const allHolds: HoldCertificateRecord[] = resultA.allHolds.map((h) => ({
    mask: h.mask,
    held_cards: h.heldCards.map((c) => c.symbol),
    exact_ev: rationalToJSON(h.exactEV),
    total_combinations: h.distribution.total,
    outcome_counts: {
      ROYAL_FLUSH: h.distribution.ROYAL_FLUSH,
      STRAIGHT_FLUSH: h.distribution.STRAIGHT_FLUSH,
      FOUR_OF_A_KIND: h.distribution.FOUR_OF_A_KIND,
      FULL_HOUSE: h.distribution.FULL_HOUSE,
      FLUSH: h.distribution.FLUSH,
      STRAIGHT: h.distribution.STRAIGHT,
      THREE_OF_A_KIND: h.distribution.THREE_OF_A_KIND,
      TWO_PAIR: h.distribution.TWO_PAIR,
      JACKS_OR_BETTER: h.distribution.JACKS_OR_BETTER,
      NOTHING: h.distribution.NOTHING,
    },
  }));

  const engineAData = { holds: allHolds, selected: resultA.selectedHold.mask };
  const engineBData = { holds: resultB.allHolds.map(h => ({ mask: h.mask, ev: rationalToJSON(h.exactEV) })), selected: resultB.selectedHold.mask };

  const engineAHash = hashCanonicalObject(engineAData);
  const engineBHash = hashCanonicalObject(engineBData);

  const intermediate = {
    hand_canonical: handCanonicalSymbols,
    hand_input: handInputSymbols,
    ruleset_id: rulesetId,
    ruleset_version: rulesetVersion,
    strategy_version: strategyVersion,
    all_holds: allHolds,
    selected_hold_mask: resultA.selectedHold.mask,
    selected_ev: rationalToJSON(resultA.selectedHold.exactEV),
    ev_gap_to_second: rationalToJSON(resultA.evGap),
    is_tie: resultA.isTie,
    tied_masks: [...resultA.tiedMasks],
    engine_a_hash: engineAHash,
    engine_b_hash: engineBHash,
    manifest_reference: manifestRef,
  };

  const calculationHash = hashCanonicalObject(intermediate);
  const certificateId = `cert_${calculationHash.slice(0, 16)}`;

  return {
    certificate_id: certificateId,
    ...intermediate,
    engines_in_agreement: true,
    calculation_hash: calculationHash,
    timestamp: new Date().toISOString(),
  };
}
