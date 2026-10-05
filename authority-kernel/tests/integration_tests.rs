//! SYLPH FUSION — INTEGRATION TESTS FOR AUTHORITY KERNEL
//! Specifications: Master Blueprint Section XXXVII - XL & Blueprint Section 14

use authority_kernel::action::{ActionRequest, ActionType};
use authority_kernel::authority::AuthorityMode;
use authority_kernel::evidence::EvidenceClass;
use authority_kernel::proof::{KernelActionProofBundle, KernelProofArtifact};
use authority_kernel::state::KernelState;
use authority_kernel::transition::{evaluate_action, KernelDenialReason};

fn make_dummy_artifact(id: &str, role: &str, evidence_class: EvidenceClass) -> KernelProofArtifact {
    KernelProofArtifact {
        artifact_id: id.to_string(),
        artifact_type: "PROOF".to_string(),
        subject: "TokenMint".to_string(),
        evidence_class,
        issuer: "Issuer".to_string(),
        issuer_role: role.to_string(),
        economic_fact_id: "fact_1".to_string(),
        valid_until_ms: 2_000_000_000_000,
        signature: "sig".to_string(),
    }
}

fn make_dummy_bundle(evidence_class: EvidenceClass) -> KernelActionProofBundle {
    KernelActionProofBundle {
        action_id: "act_1".to_string(),
        economic_fact_id: "fact_1".to_string(),
        execution_generation_id: "gen_1".to_string(),
        reservation_id: "res_1".to_string(),
        exact_action_hash: "0".repeat(64),
        exact_transaction_hash: "a".repeat(64),
        expected_state_root: "0".repeat(64),
        market_truth_cert: make_dummy_artifact("mt", "TruthAuthority", evidence_class),
        token_semantics_cert: make_dummy_artifact("ts", "SemanticAuthority", evidence_class),
        alpha_reality_cert: make_dummy_artifact("ar", "ResearchAuthority", evidence_class),
        signal_portfolio_cert: make_dummy_artifact("sp", "ResearchAuthority", evidence_class),
        execution_policy_cert: make_dummy_artifact("ep", "RiskAuthority", evidence_class),
        simulation_cert: make_dummy_artifact("sim", "SimulationAuthority", evidence_class),
        exitability_cert: make_dummy_artifact("exit", "ExitabilityAuthority", evidence_class),
        portfolio_evacuation_cert: make_dummy_artifact("pe", "RiskAuthority", evidence_class),
        capital_allocation_cert: make_dummy_artifact("ca", "CapitalAuthority", evidence_class),
        reservation_cert: make_dummy_artifact("res", "CapitalAuthority", evidence_class),
        survival_cert: make_dummy_artifact("surv", "RiskAuthority", evidence_class),
        twin_trust_cert: make_dummy_artifact("tt", "SimulationAuthority", evidence_class),
        release_vsa: "release_root_001".to_string(),
        config_vsa: "config_root_001".to_string(),
        policy_vsa: "policy_root_001".to_string(),
        governor_vsa: "gov_vsa".to_string(),
        control_epoch: 1,
        fence_epoch: 1,
        revocation_epoch: 1,
        revocation_root: "rev_root".to_string(),
        valid_until_slot: 1000,
        valid_until_time_ms: 2_000_000_000_000,
        proof_graph_root: "pg_root".to_string(),
    }
}

#[test]
fn test_inv_auth_001_initial_authority_is_a0() {
    let state = KernelState::default();
    assert_eq!(state.authority_mode, AuthorityMode::A0ObserveOnly);
}

#[test]
fn test_lattice_monotonicity_proof() {
    let actions = ["OBSERVE", "CANCEL", "RECONCILE", "REDUCE", "CLOSE", "MAINTAIN", "LIMITED_INCREASE", "OPEN"];
    for act in actions {
        assert!(AuthorityMode::verify_lattice_monotonicity(act));
    }
}

#[test]
fn test_inv_auth_003_unknown_evidence_rejected() {
    let mut state = KernelState {
        authority_mode: AuthorityMode::A5Normal,
        release_root: "release_root_001".to_string(),
        config_root: "config_root_001".to_string(),
        policy_root: "policy_root_001".to_string(),
        ..Default::default()
    };

    let req = ActionRequest {
        action_id: "act_1".to_string(),
        action_type: ActionType::Open,
        subject_mint: "Token111".to_string(),
        delta_lamports: 10_000_000,
        expected_state_root: "0".repeat(64),
        permit_nonce: "nonce_1".to_string(),
    };

    // Bundle with UNKNOWN evidence class
    let bundle = make_dummy_bundle(EvidenceClass::Unknown);
    let res = evaluate_action(&mut state, &req, &bundle, 1_000_000, 500);

    assert!(res.is_err());
    let errs = res.unwrap_err();
    assert!(errs.iter().any(|e| matches!(e, KernelDenialReason::InvAuth003UnknownEvidence(_))));
}

