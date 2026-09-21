import { type Hand, parseHand, formatHand } from '../core/hand.ts';
import { hashCanonicalObject } from '../core/hashing.ts';
import { evaluateHand } from '../engine_a/evaluator.ts';
import { PAYOUT_TABLE_9_6, type HandCategory } from '../engine_a/payout.ts';

export interface GameEventRecord {
  readonly roundId: string;
  readonly initialCards: string[];
  readonly chosenHoldMask: number;
  readonly drawnCards: string[];
  readonly finalCards: string[];
  readonly outcomeCategory: HandCategory;
  readonly payoutUnits: number;
  readonly eventHash: string;
}

export class ReplayAdapter {
  public static createEventRecord(
    roundId: string,
    initialHand: Hand,
    chosenHoldMask: number,
    drawnCards: string[],
    finalHand: Hand
  ): GameEventRecord {
    const outcome = evaluateHand(finalHand);
    const payout = PAYOUT_TABLE_9_6[outcome];

    const base = {
      roundId,
      initialCards: initialHand.cards.map((c) => c.symbol),
      chosenHoldMask,
      drawnCards,
      finalCards: finalHand.cards.map((c) => c.symbol),
      outcomeCategory: outcome,
      payoutUnits: payout,
    };

    return {
      ...base,
      eventHash: hashCanonicalObject(base),
    };
  }

  public static verifyEventReplay(event: GameEventRecord): { valid: boolean; reason?: string } {
    const computedFinalHand = parseHand(event.finalCards);
    const computedOutcome = evaluateHand(computedFinalHand);
    const computedPayout = PAYOUT_TABLE_9_6[computedOutcome];

    if (computedOutcome !== event.outcomeCategory) {
      return {
        valid: false,
        reason: `Outcome mismatch on replay: recorded ${event.outcomeCategory}, re-evaluated ${computedOutcome}`,
      };
    }

    if (computedPayout !== event.payoutUnits) {
      return {
        valid: false,
        reason: `Payout mismatch on replay: recorded ${event.payoutUnits}, re-evaluated ${computedPayout}`,
      };
    }

    const { eventHash, ...base } = event;
    const recomputedHash = hashCanonicalObject(base);
    if (recomputedHash !== eventHash) {
      return {
        valid: false,
        reason: `Hash corruption on replay: recorded ${eventHash}, recomputed ${recomputedHash}`,
      };
    }

    return { valid: true };
  }
}
