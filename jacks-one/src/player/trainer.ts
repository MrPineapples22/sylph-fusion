import { parseHand } from '../core/hand.ts';
import type { Hand } from '../core/hand.ts';
import { DigitalTwin, type PlayerDecisionRecord } from './digital_twin.ts';
import { CANONICAL_STRATEGY_BENCHMARKS, type BenchmarkCase } from '../verification/benchmarks.ts';

export interface TrainingChallenge {
  readonly id: string;
  readonly hand: Hand;
  readonly scenarioName: string;
  readonly context: string;
}

export class JacksTrainer {
  private readonly twin = new DigitalTwin();
  private currentIndex = 0;

  public getNextChallenge(): TrainingChallenge {
    const bm = CANONICAL_STRATEGY_BENCHMARKS[this.currentIndex % CANONICAL_STRATEGY_BENCHMARKS.length];
    this.currentIndex++;

    return {
      id: bm.id,
      hand: parseHand(bm.handStr),
      scenarioName: bm.name,
      context: bm.rationale,
    };
  }

  public submitHold(challenge: TrainingChallenge, chosenMask: number): PlayerDecisionRecord {
    return this.twin.recordDecision(challenge.hand, chosenMask);
  }

  public getTwin(): DigitalTwin {
    return this.twin;
  }
}
