import type { Hand } from '../core/hand.ts';
import { canonicalizeHand } from '../core/hand.ts';
import { solveHandOracle } from '../engine_a/oracle.ts';
import { rationalToNumber, rationalToJSON } from '../core/rational.ts';
import { getCanonicalHandKey } from '../verification/canonical_reduction.ts';

export interface CompactHoldEntry {
  readonly mask: number; // 0..31
  readonly evNum: number;
  readonly evDen: number;
  readonly evApprox: number;
}

export class OfflineLookupIndex {
  private readonly map = new Map<number, CompactHoldEntry>();

  public set(canonicalKey: number, entry: CompactHoldEntry): void {
    this.map.set(canonicalKey, entry);
  }

  public get(canonicalKey: number): CompactHoldEntry | undefined {
    return this.map.get(canonicalKey);
  }

  public lookupHand(hand: Hand): CompactHoldEntry | undefined {
    const c = hand.cards;
    const key = getCanonicalHandKey(c[0].id, c[1].id, c[2].id, c[3].id, c[4].id);
    return this.map.get(key);
  }

  public size(): number {
    return this.map.size;
  }

  public exportJSON(): Record<string, CompactHoldEntry> {
    const obj: Record<string, CompactHoldEntry> = {};
    for (const [k, v] of this.map.entries()) {
      obj[k.toString()] = v;
    }
    return obj;
  }

  public static fromJSON(data: Record<string, CompactHoldEntry>): OfflineLookupIndex {
    const idx = new OfflineLookupIndex();
    for (const [k, v] of Object.entries(data)) {
      idx.set(Number(k), v);
    }
    return idx;
  }
}

/**
 * Builds entry for a given hand into the compact offline index format.
 */
export function buildIndexEntryForHand(hand: Hand): { key: number; entry: CompactHoldEntry } {
  const c = hand.cards;
  const key = getCanonicalHandKey(c[0].id, c[1].id, c[2].id, c[3].id, c[4].id);
  const oracleResult = solveHandOracle(hand);
  const sel = oracleResult.selectedHold;

  return {
    key,
    entry: {
      mask: sel.mask,
      evNum: Number(sel.exactEV.num),
      evDen: Number(sel.exactEV.den),
      evApprox: rationalToNumber(sel.exactEV),
    },
  };
}
