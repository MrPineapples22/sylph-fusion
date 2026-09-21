import { DECK, type Card } from '../core/card.ts';
import { createHand, type Hand } from '../core/hand.ts';
import { solveHandOracle } from '../engine_a/oracle.ts';
import { evaluate5Cards } from '../engine_a/evaluator.ts';
import { PAYOUT_TABLE_9_6, type HandCategory, HAND_CATEGORIES } from '../engine_a/payout.ts';
import { getHeldCards } from '../core/hold_mask.ts';

export interface SimulationResult {
  readonly rounds: number;
  readonly totalPayout: number;
  readonly meanRTP: number;
  readonly sampleVariance: number;
  readonly standardDeviation: number;
  readonly standardError: number;
  readonly categoryCounts: Record<HandCategory, number>;
  readonly theoreticalRTP: number;
  readonly theoreticalVariance: number;
}

export class VideoPokerSimulator {
  private readonly holdCache = new Map<string, number>();

  public runSimulation(rounds: number, onProgress?: (completed: number, total: number) => void): SimulationResult {
    let totalPayout = 0;
    let sumSquares = 0;

    const categoryCounts: Record<HandCategory, number> = {
      ROYAL_FLUSH: 0,
      STRAIGHT_FLUSH: 0,
      FOUR_OF_A_KIND: 0,
      FULL_HOUSE: 0,
      FLUSH: 0,
      STRAIGHT: 0,
      THREE_OF_A_KIND: 0,
      TWO_PAIR: 0,
      JACKS_OR_BETTER: 0,
      NOTHING: 0,
    };

    const deckIds = Array.from({ length: 52 }, (_, i) => i);

    for (let r = 0; r < rounds; r++) {
      if (onProgress && r > 0 && r % 25 === 0) {
        onProgress(r, rounds);
      }

      for (let i = 0; i < 10; i++) {
        const randIdx = i + Math.floor(Math.random() * (52 - i));
        const temp = deckIds[i];
        deckIds[i] = deckIds[randIdx];
        deckIds[randIdx] = temp;
      }

      const initialCards = [
        DECK[deckIds[0]],
        DECK[deckIds[1]],
        DECK[deckIds[2]],
        DECK[deckIds[3]],
        DECK[deckIds[4]],
      ];
      const initialHand = createHand(initialCards);

      // Cache lookup by sorted card IDs
      const cacheKey = initialCards.map(c => c.id).sort((a, b) => a - b).join(',');
      let holdMask = this.holdCache.get(cacheKey);

      if (holdMask === undefined) {
        const oracle = solveHandOracle(initialHand);
        holdMask = oracle.selectedHold.mask;
        this.holdCache.set(cacheKey, holdMask);
      }

      const held = getHeldCards(initialCards, holdMask);
      const drawCount = 5 - held.length;

      const drawnCards: Card[] = [];
      for (let d = 0; d < drawCount; d++) {
        drawnCards.push(DECK[deckIds[5 + d]]);
      }

      const final5 = [...held, ...drawnCards];
      const cat = evaluate5Cards(final5[0], final5[1], final5[2], final5[3], final5[4]);
      const payout = PAYOUT_TABLE_9_6[cat];

      totalPayout += payout;
      sumSquares += payout * payout;
      categoryCounts[cat]++;
    }

    if (onProgress) {
      onProgress(rounds, rounds);
    }

    const meanRTP = totalPayout / rounds;
    const sampleVariance = rounds > 1 ? (sumSquares - (totalPayout * totalPayout) / rounds) / (rounds - 1) : 0;
    const standardDeviation = Math.sqrt(sampleVariance);
    const standardError = rounds > 0 ? standardDeviation / Math.sqrt(rounds) : 0;

    return {
      rounds,
      totalPayout,
      meanRTP,
      sampleVariance,
      standardDeviation,
      standardError,
      categoryCounts,
      theoreticalRTP: 0.99543904,
      theoreticalVariance: 19.5146,
    };
  }
}
