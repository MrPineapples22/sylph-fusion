import { DEFAULT_LIFECYCLE_CONFIG, } from './types.js';
export const VALID_TRANSITIONS = {
    CREATED: ['AWAITING_DEPOSIT', 'PAUSED'],
    AWAITING_DEPOSIT: ['DEPOSIT_DETECTED', 'PAUSED', 'CLOSED'],
    DEPOSIT_DETECTED: ['CONFIRMING', 'AWAITING_DEPOSIT', 'RECONCILIATION_FAILED'],
    CONFIRMING: ['FUNDED', 'DEPOSIT_DETECTED', 'RECONCILIATION_FAILED'],
    FUNDED: ['ACTIVATION_PENDING', 'PAUSED', 'SETTLEMENT_READY'],
    ACTIVATION_PENDING: ['ACTIVE', 'PAUSED', 'RISK_FROZEN'],
    ACTIVE: ['PRESERVATION', 'EXITING', 'PAUSED', 'RISK_FROZEN', 'SECURITY_HOLD', 'RECOVERY_REQUIRED'],
    PRESERVATION: ['EXITING', 'ACTIVE', 'PAUSED', 'RISK_FROZEN', 'SECURITY_HOLD', 'RECOVERY_REQUIRED'],
    EXITING: ['RECONCILING', 'PRESERVATION', 'PAUSED', 'RISK_FROZEN', 'SECURITY_HOLD', 'RECOVERY_REQUIRED'],
    RECONCILING: ['SETTLEMENT_READY', 'RECONCILIATION_FAILED', 'RECOVERY_REQUIRED'],
    SETTLEMENT_READY: ['SETTLEMENT_SUBMITTED', 'PAUSED', 'SECURITY_HOLD', 'RECONCILING'],
    SETTLEMENT_SUBMITTED: ['SETTLED', 'SETTLEMENT_FAILED', 'RECOVERY_REQUIRED'],
    SETTLED: ['CLOSED', 'FUNDED'], // Can roll over into a new funded cycle
    CLOSED: [],
    // Exceptional States transitions
    PAUSED: ['ACTIVE', 'PRESERVATION', 'EXITING', 'FUNDED', 'CLOSED', 'RECOVERY_REQUIRED'],
    RISK_FROZEN: ['PRESERVATION', 'EXITING', 'RECOVERY_REQUIRED'],
    SECURITY_HOLD: ['EXITING', 'RECOVERY_REQUIRED', 'PAUSED'],
    RECONCILIATION_FAILED: ['RECOVERY_REQUIRED', 'PAUSED'],
    SETTLEMENT_FAILED: ['SETTLEMENT_READY', 'RECOVERY_REQUIRED', 'PAUSED'],
    RECOVERY_REQUIRED: ['ACTIVE', 'PRESERVATION', 'EXITING', 'RECONCILING', 'SETTLEMENT_READY', 'CLOSED'],
};
export class VaultLifecycleController {
    clocks = new Map();
    /**
     * Starts an authoritative 72-hour cycle for a vault.
     * Start timestamp is authoritative and immutable across restarts.
     */
    startCycle(vaultId, cycleId, startTimeMs = Date.now(), phaseConfig = DEFAULT_LIFECYCLE_CONFIG) {
        const totalCycleDurationSec = phaseConfig.phase4SettlementPrepEndSec;
        const scheduledEndAtMs = startTimeMs + totalCycleDurationSec * 1000;
        const clock = {
            cycleId,
            vaultId,
            authoritativeStartedAtMs: startTimeMs,
            scheduledEndAtMs,
            totalCycleDurationSec,
            phaseConfig,
        };
        this.clocks.set(vaultId, clock);
        return clock;
    }
    getClock(vaultId) {
        return this.clocks.get(vaultId);
    }
    restoreClock(clock) {
        this.clocks.set(clock.vaultId, clock);
    }
    /**
     * Validates and executes a state transition.
     * Throws an error if the transition is not allowed by the state machine graph.
     */
    transition(currentState, nextState, vaultId) {
        const allowed = VALID_TRANSITIONS[currentState];
        if (!allowed || !allowed.includes(nextState)) {
            throw new Error(`Illegal state transition for vault ${vaultId}: Cannot transition from ${currentState} to ${nextState}`);
        }
        return nextState;
    }
    /**
     * Evaluates the current lifecycle phase of a running vault.
     * Enforces phased de-risking and prevents late entries near settlement.
     */
    evaluatePhase(vaultId, nowMs = Date.now()) {
        const clock = this.clocks.get(vaultId);
        if (!clock) {
            return {
                phase: 'PHASE_1_NORMAL',
                elapsedSec: 0,
                remainingSec: 0,
                allowNewEntries: false,
                maxHoldHorizonSec: 0,
                exposureMultiplier: 0,
                liquidityFloorMultiplier: 1,
                reason: 'No active cycle clock registered',
            };
        }
        const elapsedSec = Math.max(0, Math.floor((nowMs - clock.authoritativeStartedAtMs) / 1000));
        const remainingSec = Math.max(0, Math.floor((clock.scheduledEndAtMs - nowMs) / 1000));
        const cfg = clock.phaseConfig;
        if (elapsedSec < cfg.phase1NormalEndSec) {
            // 0–48 Hours: Normal Trading
            return {
                phase: 'PHASE_1_NORMAL',
                elapsedSec,
                remainingSec,
                allowNewEntries: true,
                maxHoldHorizonSec: 1800, // 30 min max hold
                exposureMultiplier: 1.0,
                liquidityFloorMultiplier: 1.0,
                reason: 'Normal growth cycle phase',
            };
        }
        else if (elapsedSec < cfg.phase2PreservationEndSec) {
            // 48–60 Hours: Increasing Preservation
            return {
                phase: 'PHASE_2_PRESERVATION',
                elapsedSec,
                remainingSec,
                allowNewEntries: true,
                maxHoldHorizonSec: 600, // 10 min max hold
                exposureMultiplier: 0.5, // 50% reduced position sizing
                liquidityFloorMultiplier: 1.5, // 50% higher liquidity required
                reason: 'Preservation phase: reduced exposure and tighter horizons',
            };
        }
        else if (elapsedSec < cfg.phase3HarvestEndSec) {
            // 60–68 Hours: Harvest & Exposure Reduction
            return {
                phase: 'PHASE_3_HARVEST',
                elapsedSec,
                remainingSec,
                allowNewEntries: false, // NO NEW ENTRIES ALLOWED
                maxHoldHorizonSec: 180, // 3 min max emergency exit window
                exposureMultiplier: 0.0,
                liquidityFloorMultiplier: 2.5,
                reason: 'Harvest phase: strictly closing and de-risking existing positions',
            };
        }
        else {
            // 68–72 Hours: Settlement Preparation
            return {
                phase: 'PHASE_4_SETTLEMENT_PREP',
                elapsedSec,
                remainingSec,
                allowNewEntries: false, // NO NEW ENTRIES ALLOWED
                maxHoldHorizonSec: 0, // All positions must be 100% liquidated
                exposureMultiplier: 0.0,
                liquidityFloorMultiplier: 5.0,
                reason: 'Settlement prep: all positions must be closed, preparing for reconciliation',
            };
        }
    }
}
//# sourceMappingURL=state-machine.js.map