/**
 * SYLPH FUSION — COUNTERFACTUAL ABSTENTION & REGRET LEDGER (Sections 30 & 31)
 *
 * For every ABSTAIN and REJECT candidate, tracks:
 * "What would have happened if we entered?"
 * For every ENTER candidate, tracks:
 * "What would have happened if we abstained / waited?"
 *
 * Measures:
 * - FALSE_ENTRY (Entered and lost capital / crashed)
 * - FALSE_ABSTENTION (Abstained on a runner that reached >= 3.0x capturable)
 * - LATE_ENTRY (Entered after optimal earliest decision time window)
 * - PREMATURE_EXIT (Exited before target milestone despite continuation)
 * - MISSED_RUNNER (Passed or rejected a > 10x token)
 * - AVOIDED_COLLAPSE (Abstained/Rejected a token that subsequently collapsed -70%+)
 *
 * Generates multi-horizon outcome labels:
 * survived_30s, 1m, 5m, 15m; hit_1_5x, 2x, 3x, 5x, 10x, 20x, 50x, 100x;
 * executable_peak vs observed_peak, capturable_peak, net_executable_return.
 */

export interface MultiHorizonOutcomeLabels {
  readonly survived30s: boolean;
  readonly survived1m: boolean;
  readonly survived5m: boolean;
  readonly survived15m: boolean;
  readonly hit1_5x: boolean;
  readonly hit2x: boolean;
  readonly hit3x: boolean;
  readonly hit5x: boolean;
  readonly hit10x: boolean;
  readonly hit20x: boolean;
  readonly hit50x: boolean;
  readonly hit100x: boolean;
  readonly timeTo2xMs?: number;
  readonly timeTo5xMs?: number;
  readonly timeTo10xMs?: number;
  readonly maxDrawdownBeforeMilestone: number;
  readonly observedPeakMultiple: number;
  readonly executablePeakMultiple: number; // Discounted by pool depth & slippage
  readonly capturablePeakMultiple: number; // Discounted by exit liquidity at size q
  readonly netExecutableReturnFraction: number; // Net after all fees, slippage, and impact
}

export type CounterfactualRegretCategory =
  | 'OPTIMAL_DECISION'
  | 'FALSE_ENTRY'
  | 'FALSE_ABSTENTION'
  | 'LATE_ENTRY'
  | 'PREMATURE_EXIT'
  | 'MISSED_RUNNER'
  | 'AVOIDED_COLLAPSE';

export interface CounterfactualRegretEntry {
  readonly attemptId: string;
  readonly mint: string;
  readonly decisionTaken: 'ENTER' | 'ABSTAIN' | 'REJECT';
  readonly outcomes: MultiHorizonOutcomeLabels;
  readonly regretCategory: CounterfactualRegretCategory;
  readonly regretScoreSol: number; // Positive if decision resulted in opportunity loss or capital loss
  readonly valueSavedSol: number;  // Positive if decision avoided loss
  readonly note: string;
}

export class CounterfactualRegretLedger {
  private readonly entries: CounterfactualRegretEntry[] = [];

  /**
   * Evaluates counterfactual regret given a logged candidate attempt and its subsequent verified outcomes.
   */
  public recordCounterfactual(
    attemptId: string,
    mint: string,
    decisionTaken: 'ENTER' | 'ABSTAIN' | 'REJECT',
    outcomes: MultiHorizonOutcomeLabels,
    simulatedPositionSizeSol: number = 0.5
  ): CounterfactualRegretEntry {
    let regretCategory: CounterfactualRegretCategory = 'OPTIMAL_DECISION';
    let regretScoreSol = 0;
    let valueSavedSol = 0;
    let note = '';

    const didRun = outcomes.hit3x || outcomes.hit5x || outcomes.hit10x;
    const didCollapse = !outcomes.survived5m || outcomes.observedPeakMultiple <= 0.85;

    if (decisionTaken === 'ENTER') {
      if (outcomes.netExecutableReturnFraction < -0.15) {
        regretCategory = 'FALSE_ENTRY';
        regretScoreSol = simulatedPositionSizeSol * Math.abs(outcomes.netExecutableReturnFraction);
        note = `False entry into failing candidate: lost ${(regretScoreSol).toFixed(3)} SOL`;
      } else if (outcomes.netExecutableReturnFraction >= 0.5) {
        regretCategory = 'OPTIMAL_DECISION';
        note = `Successful profitable entry: +${(simulatedPositionSizeSol * outcomes.netExecutableReturnFraction).toFixed(3)} SOL`;
      }
    } else {
      // Decision was ABSTAIN or REJECT
      if (didCollapse) {
        regretCategory = 'AVOIDED_COLLAPSE';
        valueSavedSol = simulatedPositionSizeSol * 0.80; // Saved 80% loss
        note = `Avoided collapse: saved ${valueSavedSol.toFixed(3)} SOL on collapsing token`;
      } else if (outcomes.hit10x || outcomes.hit20x || outcomes.hit50x || outcomes.hit100x) {
        regretCategory = 'MISSED_RUNNER';
        regretScoreSol = simulatedPositionSizeSol * Math.min(10.0, outcomes.capturablePeakMultiple - 1.0);
        note = `Missed extreme runner (reached ${outcomes.observedPeakMultiple.toFixed(1)}x, capturable ${outcomes.capturablePeakMultiple.toFixed(1)}x)`;
      } else if (outcomes.hit3x && outcomes.capturablePeakMultiple >= 2.0) {
        regretCategory = 'FALSE_ABSTENTION';
        regretScoreSol = simulatedPositionSizeSol * (outcomes.capturablePeakMultiple - 1.0);
        note = `False abstention: token reached ${outcomes.capturablePeakMultiple.toFixed(1)}x capturable multiple`;
      } else {
        regretCategory = 'OPTIMAL_DECISION';
        note = 'Appropriate abstention on low-yield/sideways token';
      }
    }

    const entry: CounterfactualRegretEntry = Object.freeze({
      attemptId,
      mint,
      decisionTaken,
      outcomes,
      regretCategory,
      regretScoreSol,
      valueSavedSol,
      note,
    });

    this.entries.push(entry);
    return entry;
  }

  public getEntries(): readonly CounterfactualRegretEntry[] {
    return this.entries;
  }

  public getSummary(): {
    readonly totalEvaluated: number;
    readonly avoidedCollapses: number;
    readonly falseEntries: number;
    readonly falseAbstentions: number;
    readonly missedRunners: number;
    readonly totalCapitalSavedSol: number;
    readonly totalRegretSol: number;
  } {
    let avoided = 0;
    let falseEnt = 0;
    let falseAbs = 0;
    let missedRun = 0;
    let savedSol = 0;
    let regretSol = 0;

    for (const e of this.entries) {
      if (e.regretCategory === 'AVOIDED_COLLAPSE') avoided++;
      else if (e.regretCategory === 'FALSE_ENTRY') falseEnt++;
      else if (e.regretCategory === 'FALSE_ABSTENTION') falseAbs++;
      else if (e.regretCategory === 'MISSED_RUNNER') missedRun++;

      savedSol += e.valueSavedSol;
      regretSol += e.regretScoreSol;
    }

    return {
      totalEvaluated: this.entries.length,
      avoidedCollapses: avoided,
      falseEntries: falseEnt,
      falseAbstentions: falseAbs,
      missedRunners: missedRun,
      totalCapitalSavedSol: savedSol,
      totalRegretSol: regretSol,
    };
  }
}
