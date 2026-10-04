/**
 * VON NEUMANN: Formal Execution State Machine
 * Blueprint Engine #29
 *
 * Enforces strictly linear, non-bypassable execution state transitions:
 * OBSERVE -> ANALYZE -> PROPOSE -> RISK_CHECKED -> SECURITY_CHECKED ->
 * SIMULATED -> AUTHORIZED -> SIGNED -> SUBMITTED -> CONFIRMED -> RECONCILED.
 * Invariant: Illegal state transitions are impossible; approvals expire automatically.
 */
export class VonNeumannExecutionStateMachine {
    static VERSION = '2.0.0';
    static VALID_TRANSITIONS = {
        OBSERVE: ['ANALYZE', 'ABORTED'],
        ANALYZE: ['PROPOSE', 'ABORTED'],
        PROPOSE: ['RISK_CHECKED', 'ABORTED'],
        RISK_CHECKED: ['SECURITY_CHECKED', 'ABORTED'],
        SECURITY_CHECKED: ['SIMULATED', 'ABORTED'],
        SIMULATED: ['AUTHORIZED', 'ABORTED'],
        AUTHORIZED: ['SIGNED', 'ABORTED'],
        SIGNED: ['SUBMITTED', 'ABORTED'],
        SUBMITTED: ['CONFIRMED', 'FINALIZED_SUCCESS', 'FINALIZED_INSTRUCTION_FAILURE', 'EXPIRED_NO_LAND_QUORUM', 'ABORTED'],
        // Invariant 5: CONFIRMED cannot mutate finalized economic state or reconcile directly. Must reach terminal finality.
        CONFIRMED: ['FINALIZED_SUCCESS', 'FINALIZED_INSTRUCTION_FAILURE', 'EXPIRED_NO_LAND_QUORUM', 'ABORTED'],
        FINALIZED_SUCCESS: ['RECONCILED', 'ABORTED'],
        FINALIZED_INSTRUCTION_FAILURE: ['RECONCILED', 'ABORTED'],
        EXPIRED_NO_LAND_QUORUM: ['RECONCILED', 'ABORTED'],
        RECONCILED: [],
        ABORTED: []
    };
    /**
     * Initializes a formal execution intent starting in the OBSERVE state.
     */
    static createIntent(params) {
        const now = Date.now();
        return {
            intent_id: `vn_${params.token_mint.slice(0, 6)}_${now}`,
            token_mint: params.token_mint,
            action: params.action,
            amount_lamports: params.amount_lamports,
            max_slippage_bps: params.max_slippage_bps,
            state: 'OBSERVE',
            history: [{ state: 'OBSERVE', timestamp_ms: now }],
            created_at_ms: now,
            expires_at_ms: now + (params.ttl_ms ?? 5000)
        };
    }
    /**
     * Transitions the execution intent to the next valid state. Throws if illegal.
     */
    static transition(intent, targetState, metadata, nowMs = Date.now()) {
        // Check expiration
        if (nowMs > intent.expires_at_ms && targetState !== 'ABORTED') {
            throw new Error(`[VON NEUMANN] Intent ${intent.intent_id} expired. Cannot transition to ${targetState}.`);
        }
        const allowedNext = this.VALID_TRANSITIONS[intent.state];
        if (!allowedNext.includes(targetState)) {
            throw new Error(`[VON NEUMANN ILLEGAL TRANSITION] Attempted invalid state advance: ${intent.state} -> ${targetState}. Must strictly adhere to formal state machine.`);
        }
        // Gate checks
        if (targetState === 'RISK_CHECKED' && !metadata?.guardian_token) {
            throw new Error('[VON NEUMANN] Cannot enter RISK_CHECKED without Guardian authorization token.');
        }
        if (targetState === 'SECURITY_CHECKED' && !metadata?.sentinel_hash) {
            throw new Error('[VON NEUMANN] Cannot enter SECURITY_CHECKED without Sentinel verification hash.');
        }
        return {
            ...intent,
            state: targetState,
            guardian_approval_token: metadata?.guardian_token ?? intent.guardian_approval_token,
            sentinel_verification_hash: metadata?.sentinel_hash ?? intent.sentinel_verification_hash,
            simulation_ev_pnl: metadata?.sim_ev_pnl ?? intent.simulation_ev_pnl,
            tx_hash: metadata?.tx_hash ?? intent.tx_hash,
            history: [...intent.history, { state: targetState, timestamp_ms: nowMs }]
        };
    }
}
//# sourceMappingURL=von-neumann-machine.js.map