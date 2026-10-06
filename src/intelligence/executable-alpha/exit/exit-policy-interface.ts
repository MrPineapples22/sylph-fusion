/**
 * SYLPH FUSION — EXIT POLICY INTERFACE
 * Section XXI: Study Family 10 — Exit Control
 *
 * Defines the contract for all authoritative and shadow exit policies.
 * No exit policy may hardcode an arbitrary universal ladder as absolute truth.
 */

import type {
  ExitProposal,
  LiquidationSurface,
  RunnerState,
} from '../types.js';

export interface PositionState {
  readonly positionId: string;
  readonly mint: string;
  readonly poolAddress: string;
  readonly entryPriceUsd: number;
  readonly currentMarkPriceUsd: number;
  readonly currentMultiple: number; // e.g. 2.1x
  readonly totalInitialTokens: number;
  readonly remainingTokens: number;
  readonly principalInvestedUsd: number;
  readonly entryFeesPaidUsd: number;
  readonly realizedProceedsUsd: number;
  readonly entrySlot: bigint;
  readonly entryTimestampMs: number;
  readonly runnerState: RunnerState;
}

export interface ResearchExitContext {
  readonly qUp: number;
  readonly qFail: number;
  readonly dtfScore: number;
  readonly sellPressureRatio: number;
  readonly capitalRenewalScore: number;
  readonly exitReachability: number;
  readonly creatorDumpRisk: boolean;
  readonly authenticityIntact: boolean;
  readonly isEmergencyStopTriggered: boolean;
}

export interface ExitPolicy {
  readonly policyId: string;
  evaluate(
    position: PositionState,
    research: ResearchExitContext,
    liquidation: LiquidationSurface
  ): ExitProposal;
}
