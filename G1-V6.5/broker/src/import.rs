//! Typed boundary for importing an untrusted historical source.
//!
//! This module deliberately has no default trust provider and is not wired to
//! the service IPC. A caller must supply an independently provisioned
//! authenticator that verifies the exact canonical bytes below. The synthetic
//! test authenticator exists only under `cfg(test)`.

#![allow(non_camel_case_types)]

use std::collections::HashSet;
use std::ffi::c_void;

const IMPORT_SCHEMA: u32 = 1;
const MAX_RECORDS: usize = 100_000;
const MAX_OBLIGATIONS: usize = 100_000;
const MAX_FIELD_BYTES: usize = 1_048_576;
const MAX_BUNDLE_BYTES: usize = 64 * 1024 * 1024;

type BCRYPT_ALG_HANDLE = *mut c_void;

#[link(name = "bcrypt")]
unsafe extern "system" {
    fn BCryptOpenAlgorithmProvider(
        algorithm: *mut BCRYPT_ALG_HANDLE,
        algorithm_id: *const u16,
        implementation: *const u16,
        flags: u32,
    ) -> i32;
    fn BCryptHash(
        algorithm: BCRYPT_ALG_HANDLE,
        secret: *mut u8,
        secret_length: u32,
        input: *mut u8,
        input_length: u32,
        output: *mut u8,
        output_length: u32,
    ) -> i32;
    fn BCryptCloseAlgorithmProvider(algorithm: BCRYPT_ALG_HANDLE, flags: u32) -> i32;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReceiptRecord {
    pub identity: String,
    pub parent_identity: String,
    pub payload: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Obligation {
    pub identity: String,
    pub state: String,
    pub external_identity: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImportAnchor {
    pub chain_identity: String,
    pub generation: u64,
    pub state_root: String,
    pub last_receipt_identity: String,
    pub unresolved_obligations: Vec<Obligation>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImportBundle {
    pub schema: u32,
    pub chain_identity: String,
    pub generation: u64,
    pub parent_generation: u64,
    pub parent_state_root: String,
    pub state_root: String,
    pub receipts: Vec<ReceiptRecord>,
    pub obligations: Vec<Obligation>,
    /// Signed/attested envelope. Its bytes are not part of the content claim.
    pub evidence_envelope: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrustClaim {
    pub chain_identity: String,
    pub signer_identity: String,
    pub trust_registry_epoch: u64,
    pub claim_purpose: String,
    pub synthetic_only: bool,
}

pub enum Authentication {
    Verified(TrustClaim),
    Unavailable(String),
    Invalid(String),
}

pub trait EvidenceAuthenticator {
    /// Verify the complete canonical claim, signer authorization, revocation,
    /// freshness, and policy epoch. A SHA-256 digest alone is not sufficient.
    fn authenticate(&self, canonical_claim: &[u8], envelope: &[u8]) -> Authentication;
}

pub enum ImportDecision {
    Accepted(VerifiedImport),
    Rejected(String),
    Indeterminate(String),
}

pub struct VerifiedImport {
    bundle: ImportBundle,
    canonical_claim: Vec<u8>,
    trust: TrustClaim,
}

impl VerifiedImport {
    pub fn bundle(&self) -> &ImportBundle {
        &self.bundle
    }
    pub fn canonical_claim(&self) -> &[u8] {
        &self.canonical_claim
    }
    pub fn trust_claim(&self) -> &TrustClaim {
        &self.trust
    }
}

pub struct ImportKernel;

impl ImportKernel {
    pub fn validate(
        anchor: &ImportAnchor,
        bundle: ImportBundle,
        authenticator: &dyn EvidenceAuthenticator,
    ) -> ImportDecision {
        if let Err(reason) = validate_structure(anchor, &bundle) {
            return ImportDecision::Rejected(reason);
        }
        let canonical = match canonical_claim(&bundle) {
            Ok(bytes) => bytes,
            Err(reason) => return ImportDecision::Rejected(reason),
        };
        match authenticator.authenticate(&canonical, &bundle.evidence_envelope) {
            Authentication::Unavailable(reason) => ImportDecision::Indeterminate(reason),
            Authentication::Invalid(reason) => ImportDecision::Rejected(reason),
            Authentication::Verified(claim) => {
                if claim.chain_identity != bundle.chain_identity
                    || claim.claim_purpose != "SYLPH_HISTORICAL_AUTHORITY_IMPORT_V1"
                    || claim.signer_identity.is_empty()
                    || claim.trust_registry_epoch == 0
                {
                    return ImportDecision::Rejected("TRUST_CLAIM_BINDING_INVALID".into());
                }
                if !claim.synthetic_only {
                    // This prototype has no approved operational trust roots.
                    // Authentic external activation remains unavailable until
                    // those roots and the chain-finality adapter are provisioned.
                    return ImportDecision::Indeterminate(
                        "OPERATIONAL_TRUST_ROOT_NOT_PROVISIONED".into(),
                    );
                }
                ImportDecision::Accepted(VerifiedImport {
                    bundle,
                    canonical_claim: canonical,
                    trust: claim,
                })
            }
        }
    }
}

pub(crate) fn validate_structure(
    anchor: &ImportAnchor,
    bundle: &ImportBundle,
) -> Result<(), String> {
    if bundle.schema != IMPORT_SCHEMA {
        return Err("IMPORT_SCHEMA_UNSUPPORTED".into());
    }
    if anchor.chain_identity.is_empty()
        || anchor.generation == 0
        || anchor.generation > i64::MAX as u64
        || bundle.chain_identity != anchor.chain_identity
        || bundle.generation
            != anchor
                .generation
                .checked_add(1)
                .ok_or("GENERATION_OVERFLOW")?
        || bundle.generation > i64::MAX as u64
        || bundle.parent_generation != anchor.generation
        || bundle.parent_state_root != anchor.state_root
        || bundle.state_root.is_empty()
        || bundle.receipts.is_empty()
        || bundle.receipts.len() > MAX_RECORDS
        || bundle.obligations.len() > MAX_OBLIGATIONS
        || bundle.evidence_envelope.is_empty()
        || bundle.evidence_envelope.len() > MAX_FIELD_BYTES
    {
        return Err("IMPORT_ANCHOR_OR_LIMIT_MISMATCH".into());
    }
    let computed_root = state_root(bundle)?;
    if bundle.state_root != computed_root {
        return Err("IMPORT_STATE_ROOT_MISMATCH".into());
    }

    if !valid_identity(&anchor.last_receipt_identity) {
        return Err("IMPORT_ANCHOR_RECEIPT_ID_INVALID".into());
    }
    let mut seen = HashSet::with_capacity(bundle.receipts.len());
    for (index, receipt) in bundle.receipts.iter().enumerate() {
        if !valid_identity(&receipt.identity)
            || !valid_identity(&receipt.parent_identity)
            || receipt.payload.is_empty()
            || receipt.payload.len() > MAX_FIELD_BYTES
            || !seen.insert(receipt.identity.as_str())
        {
            return Err(format!("IMPORT_RECEIPT_INVALID:{index}"));
        }
        let expected_parent = if index == 0 {
            anchor.last_receipt_identity.as_str()
        } else {
            bundle.receipts[index - 1].identity.as_str()
        };
        if receipt.parent_identity != expected_parent {
            return Err(format!(
                "IMPORT_RECEIPT_PARENT_MISSING_OR_OUT_OF_ORDER:{index}"
            ));
        }
    }

    let mut obligation_ids = HashSet::with_capacity(bundle.obligations.len());
    for obligation in &bundle.obligations {
        if !valid_identity(&obligation.identity)
            || !valid_state(&obligation.state)
            || obligation.external_identity.len() > MAX_FIELD_BYTES
            || !obligation_ids.insert(obligation.identity.as_str())
        {
            return Err("IMPORT_OBLIGATION_INVALID_OR_DUPLICATED".into());
        }
    }
    for required in &anchor.unresolved_obligations {
        match bundle
            .obligations
            .iter()
            .find(|candidate| candidate.identity == required.identity)
        {
            None => return Err(format!("IMPORT_OBLIGATION_DROPPED:{}", required.identity)),
            Some(candidate) if candidate != required => {
                // This bounded G1 adapter has no independently authenticated
                // obligation-resolution proof type. Preserve the exact open
                // obligation; never accept a caller's bare state transition.
                return Err(format!(
                    "IMPORT_OBLIGATION_CHANGED_WITHOUT_PROOF:{}",
                    required.identity
                ));
            }
            Some(_) => {}
        }
    }
    Ok(())
}

fn valid_identity(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn valid_state(value: &str) -> bool {
    matches!(
        value,
        "PREPARED" | "DISPATCHED" | "RESOLVED" | "FAILED" | "UNKNOWN" | "QUARANTINED"
    )
}

/// Unambiguous, length-prefixed serialization of every content-bearing field.
/// The signature envelope is excluded so renewal cannot change history identity.
pub(crate) fn canonical_claim(bundle: &ImportBundle) -> Result<Vec<u8>, String> {
    if canonical_claim_encoded_size(bundle)? > MAX_BUNDLE_BYTES {
        return Err("IMPORT_CANONICAL_CLAIM_TOO_LARGE".into());
    }
    let mut output = Vec::new();
    output.extend_from_slice(b"SYLPH-IMPORT-CONTENT-V1\0");
    put_u32(&mut output, bundle.schema);
    put_str(&mut output, &bundle.chain_identity)?;
    put_u64(&mut output, bundle.generation);
    put_u64(&mut output, bundle.parent_generation);
    put_str(&mut output, &bundle.parent_state_root)?;
    put_str(&mut output, &bundle.state_root)?;
    put_u64(&mut output, bundle.receipts.len() as u64);
    for receipt in &bundle.receipts {
        put_str(&mut output, &receipt.identity)?;
        put_str(&mut output, &receipt.parent_identity)?;
        put_bytes(&mut output, &receipt.payload)?;
    }
    put_u64(&mut output, bundle.obligations.len() as u64);
    for obligation in &bundle.obligations {
        put_str(&mut output, &obligation.identity)?;
        put_str(&mut output, &obligation.state)?;
        put_str(&mut output, &obligation.external_identity)?;
    }
    Ok(output)
}

/// Recompute the authority-state root from the exact ordered receipt and
/// obligation inventory. The signed envelope authenticates this claim later;
/// a caller-provided root is never accepted as its own proof.
pub(crate) fn state_root(bundle: &ImportBundle) -> Result<String, String> {
    if state_root_encoded_size(bundle)? > MAX_BUNDLE_BYTES {
        return Err("IMPORT_STATE_ROOT_CONTENT_TOO_LARGE".into());
    }
    let mut state = Vec::new();
    state.extend_from_slice(b"SYLPH-AUTHORITY-STATE-ROOT-V1\0");
    put_str(&mut state, &bundle.chain_identity)?;
    put_u64(&mut state, bundle.generation);
    put_u64(&mut state, bundle.parent_generation);
    put_str(&mut state, &bundle.parent_state_root)?;
    put_u64(&mut state, bundle.receipts.len() as u64);
    for receipt in &bundle.receipts {
        put_str(&mut state, &receipt.identity)?;
        put_str(&mut state, &receipt.parent_identity)?;
        put_bytes(&mut state, &receipt.payload)?;
    }
    put_u64(&mut state, bundle.obligations.len() as u64);
    for obligation in &bundle.obligations {
        put_str(&mut state, &obligation.identity)?;
        put_str(&mut state, &obligation.state)?;
        put_str(&mut state, &obligation.external_identity)?;
    }
    let digest = sha256(&state)?;
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn canonical_claim_encoded_size(bundle: &ImportBundle) -> Result<usize, String> {
    let mut size = b"SYLPH-IMPORT-CONTENT-V1\0".len();
    add_size(&mut size, 4)?;
    add_sized_field(&mut size, bundle.chain_identity.len())?;
    add_size(&mut size, 16)?;
    add_sized_field(&mut size, bundle.parent_state_root.len())?;
    add_sized_field(&mut size, bundle.state_root.len())?;
    add_size(&mut size, 8)?;
    for receipt in &bundle.receipts {
        add_sized_field(&mut size, receipt.identity.len())?;
        add_sized_field(&mut size, receipt.parent_identity.len())?;
        add_sized_field(&mut size, receipt.payload.len())?;
    }
    add_size(&mut size, 8)?;
    for obligation in &bundle.obligations {
        add_sized_field(&mut size, obligation.identity.len())?;
        add_sized_field(&mut size, obligation.state.len())?;
        add_sized_field(&mut size, obligation.external_identity.len())?;
    }
    Ok(size)
}

fn state_root_encoded_size(bundle: &ImportBundle) -> Result<usize, String> {
    let mut size = b"SYLPH-AUTHORITY-STATE-ROOT-V1\0".len();
    add_sized_field(&mut size, bundle.chain_identity.len())?;
    add_size(&mut size, 16)?;
    add_sized_field(&mut size, bundle.parent_state_root.len())?;
    add_size(&mut size, 8)?;
    for receipt in &bundle.receipts {
        add_sized_field(&mut size, receipt.identity.len())?;
        add_sized_field(&mut size, receipt.parent_identity.len())?;
        add_sized_field(&mut size, receipt.payload.len())?;
    }
    add_size(&mut size, 8)?;
    for obligation in &bundle.obligations {
        add_sized_field(&mut size, obligation.identity.len())?;
        add_sized_field(&mut size, obligation.state.len())?;
        add_sized_field(&mut size, obligation.external_identity.len())?;
    }
    Ok(size)
}

fn add_sized_field(total: &mut usize, field_length: usize) -> Result<(), String> {
    if field_length > MAX_FIELD_BYTES {
        return Err("IMPORT_FIELD_TOO_LARGE".into());
    }
    add_size(total, 8)?;
    add_size(total, field_length)
}

fn add_size(total: &mut usize, additional: usize) -> Result<(), String> {
    *total = total
        .checked_add(additional)
        .ok_or("IMPORT_ENCODED_SIZE_OVERFLOW")?;
    Ok(())
}

fn sha256(input: &[u8]) -> Result<[u8; 32], String> {
    if input.len() > u32::MAX as usize {
        return Err("IMPORT_HASH_INPUT_TOO_LARGE".into());
    }
    const SHA256: [u16; 7] = [
        b'S' as u16,
        b'H' as u16,
        b'A' as u16,
        b'2' as u16,
        b'5' as u16,
        b'6' as u16,
        0,
    ];
    unsafe {
        let mut algorithm = std::ptr::null_mut();
        let open_status =
            BCryptOpenAlgorithmProvider(&mut algorithm, SHA256.as_ptr(), std::ptr::null(), 0);
        if open_status < 0 || algorithm.is_null() {
            return Err(format!("IMPORT_SHA256_PROVIDER_FAILED:{open_status:#010x}"));
        }
        let mut digest = [0u8; 32];
        let hash_status = BCryptHash(
            algorithm,
            std::ptr::null_mut(),
            0,
            input.as_ptr() as *mut u8,
            input.len() as u32,
            digest.as_mut_ptr(),
            digest.len() as u32,
        );
        let close_status = BCryptCloseAlgorithmProvider(algorithm, 0);
        if hash_status < 0 {
            return Err(format!("IMPORT_SHA256_FAILED:{hash_status:#010x}"));
        }
        if close_status < 0 {
            return Err(format!(
                "IMPORT_SHA256_PROVIDER_CLOSE_FAILED:{close_status:#010x}"
            ));
        }
        Ok(digest)
    }
}

fn put_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_be_bytes());
}
fn put_u64(output: &mut Vec<u8>, value: u64) {
    output.extend_from_slice(&value.to_be_bytes());
}
fn put_bytes(output: &mut Vec<u8>, value: &[u8]) -> Result<(), String> {
    if value.len() > MAX_FIELD_BYTES {
        return Err("IMPORT_FIELD_TOO_LARGE".into());
    }
    put_u64(output, value.len() as u64);
    output.extend_from_slice(value);
    Ok(())
}
fn put_str(output: &mut Vec<u8>, value: &str) -> Result<(), String> {
    put_bytes(output, value.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct SyntheticAuthenticator {
        expected: Vec<u8>,
        unavailable: bool,
        operational_claim: bool,
    }

    impl EvidenceAuthenticator for SyntheticAuthenticator {
        fn authenticate(&self, canonical: &[u8], _envelope: &[u8]) -> Authentication {
            if self.unavailable {
                return Authentication::Unavailable("SYNTHETIC_TRUST_UNAVAILABLE".into());
            }
            if canonical != self.expected {
                return Authentication::Invalid("SIGNED_CONTENT_MISMATCH".into());
            }
            Authentication::Verified(TrustClaim {
                chain_identity: "solana-mainnet".into(),
                signer_identity: "synthetic-fixture-signer".into(),
                trust_registry_epoch: 1,
                claim_purpose: "SYLPH_HISTORICAL_AUTHORITY_IMPORT_V1".into(),
                synthetic_only: !self.operational_claim,
            })
        }
    }

    fn anchor() -> ImportAnchor {
        ImportAnchor {
            chain_identity: "solana-mainnet".into(),
            generation: 4,
            state_root: "anchor-root".into(),
            last_receipt_identity: "receipt-4".into(),
            unresolved_obligations: vec![Obligation {
                identity: "obligation-open".into(),
                state: "UNKNOWN".into(),
                external_identity: "synthetic-effect-1".into(),
            }],
        }
    }

    fn bundle() -> ImportBundle {
        let mut bundle = ImportBundle {
            schema: IMPORT_SCHEMA,
            chain_identity: "solana-mainnet".into(),
            generation: 5,
            parent_generation: 4,
            parent_state_root: "anchor-root".into(),
            state_root: String::new(),
            receipts: vec![
                ReceiptRecord {
                    identity: "receipt-5a".into(),
                    parent_identity: "receipt-4".into(),
                    payload: b"synthetic transaction A".to_vec(),
                },
                ReceiptRecord {
                    identity: "receipt-5b".into(),
                    parent_identity: "receipt-5a".into(),
                    payload: b"synthetic transaction B".to_vec(),
                },
            ],
            obligations: vec![Obligation {
                identity: "obligation-open".into(),
                state: "UNKNOWN".into(),
                external_identity: "synthetic-effect-1".into(),
            }],
            evidence_envelope: b"synthetic-only-envelope".to_vec(),
        };
        bundle.state_root = state_root(&bundle).unwrap();
        bundle
    }

    #[test]
    fn exact_synthetic_claim_can_be_validated_but_is_marked_synthetic() {
        let candidate = bundle();
        let expected = canonical_claim(&candidate).unwrap();
        let auth = SyntheticAuthenticator {
            expected,
            unavailable: false,
            operational_claim: false,
        };
        match ImportKernel::validate(&anchor(), candidate, &auth) {
            ImportDecision::Accepted(verified) => {
                assert!(verified.trust_claim().synthetic_only);
                assert_eq!(verified.bundle().generation, 5);
            }
            _ => panic!("valid synthetic-only test claim rejected"),
        }
    }

    #[test]
    fn absent_trust_is_indeterminate_and_never_accepted() {
        let candidate = bundle();
        let auth = SyntheticAuthenticator {
            expected: vec![],
            unavailable: true,
            operational_claim: false,
        };
        assert!(matches!(
            ImportKernel::validate(&anchor(), candidate, &auth),
            ImportDecision::Indeterminate(_)
        ));
    }

    #[test]
    fn mutated_and_rehashed_content_is_rejected_by_exact_signed_bytes() {
        let original = bundle();
        let expected = canonical_claim(&original).unwrap();
        let auth = SyntheticAuthenticator {
            expected,
            unavailable: false,
            operational_claim: false,
        };
        let mut mutated = original;
        mutated.receipts[1].payload = b"changed but caller-rehashed".to_vec();
        mutated.state_root = state_root(&mutated).unwrap();
        assert!(
            matches!(ImportKernel::validate(&anchor(), mutated, &auth), ImportDecision::Rejected(reason) if reason == "SIGNED_CONTENT_MISMATCH")
        );
    }

    #[test]
    fn missing_parent_duplicate_receipt_or_dropped_obligation_is_rejected() {
        let auth = SyntheticAuthenticator {
            expected: vec![],
            unavailable: true,
            operational_claim: false,
        };
        let mut missing_parent = bundle();
        missing_parent.receipts[0].parent_identity = "absent".into();
        missing_parent.state_root = state_root(&missing_parent).unwrap();
        assert!(matches!(
            ImportKernel::validate(&anchor(), missing_parent, &auth),
            ImportDecision::Rejected(_)
        ));
        let mut duplicate = bundle();
        duplicate.receipts[1].identity = duplicate.receipts[0].identity.clone();
        duplicate.state_root = state_root(&duplicate).unwrap();
        assert!(matches!(
            ImportKernel::validate(&anchor(), duplicate, &auth),
            ImportDecision::Rejected(_)
        ));
        let mut dropped = bundle();
        dropped.obligations.clear();
        dropped.state_root = state_root(&dropped).unwrap();
        assert!(
            matches!(ImportKernel::validate(&anchor(), dropped, &auth), ImportDecision::Rejected(reason) if reason.starts_with("IMPORT_OBLIGATION_DROPPED"))
        );
    }

    #[test]
    fn non_test_trust_remains_indeterminate_without_operational_roots() {
        let candidate = bundle();
        let expected = canonical_claim(&candidate).unwrap();
        let auth = SyntheticAuthenticator {
            expected,
            unavailable: false,
            operational_claim: true,
        };
        assert!(
            matches!(ImportKernel::validate(&anchor(), candidate, &auth), ImportDecision::Indeterminate(reason) if reason == "OPERATIONAL_TRUST_ROOT_NOT_PROVISIONED")
        );
    }

    #[test]
    fn obligation_cannot_be_marked_resolved_without_a_resolution_proof_type() {
        let candidate = bundle();
        let expected = canonical_claim(&candidate).unwrap();
        let auth = SyntheticAuthenticator {
            expected,
            unavailable: false,
            operational_claim: false,
        };
        let mut changed = candidate;
        changed.obligations[0].state = "RESOLVED".into();
        changed.state_root = state_root(&changed).unwrap();
        assert!(
            matches!(ImportKernel::validate(&anchor(), changed, &auth), ImportDecision::Rejected(reason) if reason.starts_with("IMPORT_OBLIGATION_CHANGED_WITHOUT_PROOF"))
        );
    }

    #[test]
    fn receipt_inventory_must_be_one_ordered_parent_chain() {
        let candidate = bundle();
        let auth = SyntheticAuthenticator {
            expected: vec![],
            unavailable: true,
            operational_claim: false,
        };
        let mut branched = candidate;
        branched.receipts[1].parent_identity = "receipt-4".into();
        branched.state_root = state_root(&branched).unwrap();
        assert!(
            matches!(ImportKernel::validate(&anchor(), branched, &auth), ImportDecision::Rejected(reason) if reason == "IMPORT_RECEIPT_PARENT_MISSING_OR_OUT_OF_ORDER:1")
        );
    }

    #[test]
    fn sqlite_generation_integer_range_is_checked_before_conversion() {
        let mut bad_anchor = anchor();
        bad_anchor.generation = i64::MAX as u64;
        let mut candidate = bundle();
        candidate.generation = bad_anchor.generation.checked_add(1).unwrap();
        candidate.parent_generation = bad_anchor.generation;
        candidate.parent_state_root = bad_anchor.state_root.clone();
        candidate.state_root = state_root(&candidate).unwrap();
        assert!(matches!(
            validate_structure(&bad_anchor, &candidate),
            Err(reason) if reason == "IMPORT_ANCHOR_OR_LIMIT_MISMATCH"
        ));
    }

    #[test]
    fn state_root_is_recomputed_and_binds_receipts_and_obligations() {
        let candidate = bundle();
        assert_eq!(state_root(&candidate).unwrap(), candidate.state_root);
        let mut changed = candidate.clone();
        changed.receipts[0].payload.push(b'!');
        let auth = SyntheticAuthenticator {
            expected: canonical_claim(&candidate).unwrap(),
            unavailable: false,
            operational_claim: false,
        };
        assert!(matches!(
            ImportKernel::validate(&anchor(), changed, &auth),
            ImportDecision::Rejected(reason) if reason == "IMPORT_STATE_ROOT_MISMATCH"
        ));
    }

    #[test]
    fn sha256_matches_the_standard_known_answer() {
        assert_eq!(
            sha256(b"abc")
                .unwrap()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn canonicalization_rejects_oversized_inventory_before_building_claim_bytes() {
        let mut candidate = bundle();
        let mut parent = "receipt-5b".to_string();
        for index in 0..65 {
            let identity = format!("large-receipt-{index}");
            candidate.receipts.push(ReceiptRecord {
                identity: identity.clone(),
                parent_identity: parent,
                payload: vec![b'x'; MAX_FIELD_BYTES],
            });
            parent = identity;
        }
        assert!(matches!(
            canonical_claim(&candidate),
            Err(reason) if reason == "IMPORT_CANONICAL_CLAIM_TOO_LARGE"
        ));
    }
}

