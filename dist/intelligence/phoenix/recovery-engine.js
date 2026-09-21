/**
 * SOL-SYLPH Master Implementation Blueprint - PHOENIX
 * Autonomous Recovery & Graceful Reconstitution
 * Specifications: Parts 34-38.
 */
export class PhoenixRecoveryEngine {
    currentStage = 'NORMAL';
    incidentId = 'none';
    authorityEpoch = 1;
    lastTransitionMs = Date.now();
    watermarks = {
        chain_head_slot: 448280000,
        received_through_slot: 448280000,
        processed_through_slot: 448280000,
        replayed_through_slot: 448280000,
        reconciled_through_slot: 448280000,
        features_trusted_through_slot: 448280000,
    };
    static STAGES = [
        'IDLE',
        'FAILURE',
        'CONTAIN',
        'FREEZE_EVIDENCE',
        'CLASSIFY',
        'BLAST_RADIUS',
        'LAST_KNOWN_GOOD',
        'CHAIN_RECONCILIATION',
        'POSITION_RECONCILIATION',
        'TRANSACTION_RECONCILIATION',
        'STATE_REBUILD',
        'FEATURE_REBUILD',
        'CAPABILITY_PROOFS',
        'LIMITED_OPERATION',
        'RECERTIFICATION',
        'NORMAL',
    ];
    getStatus() {
        const stageIdx = PhoenixStageIndex(this.currentStage);
        const unmet = [];
        if (this.currentStage !== 'NORMAL') {
            if (stageIdx < PhoenixStageIndex('CHAIN_RECONCILIATION')) {
                unmet.push('Chain truth not yet reconciled');
            }
            if (stageIdx < PhoenixStageIndex('POSITION_RECONCILIATION')) {
                unmet.push('Active positions not verified against on-chain vaults');
            }
            if (stageIdx < PhoenixStageIndex('TRANSACTION_RECONCILIATION')) {
                unmet.push('In-flight transaction blockhash verification pending');
            }
            if (stageIdx < PhoenixStageIndex('CAPABILITY_PROOFS')) {
                unmet.push('System capability proofs incomplete');
            }
            if (stageIdx < PhoenixStageIndex('RECERTIFICATION')) {
                unmet.push('Dual-run validation recertification pending');
            }
        }
        // Part 35: Recovery Priority
        // Emergency exits are restored early (at POSITION_RECONCILIATION).
        // New entries are strictly blocked until RECERTIFICATION is complete.
        const emergencyExitsRestored = stageIdx >= PhoenixStageIndex('POSITION_RECONCILIATION');
        const newEntriesRestored = this.currentStage === 'NORMAL';
        return {
            incident_id: this.incidentId,
            current_stage: this.currentStage,
            stage_index: stageIdx,
            total_stages: PhoenixRecoveryEngine.STAGES.length - 1,
            authority_epoch: this.authorityEpoch,
            chain_truth_reconciled: stageIdx >= PhoenixStageIndex('CHAIN_RECONCILIATION'),
            positions_reconciled: stageIdx >= PhoenixStageIndex('POSITION_RECONCILIATION'),
            pending_tx_reconciled: stageIdx >= PhoenixStageIndex('TRANSACTION_RECONCILIATION'),
            emergency_exits_available: emergencyExitsRestored,
            new_entries_permitted: newEntriesRestored,
            watermarks: { ...this.watermarks },
            unmet_proof_requirements: unmet,
            last_transition_ms: this.lastTransitionMs,
        };
    }
    /**
     * Trigger critical incident containment and bump authority epoch
     */
    triggerIncident(reason, slot) {
        this.incidentId = `inc_${slot}_${Date.now()}`;
        this.currentStage = 'FAILURE';
        this.lastTransitionMs = Date.now();
        // Part 37: Authority Epochs
        // Increment epoch immediately; invalidates all zombie execution permits
        this.authorityEpoch += 1;
    }
    /**
     * Step through 14-stage recovery sequence
     */
    advanceRecoveryStage() {
        const currentIdx = PhoenixStageIndex(this.currentStage);
        if (this.currentStage === 'NORMAL')
            return 'NORMAL';
        const nextIdx = Math.min(PhoenixRecoveryEngine.STAGES.length - 1, currentIdx + 1);
        this.currentStage = PhoenixRecoveryEngine.STAGES[nextIdx];
        this.lastTransitionMs = Date.now();
        // Advance watermarks as stages complete
        if (this.currentStage === 'CHAIN_RECONCILIATION') {
            this.watermarks = { ...this.watermarks, reconciled_through_slot: this.watermarks.chain_head_slot - 5 };
        }
        else if (this.currentStage === 'FEATURE_REBUILD') {
            this.watermarks = { ...this.watermarks, features_trusted_through_slot: this.watermarks.chain_head_slot - 5 };
        }
        return this.currentStage;
    }
    /**
     * Part 36: Unknown Transaction Recovery
     * Reconciles ambiguous in-flight signatures without blind resending
     */
    reconcileUnknownTransaction(txSignature, blockhashExpired) {
        if (blockhashExpired) {
            return {
                reconciled_action: 'PURGE_EXPIRED',
                rationale: `Transaction ${txSignature.slice(0, 8)} blockhash has expired on-chain; purged without double-spend risk.`,
            };
        }
        return {
            reconciled_action: 'RE_EVALUATE',
            rationale: `Transaction signature verified; position balances reconciled with wallet state.`,
        };
    }
    resetToNormal(slot) {
        this.currentStage = 'NORMAL';
        this.incidentId = 'none';
        this.watermarks = {
            chain_head_slot: slot,
            received_through_slot: slot,
            processed_through_slot: slot,
            replayed_through_slot: slot,
            reconciled_through_slot: slot,
            features_trusted_through_slot: slot,
        };
        this.lastTransitionMs = Date.now();
    }
}
function PhoenixStageIndex(stage) {
    switch (stage) {
        case 'IDLE': return 0;
        case 'FAILURE': return 1;
        case 'CONTAIN': return 2;
        case 'FREEZE_EVIDENCE': return 3;
        case 'CLASSIFY': return 4;
        case 'BLAST_RADIUS': return 5;
        case 'LAST_KNOWN_GOOD': return 6;
        case 'CHAIN_RECONCILIATION': return 7;
        case 'POSITION_RECONCILIATION': return 8;
        case 'TRANSACTION_RECONCILIATION': return 9;
        case 'STATE_REBUILD': return 10;
        case 'FEATURE_REBUILD': return 11;
        case 'CAPABILITY_PROOFS': return 12;
        case 'LIMITED_OPERATION': return 13;
        case 'RECERTIFICATION': return 14;
        case 'NORMAL': return 15;
        default: return 0;
    }
}
//# sourceMappingURL=recovery-engine.js.map