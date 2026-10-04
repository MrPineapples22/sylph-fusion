//! SYLPH FUSION — REVOCATION VERIFICATION
//! Specifications: Master Blueprint Section XXXIV, Invariant 6 (INV_AUTH_006)

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevocationState {
    pub current_revocation_epoch: u64,
    pub revoked_artifact_ids: HashSet<String>,
}

impl RevocationState {
    pub fn new() -> Self {
        Self {
            current_revocation_epoch: 1,
            revoked_artifact_ids: HashSet::new(),
        }
    }

    pub fn revoke(&mut self, artifact_id: String) -> u64 {
        self.current_revocation_epoch += 1;
        self.revoked_artifact_ids.insert(artifact_id);
        self.current_revocation_epoch
    }

    pub fn is_revoked(&self, artifact_id: &str) -> bool {
        self.revoked_artifact_ids.contains(artifact_id)
    }
}
