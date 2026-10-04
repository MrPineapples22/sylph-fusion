//! SYLPH FUSION — CANONICAL SETTLEMENT VERIFICATION
//! Specifications: Master Blueprint Invariants 4, 5 (INV_AUTH_007, INV_AUTH_008)
//!
//! Invariants:
//! - Unknown execution consumes risk (capital stays reserved)
//! - Confirmed but nonfinal settlement cannot mutate authoritative economic state (INV_AUTH_008)
//! - Only terminal finalized outcomes may resolve authoritative capital

use crate::state::KernelState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SettlementOutcome {
    FinalizedSuccess,
    FinalizedInstructionFailure,
    ExpiredNoLandQuorum,
    ConfirmedPendingFinality,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettlementCertificate {
    pub transaction_signature: String,
    pub outcome: SettlementOutcome,
    pub slot: u64,
    pub finalized_blockhash: String,
    pub net_proceeds_lamports: i64,
}

pub fn reconcile_settlement(
    state: &mut KernelState,
    cert: &SettlementCertificate,
    reserved_lamports: u64,
) -> Result<(), &'static str> {
    match cert.outcome {
        SettlementOutcome::Unknown => {
            // INV_AUTH_007: Capital stays reserved
            Err("UNKNOWN_SETTLEMENT_RETAINS_RISK")
        }
        SettlementOutcome::ConfirmedPendingFinality => {
            // INV_AUTH_008: Confirmed but nonfinal cannot mutate finalized economic state
            Err("NONFINAL_SETTLEMENT_CANNOT_MUTATE_CAPITAL")
        }
        SettlementOutcome::FinalizedSuccess => {
            if state.reserved_cash_lamports >= reserved_lamports {
                state.reserved_cash_lamports -= reserved_lamports;
            }
            if cert.net_proceeds_lamports >= 0 {
                state.confirmed_cash_lamports += cert.net_proceeds_lamports as u64;
            } else {
                let loss = cert.net_proceeds_lamports.unsigned_abs();
                if state.confirmed_cash_lamports >= loss {
                    state.confirmed_cash_lamports -= loss;
                } else {
                    state.confirmed_cash_lamports = 0;
                }
            }
            Ok(())
        }
        SettlementOutcome::FinalizedInstructionFailure | SettlementOutcome::ExpiredNoLandQuorum => {
            if state.reserved_cash_lamports >= reserved_lamports {
                state.reserved_cash_lamports -= reserved_lamports;
            }
            Ok(())
        }
    }
}
