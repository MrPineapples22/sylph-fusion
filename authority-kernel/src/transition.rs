//! SYLPH FUSION — FORMAL TRANSITION ENGINE & INVARIANT ENFORCEMENT
//! Specifications: Master Blueprint Section XXXVII, XXXVIII, XXXIX (Formal Invariants)

use crate::action::{ActionRequest, ActionType};
use crate::permit::VerifiedPermit;
use crate::proof::KernelActionProofBundle;
use crate::state::KernelState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum KernelDenialReason {
    InvAuth001InsufficientAuthority(String),
    InvAuth003UnknownEvidence(String),
    InvAuth004PermitReplay(String),
    InvAuth005StaleStateRoot(String),
    InvAuth006ProofRevoked(String),
    InvAuth007UnknownSettlement(String),
    InvAuth010StaleEpochOrRoot(String),
    InvAuth011ExitabilityUnavailable(String),
    CapacityBreached(String),
    Expired(String),
}

pub fn evaluate_action(
    state: &mut KernelState,
    request: &ActionRequest,
    proof_bundle: &KernelActionProofBundle,
    now_ms: u64,
    current_slot: u64,
) -> Result<VerifiedPermit, Vec<KernelDenialReason>> {
    let mut denials = Vec::new();

    // INV_AUTH_004: Consumed permit cannot execute twice (Anti-Replay)
    if state.consumed_permit_nonces.contains(&request.permit_nonce) {
        denials.push(KernelDenialReason::InvAuth004PermitReplay(format!(
            "Nonce {} already consumed",
            request.permit_nonce
        )));
    }

    // Temporal and Slot Validity
    if now_ms > proof_bundle.valid_until_time_ms {
        denials.push(KernelDenialReason::Expired(format!(
            "Proof bundle expired at {} ms, current is {} ms",
            proof_bundle.valid_until_time_ms, now_ms
        )));
    }
    if current_slot > proof_bundle.valid_until_slot {
        denials.push(KernelDenialReason::Expired(format!(
            "Proof bundle expired at slot {}, current is {}",
            proof_bundle.valid_until_slot, current_slot
        )));
    }

    // INV_AUTH_010: Config/policy/release changes invalidate stale permits
    if proof_bundle.control_epoch != state.control_epoch {
        denials.push(KernelDenialReason::InvAuth010StaleEpochOrRoot(format!(
            "Stale control epoch: bundle {} != state {}",
            proof_bundle.control_epoch, state.control_epoch
        )));
    }
    if proof_bundle.fence_epoch != state.fence_epoch {
        denials.push(KernelDenialReason::InvAuth010StaleEpochOrRoot(format!(
            "Stale fence epoch: bundle {} != state {}",
            proof_bundle.fence_epoch, state.fence_epoch
        )));
    }
    if proof_bundle.release_vsa != state.release_root {
        denials.push(KernelDenialReason::InvAuth010StaleEpochOrRoot(format!(
            "Release root mismatch: bundle {} != state {}",
            proof_bundle.release_vsa, state.release_root
        )));
    }
    if proof_bundle.config_vsa != state.config_root {
        denials.push(KernelDenialReason::InvAuth010StaleEpochOrRoot(format!(
            "Config root mismatch: bundle {} != state {}",
            proof_bundle.config_vsa, state.config_root
        )));
    }

    // INV_AUTH_001: No risk-increasing action below required authority
    if request.action_type.is_risk_increasing() {
        if !state.authority_mode.allows_action(request.action_type.as_str()) {
            denials.push(KernelDenialReason::InvAuth001InsufficientAuthority(format!(
                "Action {:?} requires higher authority than {:?}",
                request.action_type, state.authority_mode
            )));
        }

        // Capacity check
        if state.open_positions_count >= state.max_open_positions && request.action_type == ActionType::Open {
            denials.push(KernelDenialReason::CapacityBreached(format!(
                "Max positions reached: {} >= {}",
                state.open_positions_count, state.max_open_positions
            )));
        }
    }

    // INV_AUTH_011: Risk-reducing capability survives unrelated degradation when its own prerequisites remain valid
    if request.action_type.is_risk_reducing() {
        if !state.authority_mode.allows_action(request.action_type.as_str()) {
            // Under degradation, A1/A2 still allows REDUCE, CLOSE, EVACUATE, CANCEL, RECONCILE
            if state.authority_mode.rank() < 1 {
                denials.push(KernelDenialReason::InvAuth001InsufficientAuthority(format!(
                    "Risk-reducing action {:?} forbidden in A0",
                    request.action_type
                )));
            }
        }
    }

    // INV_AUTH_003: Unknown evidence cannot produce authority
    let certs = [
        &proof_bundle.market_truth_cert,
        &proof_bundle.token_semantics_cert,
        &proof_bundle.alpha_reality_cert,
        &proof_bundle.signal_portfolio_cert,
        &proof_bundle.execution_policy_cert,
        &proof_bundle.simulation_cert,
        &proof_bundle.exitability_cert,
        &proof_bundle.portfolio_evacuation_cert,
        &proof_bundle.capital_allocation_cert,
        &proof_bundle.reservation_cert,
        &proof_bundle.survival_cert,
        &proof_bundle.twin_trust_cert,
    ];

    for c in certs.iter() {
        if c.evidence_class == "UNKNOWN" || c.evidence_class == "INSUFFICIENT_EVIDENCE" {
            denials.push(KernelDenialReason::InvAuth003UnknownEvidence(format!(
                "Certificate {} has invalid evidence class {}",
                c.artifact_id, c.evidence_class
            )));
        }
    }

    if !denials.is_empty() {
        return Err(denials);
    }

    // Transition state: mark nonce consumed
    state.consumed_permit_nonces.insert(request.permit_nonce.clone());
    if request.action_type == ActionType::Open {
        state.open_positions_count += 1;
    } else if request.action_type == ActionType::Close && state.open_positions_count > 0 {
        state.open_positions_count -= 1;
    }

    Ok(VerifiedPermit {
        permit_id: format!("permit_{}", request.action_id),
        action_id: request.action_id.clone(),
        permit_nonce: request.permit_nonce.clone(),
        authorized_authority: state.authority_mode,
        issued_at_ms: now_ms,
        valid_until_ms: proof_bundle.valid_until_time_ms,
    })
}
