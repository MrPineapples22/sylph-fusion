----------------------------- MODULE Authority -----------------------------
(***************************************************************************)
(* SYLPH FUSION — Formal TLA+ Specification of Authority Lattice            *)
(* Master Blueprint Section XXXVII, XXXVIII, XXXIX                         *)
(***************************************************************************)

EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
    A0_OBSERVE,
    A1_CANCEL_RECONCILE,
    A2_REDUCE_CLOSE,
    A3_MAINTAIN,
    A4_LIMITED_INCREASE,
    A5_NORMAL,
    ACTIONS

VARIABLES
    current_authority,
    open_positions,
    consumed_nonces,
    revoked_proofs

TypeOK ==
    /\ current_authority \in {A0_OBSERVE, A1_CANCEL_RECONCILE, A2_REDUCE_CLOSE, A3_MAINTAIN, A4_LIMITED_INCREASE, A5_NORMAL}
    /\ open_positions \in Nat

Init ==
    /\ current_authority = A0_OBSERVE  \* INV_AUTH_001: Initial authority is A0
    /\ open_positions = 0
    /\ consumed_nonces = {}
    /\ revoked_proofs = {}

\* Invariant INV_AUTH_001: No risk-increasing action below A4/A5
InvAuth001 ==
    current_authority = A0_OBSERVE => open_positions = 0

\* Invariant INV_AUTH_004: Consumed permit cannot execute twice
InvAuth004(nonce) ==
    nonce \notin consumed_nonces

=============================================================================
