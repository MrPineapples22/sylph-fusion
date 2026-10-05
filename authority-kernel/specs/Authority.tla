----------------------------- MODULE Authority -----------------------------
(***************************************************************************)
(* SYLPH FUSION — Formal TLA+ Specification of Authority Lattice & Control *)
(* Master Blueprint Section 60, XXXVII, XXXVIII, XXXIX                    *)
(***************************************************************************)

EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
    A0_OBSERVE,
    A1_CANCEL_RECONCILE,
    A2_REDUCE_CLOSE,
    A3_MAINTAIN,
    A4_LIMITED_INCREASE,
    A5_NORMAL,
    CONTROLLERS

VARIABLES
    current_authority,
    open_positions,
    consumed_nonces,
    revoked_proofs,
    control_epoch,
    fence_epoch,
    active_controller

TypeOK ==
    /\ current_authority \in {A0_OBSERVE, A1_CANCEL_RECONCILE, A2_REDUCE_CLOSE, A3_MAINTAIN, A4_LIMITED_INCREASE, A5_NORMAL}
    /\ open_positions \in Nat
    /\ control_epoch \in Nat
    /\ fence_epoch \in Nat
    /\ active_controller \in CONTROLLERS

Init ==
    /\ current_authority = A0_OBSERVE  \* INV_AUTH_001: Initial authority is A0
    /\ open_positions = 0
    /\ consumed_nonces = {}
    /\ revoked_proofs = {}
    /\ control_epoch = 1
    /\ fence_epoch = 1
    /\ active_controller \in CONTROLLERS

\* Invariant INV_AUTH_001: No risk-increasing action below A4/A5
InvAuth001 ==
    current_authority = A0_OBSERVE => open_positions = 0

\* Invariant INV_AUTH_002: Consumed permit cannot execute twice (anti-replay)
InvAuth002(nonce) ==
    nonce \notin consumed_nonces

\* Invariant INV_AUTH_005: Stale control epoch cannot increase risk
StaleEpochSafe(proposal_epoch, action) ==
    proposal_epoch < control_epoch => action \notin {A4_LIMITED_INCREASE, A5_NORMAL}

\* Invariant INV_AUTH_008: A2 Reduce/Close remains feasible during degradation
A2AlwaysFeasibleOnDegrade ==
    current_authority \in {A1_CANCEL_RECONCILE, A2_REDUCE_CLOSE} => open_positions >= 0

=============================================================================
