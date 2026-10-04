----------------------------- MODULE Execution -----------------------------
(***************************************************************************)
(* SYLPH FUSION — Formal TLA+ Specification of Execution Authority          *)
(* Master Blueprint Section XXXVII, XXXIX                                   *)
(***************************************************************************)

EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
    INTENTS,
    PERMITS

VARIABLES
    intent_state,
    reserved_capital,
    settled_capital

Init ==
    /\ intent_state = "IDLE"
    /\ reserved_capital = 0
    /\ settled_capital = 0

\* Invariant INV_AUTH_007: Unknown settlement retains risk (capital stays reserved)
UnknownExecutionConsumesRisk ==
    intent_state = "UNKNOWN" => reserved_capital > 0

=============================================================================
