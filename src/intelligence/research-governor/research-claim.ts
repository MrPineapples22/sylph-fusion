/**
 * SYLPH FUSION — AUTONOMOUS R&D GOVERNOR-X: RESEARCH CLAIM & INVARIANTS
 * Specifications: Master Blueprint Section LII, LIII (Research Governor Invariants)
 *
 * Invariants:
 * 1. A generated hypothesis begins strictly as UNTESTED (never Sharpe 1.85 or predictive).
 * 2. Research agents may generate, plan, test, falsify, and propose.
 * 3. Research agents may NEVER: mark verified, promote itself, change verifier,
 *    change capital authority, change constitution, or modify release gates.
 */

export type ResearchHypothesisState =
  | 'UNTESTED'
  | 'REPLAY_TESTED'
  | 'SHADOW_TESTED'
  | 'CANARY_TESTED'
  | 'FALSIFIED'
  | 'GRADUATED';

export interface ResearchHypothesis {
  readonly hypothesisId: string;
  readonly proposerAgentId: string;
  readonly description: string;
  readonly mechanism: string;
  readonly falsificationCondition: string;
  readonly state: ResearchHypothesisState;
  readonly outOfSampleSampleSize: number;
  readonly observedSharpe: number;
  readonly createdAtMs: number;
}

export function createUntestedHypothesis(params: {
  hypothesisId: string;
  proposerAgentId: string;
  description: string;
  mechanism: string;
  falsificationCondition: string;
}): ResearchHypothesis {
  // Invariant Section LIII: A generated hypothesis begins strictly UNTESTED with zero assumed Sharpe
  return {
    ...params,
    state: 'UNTESTED',
    outOfSampleSampleSize: 0,
    observedSharpe: 0.0,
    createdAtMs: Date.now(),
  };
}
