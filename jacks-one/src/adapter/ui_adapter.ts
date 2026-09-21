import type { Hand } from '../core/hand.ts';
import { formatCard } from '../core/card.ts';
import type { DecisionPacket } from '../strategy/compiler.ts';
import { PAYOUT_TABLE_9_6, type HandCategory, HAND_CATEGORIES } from '../engine_a/payout.ts';

export interface CardPresentationDTO {
  readonly index: number;
  readonly cardSymbol: string;
  readonly prettySymbol: string;
  readonly isHeld: boolean;
  readonly isOptimalHold: boolean;
}

export interface PaytableRowDTO {
  readonly category: HandCategory;
  readonly displayName: string;
  readonly payoutUnits: number;
  readonly isActiveWin: boolean;
}

export interface UIPresentationStateDTO {
  readonly cards: CardPresentationDTO[];
  readonly paytable: PaytableRowDTO[];
  readonly coachAdvice: {
    readonly showAdvice: boolean;
    readonly recommendationText: string;
    readonly evGapText: string;
    readonly certificateId: string;
  };
  readonly controls: {
    readonly canDeal: boolean;
    readonly canDraw: boolean;
    readonly betCoins: number;
  };
}

export class UIAdapter {
  /**
   * Transforms domain state and decision packets into pure UI presentation DTOs
   * for consumption by Godot or web renderers, decoupling math from presentation.
   */
  public static createPresentationState(
    hand: Hand,
    currentHoldMask: number,
    decisionPacket: DecisionPacket,
    activeWinCategory?: HandCategory,
    betCoins = 5
  ): UIPresentationStateDTO {
    const cards: CardPresentationDTO[] = hand.cards.map((c, idx) => {
      const isHeld = (currentHoldMask & (1 << idx)) !== 0;
      const isOptimalHold = (decisionPacket.selected_hold.mask & (1 << idx)) !== 0;
      return {
        index: idx,
        cardSymbol: c.symbol,
        prettySymbol: formatCard(c, true),
        isHeld,
        isOptimalHold,
      };
    });

    const categoryNames: Record<HandCategory, string> = {
      ROYAL_FLUSH: 'Royal Flush',
      STRAIGHT_FLUSH: 'Straight Flush',
      FOUR_OF_A_KIND: '4 of a Kind',
      FULL_HOUSE: 'Full House',
      FLUSH: 'Flush',
      STRAIGHT: 'Straight',
      THREE_OF_A_KIND: '3 of a Kind',
      TWO_PAIR: '2 Pair',
      JACKS_OR_BETTER: 'Jacks or Better',
      NOTHING: 'No Win',
    };

    const paytable: PaytableRowDTO[] = HAND_CATEGORIES.filter(c => c !== 'NOTHING').map((cat) => ({
      category: cat,
      displayName: categoryNames[cat],
      payoutUnits: PAYOUT_TABLE_9_6[cat] * betCoins,
      isActiveWin: activeWinCategory === cat,
    }));

    return {
      cards,
      paytable,
      coachAdvice: {
        showAdvice: true,
        recommendationText: `Hold: ${decisionPacket.selected_hold.held_cards.join(' ') || 'Discard All'} (EV: ${decisionPacket.exact_ev.decimal_approx.toFixed(4)})`,
        evGapText: `EV Gap to 2nd: +${decisionPacket.ev_gap.decimal_approx.toFixed(4)}`,
        certificateId: decisionPacket.certificate_id,
      },
      controls: {
        canDeal: false,
        canDraw: true,
        betCoins,
      },
    };
  }
}
