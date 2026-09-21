import type { Card } from './card.ts';
import { type Hand, createHand } from './hand.ts';
import { type HoldMaskInfo, getHoldMaskInfo } from './hold_mask.ts';
import { hashCanonicalObject } from './hashing.ts';

export type GamePhase = 'DEALT' | 'HELD' | 'DRAWN' | 'SETTLED';

export interface GameState {
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  readonly strategyVersion: string;
  readonly betUnits: number;
  readonly phase: GamePhase;
  readonly initialHand: Hand;
  readonly holdMask: number; // 0..31
  readonly finalHand?: Hand;
  readonly payoutUnits?: number;
  readonly certificateId?: string;
  readonly stateHash: string;
}

export function createInitialState(
  hand: Hand,
  rulesetId = 'jacks_or_better.full_pay_9_6.v1',
  rulesetVersion = '1.0.0',
  strategyVersion = '1.0.0',
  betUnits = 1
): GameState {
  const base = {
    rulesetId,
    rulesetVersion,
    strategyVersion,
    betUnits,
    phase: 'DEALT' as GamePhase,
    initialHand: hand,
    holdMask: 0,
  };

  return {
    ...base,
    stateHash: hashCanonicalObject(base),
  };
}

export function applyHold(state: GameState, mask: number): GameState {
  if (state.phase !== 'DEALT') {
    throw new Error(`Cannot apply hold in phase: ${state.phase}. Expected DEALT.`);
  }

  const maskInfo = getHoldMaskInfo(mask);
  const next = {
    rulesetId: state.rulesetId,
    rulesetVersion: state.rulesetVersion,
    strategyVersion: state.strategyVersion,
    betUnits: state.betUnits,
    phase: 'HELD' as GamePhase,
    initialHand: state.initialHand,
    holdMask: maskInfo.mask,
  };

  return {
    ...next,
    stateHash: hashCanonicalObject(next),
  };
}

export function applyDrawAndSettle(
  state: GameState,
  finalHand: Hand,
  payoutUnits: number,
  certificateId?: string
): GameState {
  if (state.phase !== 'HELD') {
    throw new Error(`Cannot draw/settle in phase: ${state.phase}. Expected HELD.`);
  }

  const next = {
    rulesetId: state.rulesetId,
    rulesetVersion: state.rulesetVersion,
    strategyVersion: state.strategyVersion,
    betUnits: state.betUnits,
    phase: 'SETTLED' as GamePhase,
    initialHand: state.initialHand,
    holdMask: state.holdMask,
    finalHand,
    payoutUnits,
    certificateId,
  };

  return {
    ...next,
    stateHash: hashCanonicalObject(next),
  };
}
