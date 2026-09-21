import type { OracleResult } from '../engine_a/oracle.ts';
import { rationalToNumber } from '../core/rational.ts';

export type BoundaryConfidence = 'CLEAR_CUT' | 'CLOSE_DECISION' | 'MARGINAL_BOUNDARY' | 'EXACT_TIE';

export interface DecisionBoundary {
  readonly confidence: BoundaryConfidence;
  readonly evGapNumber: number;
  readonly boundaryNotes: string;
}

export function classifyDecisionBoundary(result: OracleResult): DecisionBoundary {
  if (result.isTie) {
    return {
      confidence: 'EXACT_TIE',
      evGapNumber: 0,
      boundaryNotes: `Multiple holds have identical exact EV across all 32 combinations.`,
    };
  }

  const gap = rationalToNumber(result.evGap);

  if (gap < 0.01) {
    return {
      confidence: 'MARGINAL_BOUNDARY',
      evGapNumber: gap,
      boundaryNotes: `Extremely tight boundary (< 0.01 coin EV difference). Both holds are near-optimal.`,
    };
  }

  if (gap < 0.05) {
    return {
      confidence: 'CLOSE_DECISION',
      evGapNumber: gap,
      boundaryNotes: `Close decision (< 0.05 coin EV difference). Minor leakage if missed.`,
    };
  }

  return {
    confidence: 'CLEAR_CUT',
    evGapNumber: gap,
    boundaryNotes: `Clear-cut optimal hold. Significant EV gap (> 0.05 coins).`,
  };
}
