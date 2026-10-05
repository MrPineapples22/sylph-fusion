------------------------------ MODULE Recovery ------------------------------
(***************************************************************************)
(* SYLPH FUSION — Formal TLA+ Specification of Recovery Invariants          *)
(* Master Blueprint Section 60, XXXVII, Invariant 7 (INV_AUTH_009)          *)
(***************************************************************************)

EXTENDS Integers

VARIABLES
    authority_pre_crash,
    authority_post_restart,
    in_flight_pre_crash,
    in_flight_post_restart,
    fence_epoch_pre_failover,
    fence_epoch_post_failover

Init ==
    /\ authority_pre_crash = 5   \* A5
    /\ authority_post_restart = 0 \* A0
    /\ in_flight_pre_crash = 1
    /\ in_flight_post_restart = 1
    /\ fence_epoch_pre_failover = 1
    /\ fence_epoch_post_failover = 2

\* Invariant INV_AUTH_009: Crash/restart resets authority to A0 (fail-closed)
InvAuth009 ==
    authority_post_restart <= authority_pre_crash /\ authority_post_restart = 0

\* Invariant: In-flight facts survive crash and are not silently dropped
InFlightFactsPreserved ==
    in_flight_post_restart = in_flight_pre_crash

\* Invariant: Controller failover strictly advances fence epoch
FailoverAdvancesFence ==
    fence_epoch_post_failover > fence_epoch_pre_failover

=============================================================================
