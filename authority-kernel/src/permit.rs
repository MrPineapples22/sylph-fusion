//! SYLPH FUSION — VERIFIED PERMIT
//! Specifications: Master Blueprint Section XXXVII, XLIII

use crate::authority::AuthorityMode;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifiedPermit {
    pub permit_id: String,
    pub action_id: String,
    pub permit_nonce: String,
    pub authorized_authority: AuthorityMode,
    pub issued_at_ms: u64,
    pub valid_until_ms: u64,
}
