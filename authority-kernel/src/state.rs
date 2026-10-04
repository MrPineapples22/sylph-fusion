//! SYLPH FUSION — KERNEL STATE & INVARIANTS
//! Specifications: Master Blueprint Section XXXVII, XXXVIII, XXXIX

use crate::authority::AuthorityMode;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelState {
    pub authority_mode: AuthorityMode,
    pub control_epoch: u64,
    pub fence_epoch: u64,
    pub revocation_epoch: u64,
    pub config_root: String,
    pub release_root: String,
    pub policy_root: String,
    pub consumed_permit_nonces: HashSet<String>,
    pub unresolved_intents_count: u32,
    pub confirmed_cash_lamports: u64,
    pub reserved_cash_lamports: u64,
    pub unknown_capital_lamports: u64,
    pub emergency_reserve_lamports: u64,
    pub open_positions_count: u32,
    pub max_open_positions: u32,
}

impl Default for KernelState {
    fn default() -> Self {
        Self {
            authority_mode: AuthorityMode::A0ObserveOnly, // INV_AUTH_001 & Section XXXVIII
            control_epoch: 1,
            fence_epoch: 1,
            revocation_epoch: 1,
            config_root: "0".repeat(64),
            release_root: "0".repeat(64),
            policy_root: "0".repeat(64),
            consumed_permit_nonces: HashSet::new(),
            unresolved_intents_count: 0,
            confirmed_cash_lamports: 0,
            reserved_cash_lamports: 0,
            unknown_capital_lamports: 0,
            emergency_reserve_lamports: 0,
            open_positions_count: 0,
            max_open_positions: 5,
        }
    }
}
