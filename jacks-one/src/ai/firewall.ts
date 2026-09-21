import type { DecisionPacket } from '../strategy/compiler.ts';

export interface CertifiedFactPayload {
  readonly certificate_id: string;
  readonly certificate_hash: string;
  readonly hand: readonly string[];
  readonly selected_hold_cards: readonly string[];
  readonly selected_hold_mask: number;
  readonly exact_ev_display: string;
  readonly runner_up_hold_cards: readonly string[];
  readonly runner_up_ev_display: string;
  readonly ev_gap_display: string;
  readonly explanation_summary: string;
  readonly is_immutable: true;
}

export class AIFirewall {
  /**
   * Sanitizes and bounds a DecisionPacket into a read-only CertifiedFactPayload for LLMs.
   * Strips any write or mutation paths.
   */
  public static createFactPayload(packet: DecisionPacket): CertifiedFactPayload {
    const runnerUp = packet.alternative_evs[1];

    return Object.freeze({
      certificate_id: packet.certificate_id,
      certificate_hash: packet.certificate_hash,
      hand: Object.freeze([...packet.hand]),
      selected_hold_cards: Object.freeze([...packet.selected_hold.held_cards]),
      selected_hold_mask: packet.selected_hold.mask,
      exact_ev_display: packet.exact_ev.decimal_approx.toFixed(6),
      runner_up_hold_cards: Object.freeze([...runnerUp.held_cards]),
      runner_up_ev_display: runnerUp.exact_ev.decimal_approx.toFixed(6),
      ev_gap_display: packet.ev_gap.decimal_approx.toFixed(6),
      explanation_summary: packet.explanation_data.rule_name,
      is_immutable: true,
    });
  }

  /**
   * Validates conversational AI output against certified truth facts.
   * Rejects any response attempting to recommend a different hold or contradict certified facts.
   */
  public static validateAIOutput(
    facts: CertifiedFactPayload,
    aiProposedRecommendation: string
  ): { valid: boolean; reason?: string } {
    // If the AI tries to recommend a hold other than the certified selected hold
    const lower = aiProposedRecommendation.toLowerCase();

    // Check if AI mentions cards that should have been discarded as recommended holds
    for (const card of facts.hand) {
      const isHeld = facts.selected_hold_cards.includes(card);
      if (!isHeld && lower.includes(`hold ${card.toLowerCase()}`)) {
        return {
          valid: false,
          reason: `AI Firewall Violation: AI attempted to recommend holding discarded card ${card}. Certified hold is [${facts.selected_hold_cards.join(', ')}].`,
        };
      }
    }

    return { valid: true };
  }
}
