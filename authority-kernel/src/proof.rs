//! SYLPH FUSION — ACTION PROOF BUNDLE IN RUST
//! Specifications: Master Blueprint Section XXXVI (Action Proof Bundle) & Blueprint Section 14

use crate::evidence::EvidenceClass;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelProofArtifact {
    pub artifact_id: String,
    pub artifact_type: String,
    pub subject: String,
    pub evidence_class: EvidenceClass,
    pub issuer: String,
    pub issuer_role: String,
    pub economic_fact_id: String,
    pub valid_until_ms: u64,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelActionProofBundle {
    pub action_id: String,
    pub economic_fact_id: String,
    pub execution_generation_id: String,
    pub reservation_id: String,
    pub exact_action_hash: String,
    pub exact_transaction_hash: String,
    pub expected_state_root: String,
    pub market_truth_cert: KernelProofArtifact,
    pub token_semantics_cert: KernelProofArtifact,
    pub alpha_reality_cert: KernelProofArtifact,
    pub signal_portfolio_cert: KernelProofArtifact,
    pub execution_policy_cert: KernelProofArtifact,
    pub simulation_cert: KernelProofArtifact,
    pub exitability_cert: KernelProofArtifact,
    pub portfolio_evacuation_cert: KernelProofArtifact,
    pub capital_allocation_cert: KernelProofArtifact,
    pub reservation_cert: KernelProofArtifact,
    pub survival_cert: KernelProofArtifact,
    pub twin_trust_cert: KernelProofArtifact,
    pub release_vsa: String,
    pub config_vsa: String,
    pub policy_vsa: String,
    pub governor_vsa: String,
    pub control_epoch: u64,
    pub fence_epoch: u64,
    pub revocation_epoch: u64,
    pub revocation_root: String,
    pub valid_until_slot: u64,
    pub valid_until_time_ms: u64,
    pub proof_graph_root: String,
}
