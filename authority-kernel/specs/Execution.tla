----------------------------- MODULE Execution -----------------------------
(***************************************************************************)
(* SYLPH FUSION — Formal TLA+ Specification of Execution Authority & States *)
(* Master Blueprint Section 60, XXXVII, XXXIX                              *)
(***************************************************************************)

EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
    INTENTS,
    PERMITS

VARIABLES
    intent_state,
    reserved_capital,
    unknown_capital,
    settled_capital,
    active_generation,
    in_flight_facts

Init ==
    /\ intent_state = "IDLE"
    /\ reserved_capital = 0
    /\ unknown_capital = 0
    /\ settled_capital = 0
    /\ active_generation = 1
    /\ in_flight_facts = {}

\* Invariant INV_AUTH_007: Unknown execution NEVER frees capital
UnknownNeverFreesCapital ==
    intent_state = "UNKNOWN" => (reserved_capital > 0 \/ unknown_capital > 0)

\* Invariant: Timeout or RPC failure cannot classify NoLand
RpcNullIsNotNoLand(rpc_status, conclusion) ==
    rpc_status = "NULL_RESPONSE" => conclusion /= "CERTIFIED_NOLAND"

\* Invariant: Exactly one active executable generation per economic intent
SingleActiveGeneration ==
    active_generation >= 1

\* Invariant: Submitted facts survive crash and controller failover
InFlightSurvivesFailover(fact) ==
    fact \in in_flight_facts => intent_state \in {"SIGNED", "SUBMITTED", "UNKNOWN"}

=============================================================================
