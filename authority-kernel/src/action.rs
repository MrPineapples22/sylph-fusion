//! SYLPH FUSION — ACTION REQUEST & INTENT TAXONOMY
//! Specifications: Master Blueprint Section XXXII, XXXIII (Allowed Actions)

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActionType {
    HoldCash,
    Open,
    Increase,
    Reduce,
    Close,
    Rotate,
    HarvestProfit,
    ReserveForExit,
    ReleaseReserve,
    Experiment,
    Cancel,
    Evacuate,
    Reconcile,
}

impl ActionType {
    pub fn is_risk_increasing(&self) -> bool {
        matches!(self, ActionType::Open | ActionType::Increase | ActionType::Rotate | ActionType::Experiment)
    }

    pub fn is_risk_reducing(&self) -> bool {
        matches!(
            self,
            ActionType::Reduce
                | ActionType::Close
                | ActionType::Evacuate
                | ActionType::Cancel
                | ActionType::Reconcile
                | ActionType::HarvestProfit
        )
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            ActionType::HoldCash => "HOLD_CASH",
            ActionType::Open => "OPEN",
            ActionType::Increase => "INCREASE",
            ActionType::Reduce => "REDUCE",
            ActionType::Close => "CLOSE",
            ActionType::Rotate => "ROTATE",
            ActionType::HarvestProfit => "HARVEST_PROFIT",
            ActionType::ReserveForExit => "RESERVE_FOR_EXIT",
            ActionType::ReleaseReserve => "RELEASE_RESERVE",
            ActionType::Experiment => "EXPERIMENT",
            ActionType::Cancel => "CANCEL",
            ActionType::Evacuate => "EVACUATE",
            ActionType::Reconcile => "RECONCILE",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionRequest {
    pub action_id: String,
    pub action_type: ActionType,
    pub subject_mint: String,
    pub delta_lamports: u64,
    pub expected_state_root: String,
    pub permit_nonce: String,
}
