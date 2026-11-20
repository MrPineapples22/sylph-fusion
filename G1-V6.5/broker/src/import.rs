//! Typed boundary for importing an untrusted historical source.
//!
//! This module deliberately has no default trust provider and is not wired to
//! the service IPC. A caller must supply an independently provisioned
//! authenticator that verifies the exact canonical bytes below. The synthetic
//! test authenticator exists only under `cfg(test)`.

use std::collections::HashSet;

const IMPORT_SCHEMA: u32 = 1;
const MAX_RECORDS: usize = 100_000;
const MAX_OBLIGATIONS: usize = 100_000;
const MAX_FIELD_BYTES: usize = 1_048_576;
const MAX_BUNDLE_BYTES: usize = 64 * 1024 * 1024;

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

fn validate_structure(anchor: &ImportAnchor, bundle: &ImportBundle) -> Result<(), String> {
    if bundle.schema != IMPORT_SCHEMA {
        return Err("IMPORT_SCHEMA_UNSUPPORTED".into());
    }
    if anchor.chain_identity.is_empty()
        || bundle.chain_identity != anchor.chain_identity
        || bundle.generation
            != anchor
                .generation
                .checked_add(1)
                .ok_or("GENERATION_OVERFLOW")?
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
fn canonical_claim(bundle: &ImportBundle) -> Result<Vec<u8>, String> {
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
    if output.len() > MAX_BUNDLE_BYTES {
        return Err("IMPORT_CANONICAL_CLAIM_TOO_LARGE".into());
    }
    Ok(output)
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
        ImportBundle {
            schema: IMPORT_SCHEMA,
            chain_identity: "solana-mainnet".into(),
            generation: 5,
            parent_generation: 4,
            parent_state_root: "anchor-root".into(),
            state_root: "next-root".into(),
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
        }
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
        assert!(matches!(
            ImportKernel::validate(&anchor(), missing_parent, &auth),
            ImportDecision::Rejected(_)
        ));
        let mut duplicate = bundle();
        duplicate.receipts[1].identity = duplicate.receipts[0].identity.clone();
        assert!(matches!(
            ImportKernel::validate(&anchor(), duplicate, &auth),
            ImportDecision::Rejected(_)
        ));
        let mut dropped = bundle();
        dropped.obligations.clear();
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
        assert!(
            matches!(ImportKernel::validate(&anchor(), branched, &auth), ImportDecision::Rejected(reason) if reason == "IMPORT_RECEIPT_PARENT_MISSING_OR_OUT_OF_ORDER:1")
        );
    }
}
