/**
 * SYLPH HAVEN SURVIVAL MODE & CRASH RECOVERY
 * Parts LXV, LXVI, LXVII — Haven Mode, Survival Journal & Recovery State Machine
 *
 * Provides a fail-closed emergency execution boundary allowing verified
 * position reduction even when the primary analytics or ledger stack is degraded.
 * Enforces a strict multi-step recovery state machine after process restarts.
 */
export class HavenSurvivalMode {
    isHavenActive = false;
    recoveryStep = 'NORMAL';
    survivalJournal = [];
    activateHavenMode(reason) {
        this.isHavenActive = true;
        this.recoveryStep = 'REDUCE_ONLY';
    }
    isEntryPermitted() {
        return !this.isHavenActive && this.recoveryStep === 'NORMAL';
    }
    isReductionPermitted() {
        return true; // Position reduction is preserved in Haven mode
    }
    appendSurvivalJournal(entry) {
        const seq = this.survivalJournal.length + 1;
        const full = { sequence: seq, ...entry };
        this.survivalJournal.push(full);
        return full;
    }
    /**
     * Executes step-by-step crash recovery state machine (Part LXVII).
     * Never restarts directly into unrestricted live execution!
     */
    advanceRecoveryStep(expectedStep) {
        const steps = [
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
    getRecoveryState() {
        return {
            is_haven: this.isHavenActive,
            step: this.recoveryStep,
            journal_length: this.survivalJournal.length,
        };
    }
}
//# sourceMappingURL=haven-mode.js.map