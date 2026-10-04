/**
 * SYLPH FUSION — PROFIT FRONTIER-X: ENGINEERING CANDIDATE & EVPI
 * Specifications: Master Blueprint Section LI (Profit Frontier-X)
 *
 * Answers economically: Which subsystem is economically worth improving next?
 */

export interface EngineeringCandidate {
  readonly candidateId: string;
  readonly targetSubsystem: string;
  readonly expectedImprovementBps: number;
  readonly estimatedEffortHours: number;
  readonly reversibility: 'EASY' | 'COSTLY' | 'IRREVERSIBLE';
  readonly evpiUsd: number; // Expected Value of Perfect Information
  readonly expectedNetBenefitUsd: number;
  readonly proposedAtMs: number;
}
