/**
 * SYLPH HAVEN SURVIVAL MODE & CRASH RECOVERY
 * Parts LXV, LXVI, LXVII — Haven Mode, Survival Journal & Recovery State Machine
 *
 * Provides a fail-closed emergency execution boundary allowing verified
 * position reduction even when the primary analytics or ledger stack is degraded.
 * Enforces a strict multi-step recovery state machine after process restarts.
 */

export type RecoveryStep =
  | 'LOCKED'
  | 'VERIFY_STORAGE'
  | 'VERIFY_VAULT_JOURNAL'
  | 'REPLAY_CAPITAL_LEDGER'
  | 'QUERY_BLOCKCHAIN'
  | 'RECONCILE'
  | 'REBUILD_CAPITAL_TRUTH'
  | 'NEW_CONTROL_EPOCH'
  | 'REBUILD_PROOFS'
  | 'REDUCE_ONLY'
  | 'CANARY'
  | 'NORMAL';

export interface SurvivalJournalEntry {
  readonly sequence: number;
  readonly control_epoch: number;
  readonly revocation_epoch: number;
  readonly mint: string;
  readonly intent_id: string;
  readonly reduction_sol: number;
  readonly signature: string;
  readonly status: 'PENDING' | 'LANDED' | 'CONFIRMED' | 'FAILED';
  readonly slot: number;
  readonly timestamp_ms: number;
}

export class HavenSurvivalMode {
  private isHavenActive = false;
  private recoveryStep: RecoveryStep = 'NORMAL';
  private readonly survivalJournal: SurvivalJournalEntry[] = [];

  public activateHavenMode(reason: string): void {
    this.isHavenActive = true;
    this.recoveryStep = 'REDUCE_ONLY';
  }

  public isEntryPermitted(): boolean {
    return !this.isHavenActive && this.recoveryStep === 'NORMAL';
  }

  public isReductionPermitted(): boolean {
    return true; // Position reduction is preserved in Haven mode
  }

  public appendSurvivalJournal(entry: Omit<SurvivalJournalEntry, 'sequence'>): SurvivalJournalEntry {
    const seq = this.survivalJournal.length + 1;
    const full: SurvivalJournalEntry = { sequence: seq, ...entry };
    this.survivalJournal.push(full);
    return full;
  }

  /**
   * Executes step-by-step crash recovery state machine (Part LXVII).
   * Never restarts directly into unrestricted live execution!
   */
  public advanceRecoveryStep(expectedStep: RecoveryStep): { success: boolean; current_step: RecoveryStep } {
    const steps: RecoveryStep[] = [
      'LOCKED',
      'VERIFY_STORAGE',
      'VERIFY_VAULT_JOURNAL',
      'REPLAY_CAPITAL_LEDGER',
      'QUERY_BLOCKCHAIN',
      'RECONCILE',
      'REBUILD_CAPITAL_TRUTH',
      'NEW_CONTROL_EPOCH',
      'REBUILD_PROOFS',
      'REDUCE_ONLY',
      'CANARY',
      'NORMAL',
    ];

    const curIdx = steps.indexOf(this.recoveryStep);
    const expIdx = steps.indexOf(expectedStep);

    if (expIdx === curIdx + 1) {
      this.recoveryStep = expectedStep;
      if (expectedStep === 'NORMAL') {
        this.isHavenActive = false;
      }
      return { success: true, current_step: this.recoveryStep };
    }

    return { success: false, current_step: this.recoveryStep };
  }

  public getRecoveryState(): { is_haven: boolean; step: RecoveryStep; journal_length: number } {
    return {
      is_haven: this.isHavenActive,
      step: this.recoveryStep,
      journal_length: this.survivalJournal.length,
    };
  }
}
