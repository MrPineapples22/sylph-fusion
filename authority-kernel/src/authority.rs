//! SYLPH FUSION — AUTHORITY LATTICE DEFINITION
//! Specifications: Master Blueprint Section XXXVIII (Authority Kernel Rules)
//!
//! Invariants:
//! - Initial authority is A0_OBSERVE (never A5_NORMAL)
//! - Lattice ordering:
//!   A0_OBSERVE <= A1_CANCEL_RECONCILE <= A2_REDUCE_CLOSE <= A3_MAINTAIN <= A4_LIMITED_INCREASE <= A5_NORMAL
//! - Formally verified subset inclusion:
//!   Allowed(A0) ⊆ Allowed(A1) ⊆ Allowed(A2) ⊆ Allowed(A3) ⊆ Allowed(A4) ⊆ Allowed(A5)

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum AuthorityMode {
    A0ObserveOnly = 0,
    A1CancelReconcile = 1,
    A2ReduceClose = 2,
    A3Maintain = 3,
    A4LimitedIncrease = 4,
    A5Normal = 5,
}

impl Default for AuthorityMode {
    fn default() -> Self {
        AuthorityMode::A0ObserveOnly
    }
}

impl AuthorityMode {
    pub fn rank(&self) -> u8 {
        *self as u8
    }

    pub fn allows_action(&self, action: &str) -> bool {
        match self {
            AuthorityMode::A0ObserveOnly => action == "OBSERVE",
            AuthorityMode::A1CancelReconcile => {
                matches!(action, "OBSERVE" | "CANCEL" | "RECONCILE")
            }
            AuthorityMode::A2ReduceClose => {
                matches!(action, "OBSERVE" | "CANCEL" | "RECONCILE" | "REDUCE" | "CLOSE")
            }
            AuthorityMode::A3Maintain => matches!(
                action,
                "OBSERVE" | "CANCEL" | "RECONCILE" | "REDUCE" | "CLOSE" | "MAINTAIN" | "RESERVE_FOR_EXIT"
            ),
            AuthorityMode::A4LimitedIncrease => matches!(
                action,
                "OBSERVE"
                    | "CANCEL"
                    | "RECONCILE"
                    | "REDUCE"
                    | "CLOSE"
                    | "MAINTAIN"
                    | "RESERVE_FOR_EXIT"
                    | "LIMITED_INCREASE"
                    | "EXPERIMENT"
            ),
            AuthorityMode::A5Normal => true,
        }
    }

    /// Verifies the formal subset invariant: Allowed(A_k) ⊆ Allowed(A_{k+1})
    pub fn verify_lattice_monotonicity(action: &str) -> bool {
        let modes = [
            AuthorityMode::A0ObserveOnly,
            AuthorityMode::A1CancelReconcile,
            AuthorityMode::A2ReduceClose,
            AuthorityMode::A3Maintain,
            AuthorityMode::A4LimitedIncrease,
            AuthorityMode::A5Normal,
        ];

        for i in 0..modes.len() - 1 {
            let lower_allows = modes[i].allows_action(action);
            let higher_allows = modes[i + 1].allows_action(action);
            if lower_allows && !higher_allows {
                return false;
            }
        }
        true
    }
}
