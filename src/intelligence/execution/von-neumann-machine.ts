/**
 * VON NEUMANN: Formal Execution State Machine
 * Blueprint Engine #29
 * 
 * Enforces strictly linear, non-bypassable execution state transitions:
 * OBSERVE -> ANALYZE -> PROPOSE -> RISK_CHECKED -> SECURITY_CHECKED ->
 * SIMULATED -> AUTHORIZED -> SIGNED -> SUBMITTED -> CONFIRMED -> RECONCILED.
 * Invariant: Illegal state transitions are impossible; approvals expire automatically.
 */

export type ExecutionState = 
  | 'OBSERVE'
  | 'ANALYZE'
  | 'PROPOSE'
  | 'RISK_CHECKED'
  | 'SECURITY_CHECKED'
  | 'SIMULATED'
  | 'AUTHORIZED'
  | 'SIGNED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FINALIZED_SUCCESS'
  | 'FINALIZED_INSTRUCTION_FAILURE'
  | 'EXPIRED_NO_LAND_QUORUM'
  | 'RECONCILED'
  | 'ABORTED';

export interface FormalExecutionIntent {
  readonly intent_id: string;
  readonly token_mint: string;
  readonly action: 'BUY' | 'SELL';
  readonly amount_lamports: number;
  readonly max_slippage_bps: number;
  readonly state: ExecutionState;
  readonly history: readonly { readonly state: ExecutionState; readonly timestamp_ms: number }[];
  readonly guardian_approval_token?: string;
  readonly sentinel_verification_hash?: string;
  readonly simulation_ev_pnl?: number;
  readonly tx_hash?: string;
  readonly created_at_ms: number;
  readonly expires_at_ms: number;
}

export class VonNeumannExecutionStateMachine {
  public static readonly VERSION = '2.0.0';
  public static readonly VALID_TRANSITIONS: Record<ExecutionState, readonly ExecutionState[]> = {
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
  public static createIntent(params: {
    token_mint: string;
    action: 'BUY' | 'SELL';
    amount_lamports: number;
    max_slippage_bps: number;
    ttl_ms?: number;
  }): FormalExecutionIntent {
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
  public static transition(
    intent: FormalExecutionIntent,
    targetState: ExecutionState,
    metadata?: {
      guardian_token?: string;
      sentinel_hash?: string;
      sim_ev_pnl?: number;
      tx_hash?: string;
    },
    nowMs: number = Date.now()
  ): FormalExecutionIntent {
    // Check expiration
    if (nowMs > intent.expires_at_ms && targetState !== 'ABORTED') {
      throw new Error(`[VON NEUMANN] Intent ${intent.intent_id} expired. Cannot transition to ${targetState}.`);
    }

    const allowedNext = this.VALID_TRANSITIONS[intent.state];
    if (!allowedNext.includes(targetState)) {
      throw new Error(
        `[VON NEUMANN ILLEGAL TRANSITION] Attempted invalid state advance: ${intent.state} -> ${targetState}. Must strictly adhere to formal state machine.`
      );
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
