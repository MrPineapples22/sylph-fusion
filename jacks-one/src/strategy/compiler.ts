import type { Hand } from '../core/hand.ts';
import { rationalToJSON } from '../core/rational.ts';
import { solveHandOracle, type OracleResult } from '../engine_a/oracle.ts';
import { generateCertificate } from '../certification/certificate.ts';
import { generateCounterfactualExplanation } from './counterfactuals.ts';
import { analyzePenaltyCards } from './penalties.ts';
import { classifyDecisionBoundary } from './boundaries.ts';

export interface DecisionPacket {
  readonly hand: string[];
  readonly ruleset_id: string;
  readonly strategy_version: string;
  readonly selected_hold: {
    readonly mask: number;
    readonly held_count: number;
    readonly held_cards: string[];
    readonly discarded_cards: string[];
  };
  readonly exact_ev: {
    readonly numerator: string;
    readonly denominator: string;
    readonly decimal_approx: number;
  };
  readonly alternative_evs: Array<{
    readonly mask: number;
    readonly held_cards: string[];
    readonly exact_ev: {
      readonly numerator: string;
      readonly denominator: string;
      readonly decimal_approx: number;
    };
    readonly rank: number;
  }>;
  readonly ev_gap: {
    readonly numerator: string;
    readonly denominator: string;
    readonly decimal_approx: number;
  };
  readonly outcome_counts: {
    readonly ROYAL_FLUSH: number;
    readonly STRAIGHT_FLUSH: number;
    readonly FOUR_OF_A_KIND: number;
    readonly FULL_HOUSE: number;
    readonly FLUSH: number;
    readonly STRAIGHT: number;
    readonly THREE_OF_A_KIND: number;
    readonly TWO_PAIR: number;
    readonly JACKS_OR_BETTER: number;
    readonly NOTHING: number;
    readonly TOTAL_COMBINATIONS: number;
  };
  readonly certificate_id: string;
  readonly certificate_hash: string;
  readonly explanation_data: {
    readonly category_label: string;
    readonly rule_name: string;
    readonly key_reasons: string[];
    readonly penalty_cards_identified: string[];
  };
  readonly confidence_status: 'exact_certified' | 'reconciled';
}

export function compileDecisionPacket(
  hand: Hand,
  rulesetId = 'jacks_or_better.full_pay_9_6.v1',
  strategyVersion = '1.0.0'
): DecisionPacket {
  const oracleResult = solveHandOracle(hand);
  const cert = generateCertificate(hand, undefined, rulesetId, '1.0.0', strategyVersion);
  const counterfactual = generateCounterfactualExplanation(oracleResult);
  const penalties = analyzePenaltyCards(hand, oracleResult.selectedHold.mask);
  const boundary = classifyDecisionBoundary(oracleResult);

  const sel = oracleResult.selectedHold;
  const dist = sel.distribution;

  const alternative_evs = oracleResult.allHolds.map((h) => ({
    mask: h.mask,
    held_cards: h.heldCards.map((c) => c.symbol),
    exact_ev: rationalToJSON(h.exactEV),
    rank: h.rank,
  }));

  return {
    hand: hand.cards.map((c) => c.symbol),
    ruleset_id: rulesetId,
    strategy_version: strategyVersion,
    selected_hold: {
      mask: sel.mask,
      held_count: sel.heldCount,
      held_cards: sel.heldCards.map((c) => c.symbol),
      discarded_cards: sel.discardedCards.map((c) => c.symbol),
    },
    exact_ev: rationalToJSON(sel.exactEV),
    alternative_evs,
    ev_gap: rationalToJSON(oracleResult.evGap),
    outcome_counts: {
      ROYAL_FLUSH: dist.ROYAL_FLUSH,
      STRAIGHT_FLUSH: dist.STRAIGHT_FLUSH,
      FOUR_OF_A_KIND: dist.FOUR_OF_A_KIND,
      FULL_HOUSE: dist.FULL_HOUSE,
      FLUSH: dist.FLUSH,
      STRAIGHT: dist.STRAIGHT,
      THREE_OF_A_KIND: dist.THREE_OF_A_KIND,
      TWO_PAIR: dist.TWO_PAIR,
      JACKS_OR_BETTER: dist.JACKS_OR_BETTER,
      NOTHING: dist.NOTHING,
      TOTAL_COMBINATIONS: dist.total,
    },
    certificate_id: cert.certificate_id,
    certificate_hash: cert.calculation_hash,
    explanation_data: {
      category_label: boundary.confidence,
      rule_name: counterfactual.explanationSummary,
      key_reasons: counterfactual.keyReasons,
      penalty_cards_identified: penalties.penaltyDescriptions,
    },
    confidence_status: 'exact_certified',
  };
}
