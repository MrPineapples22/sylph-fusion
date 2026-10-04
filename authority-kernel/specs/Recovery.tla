------------------------------ MODULE Recovery ------------------------------
(***************************************************************************)
(* SYLPH FUSION — Formal TLA+ Specification of Recovery Invariants          *)
(* Master Blueprint Section XXXVII, Invariant 7 (INV_AUTH_009)              *)
(***************************************************************************)

EXTENDS Integers

VARIABLES
    authority_pre_crash,
    authority_post_restart

Init ==
    /\ authority_pre_crash = 5   \* A5
    /\ authority_post_restart = 0 \* A0

\* Invariant INV_AUTH_009: Crash/restart cannot increase authority
InvAuth009 ==
    authority_post_restart <= authority_pre_crash /\ authority_post_restart = 0

=============================================================================
