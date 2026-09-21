import { parseHand } from '../core/hand.ts';
import { solveHandOracle } from '../engine_a/oracle.ts';
import { OfflineLookupIndex, type CompactHoldEntry } from '../certification/lookup_index.ts';
import { rationalToNumber } from '../core/rational.ts';

export interface MobileDecisionResponse {
  readonly hand: string[];
  readonly optimalHoldMask: number;
  readonly optimalHeldCards: string[];
  readonly exactEV: number;
  readonly isOfflineCertified: boolean;
  readonly source: 'COMPACT_INDEX' | 'LOCAL_EXACT_FALLBACK';
}

export class MobileAdapter {
  private readonly lookupIndex: OfflineLookupIndex;

  constructor(index?: OfflineLookupIndex) {
    this.lookupIndex = index ?? new OfflineLookupIndex();
  }

  public getOfflineDecision(cardSymbols: string[]): MobileDecisionResponse {
    const hand = parseHand(cardSymbols);

    // Try $O(1)$ fast compact index lookup first
    const indexed = this.lookupIndex.lookupHand(hand);
    if (indexed) {
      const held: string[] = [];
      for (let i = 0; i < 5; i++) {
        if ((indexed.mask & (1 << i)) !== 0) {
          held.push(hand.cards[i].symbol);
        }
      }
      return {
        hand: cardSymbols,
        optimalHoldMask: indexed.mask,
        optimalHeldCards: held,
        exactEV: indexed.evApprox,
        isOfflineCertified: true,
        source: 'COMPACT_INDEX',
      };
    }

    // Fallback to local exact 32-hold oracle (runs locally in < 50ms)
    const oracleResult = solveHandOracle(hand);
    return {
      hand: cardSymbols,
      optimalHoldMask: oracleResult.selectedHold.mask,
      optimalHeldCards: oracleResult.selectedHold.heldCards.map((c) => c.symbol),
      exactEV: rationalToNumber(oracleResult.selectedHold.exactEV),
      isOfflineCertified: true,
      source: 'LOCAL_EXACT_FALLBACK',
    };
  }
}