#[test]
fn test_inv_auth_004_permit_replay_blocked() {
    let mut state = KernelState {
        authority_mode: AuthorityMode::A5Normal,
        release_root: "release_root_001".to_string(),
        config_root: "config_root_001".to_string(),
        policy_root: "policy_root_001".to_string(),
        ..Default::default()
    };

    let req = ActionRequest {
        action_id: "act_1".to_string(),
        action_type: ActionType::Open,
        subject_mint: "Token111".to_string(),
        delta_lamports: 10_000_000,
        expected_state_root: "0".repeat(64),
        permit_nonce: "nonce_1".to_string(),
    };

    let bundle = make_dummy_bundle(EvidenceClass::VerifiedChain);
    let res1 = evaluate_action(&mut state, &req, &bundle, 1_000_000, 500);
    assert!(res1.is_ok());

    // Second execution with same nonce MUST FAIL
    let res2 = evaluate_action(&mut state, &req, &bundle, 1_000_100, 501);
    assert!(res2.is_err());
    let errs = res2.unwrap_err();
    assert!(errs.iter().any(|e| matches!(e, KernelDenialReason::InvAuth004PermitReplay(_))));
}

#[test]
fn test_inv_auth_005_stale_state_root() {
    let mut state = KernelState {
        authority_mode: AuthorityMode::A5Normal,
        release_root: "release_root_001".to_string(),
        config_root: "config_root_001".to_string(),
        policy_root: "policy_root_001".to_string(),
        state_root: "e".repeat(64),
        ..Default::default()
    };

    let req = ActionRequest {
        action_id: "act_1".to_string(),
        action_type: ActionType::Open,
        subject_mint: "Token111".to_string(),
        delta_lamports: 10_000_000,
        expected_state_root: "f".repeat(64),
        permit_nonce: "nonce_stale_root".to_string(),
    };

    let mut bundle = make_dummy_bundle(EvidenceClass::VerifiedChain);
    bundle.expected_state_root = "f".repeat(64); // Mismatched vs kernel state_root

    let res = evaluate_action(&mut state, &req, &bundle, 1_000_000, 500);
    assert!(res.is_err());
    let errs = res.unwrap_err();
    assert!(errs.iter().any(|e| matches!(e, KernelDenialReason::InvAuth005StaleStateRoot(_))));
}

#[test]
fn test_inv_auth_006_proof_revocation() {
    let mut state = KernelState {
        authority_mode: AuthorityMode::A5Normal,
        release_root: "release_root_001".to_string(),
        config_root: "config_root_001".to_string(),
        policy_root: "policy_root_001".to_string(),
        revocation_epoch: 2, // State advanced to epoch 2
        ..Default::default()
    };

    let req = ActionRequest {
        action_id: "act_1".to_string(),
        action_type: ActionType::Open,
        subject_mint: "Token111".to_string(),
        delta_lamports: 10_000_000,
        expected_state_root: "0".repeat(64),
        permit_nonce: "nonce_revoked".to_string(),
    };

    let mut bundle = make_dummy_bundle(EvidenceClass::VerifiedChain);
    bundle.revocation_epoch = 1; // Stale revocation epoch

    let res = evaluate_action(&mut state, &req, &bundle, 1_000_000, 500);
    assert!(res.is_err());
    let errs = res.unwrap_err();
    assert!(errs.iter().any(|e| matches!(e, KernelDenialReason::InvAuth006ProofRevoked(_))));
}

#[test]
fn test_role_impersonation_blocked() {
    let mut state = KernelState {
        authority_mode: AuthorityMode::A5Normal,
        release_root: "release_root_001".to_string(),
        config_root: "config_root_001".to_string(),
        policy_root: "policy_root_001".to_string(),
        ..Default::default()
    };

    let req = ActionRequest {
        action_id: "act_1".to_string(),
        action_type: ActionType::Open,
        subject_mint: "Token111".to_string(),
        delta_lamports: 10_000_000,
        expected_state_root: "0".repeat(64),
        permit_nonce: "nonce_role".to_string(),
    };

    let mut bundle = make_dummy_bundle(EvidenceClass::VerifiedChain);
    // Token semantics certificate impersonating TruthAuthority
    bundle.token_semantics_cert.issuer_role = "WrongAuthorityRole".to_string();

    let res = evaluate_action(&mut state, &req, &bundle, 1_000_000, 500);
    assert!(res.is_err());
    let errs = res.unwrap_err();
    assert!(errs.iter().any(|e| matches!(e, KernelDenialReason::RoleImpersonationDetected(_))));
}

#[test]
fn test_inv_auth_011_risk_reducing_survives_degradation() {
    let mut state = KernelState {
        authority_mode: AuthorityMode::A2ReduceClose, // Degraded!
        release_root: "release_root_001".to_string(),
        config_root: "config_root_001".to_string(),
        policy_root: "policy_root_001".to_string(),
        ..Default::default()
    };

    let req_open = ActionRequest {
        action_id: "act_open".to_string(),
        action_type: ActionType::Open,
        subject_mint: "Token111".to_string(),
        delta_lamports: 10_000_000,
        expected_state_root: "0".repeat(64),
        permit_nonce: "nonce_open".to_string(),
    };

    let req_close = ActionRequest {
        action_id: "act_close".to_string(),
        action_type: ActionType::Close,
        subject_mint: "Token111".to_string(),
        delta_lamports: 10_000_000,
        expected_state_root: "0".repeat(64),
        permit_nonce: "nonce_close".to_string(),
    };

    let bundle = make_dummy_bundle(EvidenceClass::VerifiedChain);

    // OPEN is blocked under A2
    let res_open = evaluate_action(&mut state, &req_open, &bundle, 1_000_000, 500);
    assert!(res_open.is_err());

    // CLOSE succeeds under A2!
    let res_close = evaluate_action(&mut state, &req_close, &bundle, 1_000_000, 500);
    assert!(res_close.is_ok());
}
