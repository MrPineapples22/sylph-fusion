import type { Hand } from '../core/hand.ts';
import { rationalToNumber } from '../core/rational.ts';
import { solveHandOracle } from '../engine_a/oracle.ts';
import { diagnoseMistake, type MisconceptionDiagnosis } from './misconceptions.ts';

export interface PlayerDecisionRecord {
  readonly handCards: string[];
  readonly chosenMask: number;
  readonly optimalMask: number;
  readonly chosenEV: number;
  readonly optimalEV: number;
  readonly evLoss: number;
  readonly diagnosis: MisconceptionDiagnosis;
  readonly timestamp: string;
}

export class DigitalTwin {
  private readonly history: PlayerDecisionRecord[] = [];

  public recordDecision(hand: Hand, chosenMask: number): PlayerDecisionRecord {
    const oracleResult = solveHandOracle(hand);
    const optimal = oracleResult.selectedHold;
    const chosenHold = oracleResult.allHolds.find((h) => h.mask === chosenMask)!;

    const optEV = rationalToNumber(optimal.exactEV);
    const chEV = rationalToNumber(chosenHold.exactEV);
    const evLoss = Math.max(0, optEV - chEV);

    const handSymbols = hand.cards.map((c) => c.symbol);
    const diagnosis = diagnoseMistake(handSymbols, chosenMask, optimal.mask, evLoss);

    const record: PlayerDecisionRecord = {
      handCards: handSymbols,
      chosenMask,
      optimalMask: optimal.mask,
      chosenEV: chEV,
      optimalEV: optEV,
      evLoss,
      diagnosis,
      timestamp: new Date().toISOString(),
    };

    this.history.push(record);
    return record;
  }

  public getTotalDecisions(): number {
    return this.history.length;
  }

  public getTotalLeakage(): number {
    return this.history.reduce((acc, r) => acc + r.evLoss, 0);
  }

  public getAccuracyRate(): number {
    if (this.history.length === 0) return 1.0;
    const correct = this.history.filter((r) => r.evLoss <= 0.0001).length;
    return correct / this.history.length;
  }

  public getHistory(): readonly PlayerDecisionRecord[] {
    return this.history;
  }
}
