import { parseHand } from '../core/hand.ts';
import type { Hand } from '../core/hand.ts';
import { solveHandOracle } from '../engine_a/oracle.ts';
import { rationalToNumber } from '../core/rational.ts';

export interface BenchmarkCase {
  readonly id: string;
  readonly name: string;
  readonly handStr: string;
  readonly expectedHeldCards: string[];
  readonly expectedHeldCount: number;
  readonly rationale: string;
}

export const CANONICAL_STRATEGY_BENCHMARKS: readonly BenchmarkCase[] = [
  {
    id: 'BM-01',
    name: 'High Pair vs 4 to a Flush',
    handStr: 'Ah Ad 8d 7d 2d',
    expectedHeldCards: ['Ah', 'Ad'],
    expectedHeldCount: 2,
    rationale: 'High pair (EV ~1.5365) beats 4 to a flush (EV ~1.2766) in 9/6 full pay.',
  },
  {
    id: 'BM-02',
    name: 'Low Pair vs 4 to a Flush',
    handStr: '4h 4d 8d 7d 2d',
    expectedHeldCards: ['4d', '8d', '7d', '2d'],
    expectedHeldCount: 4,
    rationale: '4 to a flush (EV ~1.2766) beats low pair (EV ~0.8237).',
  },
  {
    id: 'BM-03',
    name: 'Two Pair vs 4 to a Royal',
    handStr: 'As Ks Qs Js Ac',
    expectedHeldCards: ['As', 'Ks', 'Qs', 'Js'],
    expectedHeldCount: 4,
    rationale: '4 to a Royal (EV ~18.5532) crushes Two Pair (EV ~2.5957). Break the Aces!',
  },
  {
    id: 'BM-04',
    name: 'Pat Flush vs 4 to a Royal',
    handStr: 'As Ks Qs Js 9s',
    expectedHeldCards: ['As', 'Ks', 'Qs', 'Js'],
    expectedHeldCount: 4,
    rationale: '4 to a Royal (EV ~18.5532) beats a made flush (EV 6.0000). Break the flush for the Royal draw.',
  },
  {
    id: 'BM-05',
    name: '3 to a Royal vs 4 to a Flush',
    handStr: 'As Ks Qs 9s 2c',
    expectedHeldCards: ['As', 'Ks', 'Qs'],
    expectedHeldCount: 3,
    rationale: '3 to a Royal (EV ~1.3432) beats 4 to a flush (EV ~1.2766) or pair draw.',
  },
  {
    id: 'BM-06',
    name: 'Low Pair vs 2 Unsuited High Cards',
    handStr: 'Kh Qc 4s 4d 9h',
    expectedHeldCards: ['4s', '4d'],
    expectedHeldCount: 2,
    rationale: 'Low pair (EV ~0.8237) beats 2 unsuited high cards (EV ~0.4995).',
  },
  {
    id: 'BM-07',
    name: '4 to an Outside Straight vs 1 High Card',
    handStr: '9s 8h 7c 6d 2s',
    expectedHeldCards: ['9s', '8h', '7c', '6d'],
    expectedHeldCount: 4,
    rationale: '4 to an open-ended straight (EV ~0.6809) beats drawing 5 or low cards.',
  },
  {
    id: 'BM-08',
    name: 'Garbage Hand Discard All 5',
    handStr: '2c 4d 6h 8s Tc',
    expectedHeldCards: [],
    expectedHeldCount: 0,
    rationale: 'No high card, no pair, no 4-flush/straight. Discard all 5 (EV ~0.3597).',
  },
  {
    id: 'BM-09',
    name: 'Pair of Tens vs Draw 5',
    handStr: 'Tc Td 8s 5h 2c',
    expectedHeldCards: ['Tc', 'Td'],
    expectedHeldCount: 2,
    rationale: 'Low pair Tens (EV ~0.8237) is far superior to drawing 5 (EV ~0.3597).',
  },
  {
    id: 'BM-10',
    name: '4 to an Inside Straight with 3 High Cards vs 3 High Cards',
    handStr: 'Jh Qh Kh 9s 2c',
    expectedHeldCards: ['Jh', 'Qh', 'Kh'],
    expectedHeldCount: 3,
    rationale: '3 suited high cards (3 to a Royal/Straight Flush) beat inside straight draw.',
  },
];

export function runBenchmarkSuite(): {
  total: number;
  passed: number;
  results: Array<{ id: string; name: string; success: boolean; actualHeld: string[]; expectedHeld: string[]; ev: number }>;
} {
  const results = [];
  let passed = 0;

  for (const bm of CANONICAL_STRATEGY_BENCHMARKS) {
    const hand = parseHand(bm.handStr);
    const oracleResult = solveHandOracle(hand);
    const actualHeld = oracleResult.selectedHold.heldCards.map((c) => c.symbol);

    const actualSet = new Set(actualHeld);
    let success = actualHeld.length === bm.expectedHeldCount;
    if (success) {
      for (const cardStr of bm.expectedHeldCards) {
        if (!actualSet.has(cardStr)) {
          success = false;
          break;
        }
      }
    }

    if (success) passed++;

    results.push({
      id: bm.id,
      name: bm.name,
      success,
      actualHeld,
      expectedHeld: bm.expectedHeldCards,
      ev: rationalToNumber(oracleResult.selectedHold.exactEV),
    });
  }

  return {
    total: CANONICAL_STRATEGY_BENCHMARKS.length,
    passed,
    results,
  };
}
