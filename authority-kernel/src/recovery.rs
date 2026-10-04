//! SYLPH FUSION — RECOVERY MACHINE
//! Specifications: Master Blueprint Section XXXVIII, Invariant 7, 9 (INV_AUTH_009, INV_AUTH_012)
//!
//! Invariants:
//! - Crash/restart cannot increase authority (INV_AUTH_009)
//! - No authority restoration depends on descriptive caller booleans (INV_AUTH_012)

use crate::authority::AuthorityMode;
use crate::state::KernelState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelRecoveryCertificate {
    pub recovery_id: String,
    pub provider_status: String,
    pub settlement_state: String,
    pub signer_state: String,
    pub market_freshness_ms: u64,
    pub capital_state_root: String,
    pub target_authority: AuthorityMode,
}

pub fn restore_authority(
    state: &mut KernelState,
    cert: &KernelRecoveryCertificate,
) -> Result<AuthorityMode, &'static str> {
    if cert.recovery_id.len() < 8 {
        return Err("RECOVERY_ID_INVALID");
    }
    if cert.provider_status != "HEALTHY" {
        return Err("PROVIDER_NOT_HEALTHY");
    }
    if cert.settlement_state != "CLEAN" {
        return Err("SETTLEMENT_NOT_CLEAN");
    }
    if cert.signer_state != "READY" {
        return Err("SIGNER_NOT_READY");
    }
    if cert.market_freshness_ms > 30_000 {
        return Err("MARKET_DATA_STALE");
    }
    if cert.capital_state_root.len() < 16 {
        return Err("CAPITAL_STATE_ROOT_INVALID");
    }

    state.authority_mode = cert.target_authority;
    Ok(state.authority_mode)
}
