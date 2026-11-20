//! Shared request and storage kernel for the opt-in synthetic maintenance
//! endpoint. The standalone maintenance executable is a client only and never
//! opens a database. The feature-gated broker endpoint writes only
//! `<configured-data-dir>/synthetic-maintenance-data/synthetic-import.sqlite`;
//! unit tests use disposable temporary paths. Neither selects or shares the
//! normal `registry.sqlite`. The endpoint uses a distinct named pipe,
//! configured client SID, and operation lock, with no normal `Registry`
//! reference or readiness callback. Callers cannot supply paths, SQL, trust
//! claims, or authentication decisions.
//!
//! The envelope below is a public test marker, not a signature. The synthetic
//! authenticator intentionally proves no identity, finality, or operational
//! authority. Never use this endpoint or its database for production.

use crate::import;
use crate::import::{
    Authentication, EvidenceAuthenticator, ImportAnchor, ImportBundle, ImportDecision,
    ImportKernel, Obligation, ReceiptRecord, TrustClaim,
};
use crate::import_store::{ApplyOutcome, DurableImportStore};
use std::fs;
use std::io::{self, Read};
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};

const FRAME_MAGIC: &[u8; 8] = b"G1SIMP01";
const RESPONSE_SCHEMA: &str = "SYLPH_G1_SYNTHETIC_IMPORT_RESULT_V1";
const SYNTHETIC_ENVELOPE_PREFIX: &[u8] = b"SYLPH_G1_SYNTHETIC_TEST_ONLY_V1\0";
const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;
const MAX_FIELD_BYTES: usize = 1024 * 1024;
const MAX_RECORDS: usize = 100_000;
const MAX_OBLIGATIONS: usize = 100_000;
const REQUEST_ID_BYTES: usize = 16;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Request {
    request_id: [u8; REQUEST_ID_BYTES],
    base_anchor: ImportAnchor,
    expected_head: ImportAnchor,
    bundle: ImportBundle,
}

struct SyntheticAuthenticator {
    chain_identity: String,
}

impl EvidenceAuthenticator for SyntheticAuthenticator {
    fn authenticate(&self, _canonical_claim: &[u8], envelope: &[u8]) -> Authentication {
        // The synthetic adapter accepts marker-shaped historical envelopes so
        // the store can replay older generations when a new request arrives.
        // The incoming request is separately bound to its exact request ID by
        // decode_request. This is fixture syntax validation, not trust.
        if envelope.len() != SYNTHETIC_ENVELOPE_PREFIX.len() + REQUEST_ID_BYTES
            || !envelope.starts_with(SYNTHETIC_ENVELOPE_PREFIX)
            || envelope[SYNTHETIC_ENVELOPE_PREFIX.len()..]
                .iter()
                .all(|byte| *byte == 0)
        {
            return Authentication::Invalid("SYNTHETIC_ENVELOPE_MISMATCH".into());
        }
        Authentication::Verified(TrustClaim {
            chain_identity: self.chain_identity.clone(),
            signer_identity: "SYNTHETIC_TEST_FIXTURE_ONLY".into(),
            trust_registry_epoch: 1,
            claim_purpose: "SYLPH_HISTORICAL_AUTHORITY_IMPORT_V1".into(),
            synthetic_only: true,
        })
    }
}

fn synthetic_envelope(request_id: &[u8; REQUEST_ID_BYTES]) -> Vec<u8> {
    let mut envelope = Vec::with_capacity(SYNTHETIC_ENVELOPE_PREFIX.len() + REQUEST_ID_BYTES);
    envelope.extend_from_slice(SYNTHETIC_ENVELOPE_PREFIX);
    envelope.extend_from_slice(request_id);
    envelope
}

fn read_frame<R: Read>(reader: &mut R) -> Result<Vec<u8>, String> {
    let mut size_bytes = [0u8; 4];
    reader
        .read_exact(&mut size_bytes)
        .map_err(|_| "FRAME_LENGTH_MISSING".to_owned())?;
    let size = u32::from_be_bytes(size_bytes) as usize;
    if size == 0 || size > MAX_FRAME_BYTES {
        return Err("FRAME_LENGTH_OUT_OF_RANGE".into());
    }
    let mut payload = vec![0u8; size];
    reader
        .read_exact(&mut payload)
        .map_err(|_| "FRAME_TRUNCATED".to_owned())?;
    let mut trailing = [0u8; 1];
    if reader
        .read(&mut trailing)
        .map_err(|_| "FRAME_READ_FAILED".to_owned())?
        != 0
    {
        return Err("FRAME_TRAILING_BYTES".into());
    }
    Ok(payload)
}

fn decode_request(frame: &[u8]) -> Result<Request, String> {
    if frame.is_empty() || frame.len() > MAX_FRAME_BYTES {
        return Err("FRAME_LENGTH_OUT_OF_RANGE".into());
    }
    let mut cursor = Cursor::new(frame);
    if cursor.take(FRAME_MAGIC.len())? != FRAME_MAGIC {
        return Err("FRAME_MAGIC_INVALID".into());
    }
    let mut request_id = [0u8; REQUEST_ID_BYTES];
    request_id.copy_from_slice(cursor.take(REQUEST_ID_BYTES)?);
    if request_id.iter().all(|byte| *byte == 0) {
        return Err("REQUEST_ID_INVALID".into());
    }

    let base_anchor = ImportAnchor {
        chain_identity: cursor.string()?,
        generation: cursor.u64()?,
        state_root: cursor.string()?,
        last_receipt_identity: cursor.string()?,
        unresolved_obligations: cursor.obligations(MAX_OBLIGATIONS)?,
    };
    let expected_head = ImportAnchor {
        chain_identity: cursor.string()?,
        generation: cursor.u64()?,
        state_root: cursor.string()?,
        last_receipt_identity: cursor.string()?,
        unresolved_obligations: cursor.obligations(MAX_OBLIGATIONS)?,
    };
    let bundle = ImportBundle {
        schema: cursor.u32()?,
        chain_identity: cursor.string()?,
        generation: cursor.u64()?,
        parent_generation: cursor.u64()?,
        parent_state_root: cursor.string()?,
        state_root: cursor.string()?,
        receipts: cursor.receipts()?,
        obligations: cursor.obligations(MAX_OBLIGATIONS)?,
        evidence_envelope: cursor.bytes()?,
    };
    if !cursor.is_empty() {
        return Err("FRAME_TRAILING_BYTES".into());
    }
    if bundle.evidence_envelope != synthetic_envelope(&request_id) {
        return Err("SYNTHETIC_ENVELOPE_MISMATCH".into());
    }
    Ok(Request {
        request_id,
        base_anchor,
        expected_head,
        bundle,
    })
}

struct Cursor<'a> {
    input: &'a [u8],
    offset: usize,
}

impl<'a> Cursor<'a> {
    fn new(input: &'a [u8]) -> Self {
        Self { input, offset: 0 }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], String> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| "FRAME_OFFSET_OVERFLOW".to_owned())?;
        if end > self.input.len() {
            return Err("FRAME_TRUNCATED".into());
        }
        let result = &self.input[self.offset..end];
        self.offset = end;
        Ok(result)
    }

    fn u32(&mut self) -> Result<u32, String> {
        let mut bytes = [0u8; 4];
        bytes.copy_from_slice(self.take(4)?);
        Ok(u32::from_be_bytes(bytes))
    }

    fn u64(&mut self) -> Result<u64, String> {
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(self.take(8)?);
        Ok(u64::from_be_bytes(bytes))
    }

    fn bytes(&mut self) -> Result<Vec<u8>, String> {
        let length = self.u32()? as usize;
        if length > MAX_FIELD_BYTES {
            return Err("FRAME_FIELD_TOO_LARGE".into());
        }
        Ok(self.take(length)?.to_vec())
    }

    fn string(&mut self) -> Result<String, String> {
        String::from_utf8(self.bytes()?).map_err(|_| "FRAME_STRING_NOT_UTF8".into())
    }

    fn obligations(&mut self, maximum: usize) -> Result<Vec<Obligation>, String> {
        let count = self.u32()? as usize;
        if count > maximum {
            return Err("FRAME_OBLIGATION_COUNT_TOO_LARGE".into());
        }
        let mut values = Vec::with_capacity(count);
        for _ in 0..count {
            values.push(Obligation {
                identity: self.string()?,
                state: self.string()?,
                external_identity: self.string()?,
            });
        }
        Ok(values)
    }

    fn receipts(&mut self) -> Result<Vec<ReceiptRecord>, String> {
        let count = self.u32()? as usize;
        if count > MAX_RECORDS {
            return Err("FRAME_RECEIPT_COUNT_TOO_LARGE".into());
        }
        let mut values = Vec::with_capacity(count);
        for _ in 0..count {
            values.push(ReceiptRecord {
                identity: self.string()?,
                parent_identity: self.string()?,
                payload: self.bytes()?,
            });
        }
        Ok(values)
    }

    fn is_empty(&self) -> bool {
        self.offset == self.input.len()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ResultKind {
    Activated,
    AlreadyActive,
    Rejected,
    Indeterminate,
}

impl ResultKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Activated => "ACTIVATED",
            Self::AlreadyActive => "ALREADY_ACTIVE",
            Self::Rejected => "REJECTED",
            Self::Indeterminate => "INDETERMINATE",
        }
    }
}

fn process_request(
    frame: &[u8],
    database_path: &Path,
) -> (ResultKind, Option<[u8; REQUEST_ID_BYTES]>) {
    let request = match decode_request(frame) {
        Ok(value) => value,
        Err(_) => return (ResultKind::Rejected, None),
    };
    let request_id = request.request_id;
    let authenticator = SyntheticAuthenticator {
        chain_identity: request.bundle.chain_identity.clone(),
    };
    if let Err(error) = storage_path_preflight(database_path) {
        #[cfg(test)]
        eprintln!("synthetic import storage preflight: {error}");
        return (ResultKind::Indeterminate, Some(request_id));
    }
    if database_path.exists() {
        let mut store = match DurableImportStore::open_existing(
            database_path,
            &request.base_anchor,
            &request.expected_head,
            &authenticator,
        ) {
            Ok(value) => value,
            Err(error) => {
                #[cfg(test)]
                eprintln!("synthetic import open_existing: {error}");
                return (ResultKind::Indeterminate, Some(request_id));
            }
        };
        // The complete existing history has been replayed against the
        // separately pinned current head. Recover the exact parent anchor
        // from that verified store so generation n -> n+1 validates against
        // its actual parent rather than the incoming bundle's head.
        let parent = match store.anchor_at(request.bundle.parent_generation, &authenticator) {
            Ok(value) => value,
            Err(error) => {
                #[cfg(test)]
                eprintln!("synthetic import anchor_at: {error}");
                return (ResultKind::Indeterminate, Some(request_id));
            }
        };
        let verified = match validate_request_bundle(&request.bundle, &parent, &authenticator) {
            Ok(value) => value,
            Err(kind) => return (kind, Some(request_id)),
        };
        return match store.activate(&verified, &authenticator) {
            Ok(ApplyOutcome::Activated) => (ResultKind::Activated, Some(request_id)),
            Ok(ApplyOutcome::AlreadyActive) => (ResultKind::AlreadyActive, Some(request_id)),
            Err(error) if definitely_rejected(&error) => (ResultKind::Rejected, Some(request_id)),
            // Commit failures and post-commit verification failures remain
            // ambiguous. Never convert them into a safe-to-retry rejection.
            Err(error) => {
                #[cfg(test)]
                eprintln!("synthetic import activate existing: {error}");
                (ResultKind::Indeterminate, Some(request_id))
            }
        };
    }

    if request.expected_head != request.base_anchor {
        return (ResultKind::Rejected, Some(request_id));
    }
    let verified =
        match validate_request_bundle(&request.bundle, &request.base_anchor, &authenticator) {
            Ok(value) => value,
            Err(kind) => return (kind, Some(request_id)),
        };
    let mut store = match DurableImportStore::create(database_path, &request.base_anchor) {
        Ok(value) => value,
        Err(error) => {
            #[cfg(test)]
            eprintln!("synthetic import create: {error}");
            return (ResultKind::Indeterminate, Some(request_id));
        }
    };
    match store.activate(&verified, &authenticator) {
        Ok(ApplyOutcome::Activated) => (ResultKind::Activated, Some(request_id)),
        Ok(ApplyOutcome::AlreadyActive) => (ResultKind::AlreadyActive, Some(request_id)),
        Err(error) if definitely_rejected(&error) => (ResultKind::Rejected, Some(request_id)),
        Err(error) => {
            #[cfg(test)]
            eprintln!("synthetic import activate new: {error}");
            (ResultKind::Indeterminate, Some(request_id))
        }
    }
}

fn storage_path_preflight(database_path: &Path) -> Result<(), String> {
    let parent = database_path
        .parent()
        .ok_or_else(|| "SCRATCH_DIRECTORY_UNAVAILABLE".to_owned())?;
    let parent_metadata =
        fs::symlink_metadata(parent).map_err(|_| "SCRATCH_DIRECTORY_UNAVAILABLE".to_owned())?;
    if !parent_metadata.is_dir()
        || parent_metadata.file_type().is_symlink()
        || parent_metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    {
        return Err("SCRATCH_DIRECTORY_REPARSE_POINT_REJECTED".into());
    }
    let mut wal = database_path.as_os_str().to_os_string();
    wal.push("-wal");
    let mut shm = database_path.as_os_str().to_os_string();
    shm.push("-shm");
    let mut journal = database_path.as_os_str().to_os_string();
    journal.push("-journal");
    for path in [
        database_path.to_path_buf(),
        PathBuf::from(wal),
        PathBuf::from(shm),
        PathBuf::from(journal),
    ] {
        match fs::symlink_metadata(&path) {
            Ok(metadata)
                if metadata.file_type().is_symlink()
                    || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
                    || !metadata.is_file() =>
            {
                return Err("SCRATCH_STORAGE_REPARSE_POINT_REJECTED".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err("SCRATCH_STORAGE_PREFLIGHT_FAILED".into()),
        }
    }
    Ok(())
}

fn validate_request_bundle(
    bundle: &ImportBundle,
    parent: &ImportAnchor,
    authenticator: &dyn EvidenceAuthenticator,
) -> Result<import::VerifiedImport, ResultKind> {
    match ImportKernel::validate(parent, bundle.clone(), authenticator) {
        ImportDecision::Accepted(value) if value.trust_claim().synthetic_only => Ok(value),
        ImportDecision::Accepted(_) | ImportDecision::Rejected(_) => Err(ResultKind::Rejected),
        ImportDecision::Indeterminate(_) => Err(ResultKind::Indeterminate),
    }
}

fn definitely_rejected(error: &str) -> bool {
    matches!(
        error,
        "IMPORT_ACTIVE_GENERATION_CONFLICT"
            | "IMPORT_ATTESTATION_RENEWAL_UNSUPPORTED"
            | "IMPORT_VERIFIED_CAPABILITY_MISMATCH"
            | "IMPORT_ACTIVATION_COMPARE_AND_SWAP_FAILED"
    )
}

fn output_result(kind: ResultKind, request_id: Option<[u8; REQUEST_ID_BYTES]>) -> String {
    let id: String = request_id
        .map(|value| value.iter().map(|byte| format!("{byte:02x}")).collect())
        .unwrap_or_else(|| "null".into());
    format!(
        "{{\"schema\":\"{RESPONSE_SCHEMA}\",\"authority\":\"SYNTHETIC_TEST_ONLY\",\"requestId\":\"{id}\",\"result\":\"{}\"}}\n",
        kind.as_str()
    )
}

/// Handles the small, hex-wrapped named-pipe form. The Windows pipe framing
/// limit is intentionally much smaller than the standalone stdin harness.
/// This remains synthetic-only and never accepts a path or authentication
/// decision from the message.
pub(super) fn process_pipe_message(message: &str, database_path: &Path) -> String {
    const PREFIX: &str = "SYNTH_IMPORT_HEX|";
    const MAX_HEX_BYTES: usize = 1800;
    let Some(hex) = message.strip_prefix(PREFIX) else {
        return output_result(ResultKind::Rejected, None)
            .trim_end_matches('\n')
            .to_owned();
    };
    if hex.is_empty() || hex.len() > MAX_HEX_BYTES || hex.len() % 2 != 0 {
        return output_result(ResultKind::Rejected, None)
            .trim_end_matches('\n')
            .to_owned();
    }
    let mut frame = Vec::with_capacity(hex.len() / 2);
    for pair in hex.as_bytes().chunks_exact(2) {
        let Some(high) = (pair[0] as char).to_digit(16) else {
            return output_result(ResultKind::Rejected, None)
                .trim_end_matches('\n')
                .to_owned();
        };
        let Some(low) = (pair[1] as char).to_digit(16) else {
            return output_result(ResultKind::Rejected, None)
                .trim_end_matches('\n')
                .to_owned();
        };
        frame.push(((high << 4) | low) as u8);
    }
    let (kind, request_id) = process_request(&frame, database_path);
    output_result(kind, request_id)
        .trim_end_matches('\n')
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn put_u32(output: &mut Vec<u8>, value: u32) {
        output.extend_from_slice(&value.to_be_bytes());
    }
    fn put_u64(output: &mut Vec<u8>, value: u64) {
        output.extend_from_slice(&value.to_be_bytes());
    }
    fn put_bytes(output: &mut Vec<u8>, value: &[u8]) {
        put_u32(output, value.len() as u32);
        output.extend_from_slice(value);
    }
    fn put_str(output: &mut Vec<u8>, value: &str) {
        put_bytes(output, value.as_bytes());
    }
    fn encode_obligations(output: &mut Vec<u8>, values: &[Obligation]) {
        put_u32(output, values.len() as u32);
        for value in values {
            put_str(output, &value.identity);
            put_str(output, &value.state);
            put_str(output, &value.external_identity);
        }
    }

    #[test]
    fn synthetic_authenticator_replays_prior_generation_markers_only() {
        let auth = SyntheticAuthenticator {
            chain_identity: "synthetic-chain".into(),
        };
        let prior = synthetic_envelope(&[0x41; REQUEST_ID_BYTES]);
        assert!(matches!(
            auth.authenticate(b"synthetic claim", &prior),
            Authentication::Verified(TrustClaim {
                synthetic_only: true,
                ..
            })
        ));
        assert!(matches!(
            auth.authenticate(b"synthetic claim", b"NOT_A_SYNTHETIC_ENVELOPE"),
            Authentication::Invalid(_)
        ));
    }

    fn fixture(request_id: [u8; REQUEST_ID_BYTES]) -> (ImportAnchor, ImportBundle) {
        let anchor = ImportAnchor {
            chain_identity: "synthetic-chain".into(),
            generation: 1,
            state_root: "base-state-root".into(),
            last_receipt_identity: "base-receipt".into(),
            unresolved_obligations: vec![],
        };
        let mut bundle = ImportBundle {
            schema: 1,
            chain_identity: anchor.chain_identity.clone(),
            generation: 2,
            parent_generation: 1,
            parent_state_root: anchor.state_root.clone(),
            state_root: String::new(),
            receipts: vec![ReceiptRecord {
                identity: "receipt-2".into(),
                parent_identity: anchor.last_receipt_identity.clone(),
                payload: b"synthetic payload".to_vec(),
            }],
            obligations: vec![],
            evidence_envelope: synthetic_envelope(&request_id),
        };
        bundle.state_root = import::state_root(&bundle).unwrap();
        (anchor, bundle)
    }

    fn next_bundle(
        parent: &ImportAnchor,
        request_id: [u8; REQUEST_ID_BYTES],
        identity: &str,
    ) -> ImportBundle {
        let mut bundle = ImportBundle {
            schema: 1,
            chain_identity: parent.chain_identity.clone(),
            generation: parent.generation + 1,
            parent_generation: parent.generation,
            parent_state_root: parent.state_root.clone(),
            state_root: String::new(),
            receipts: vec![ReceiptRecord {
                identity: identity.into(),
                parent_identity: parent.last_receipt_identity.clone(),
                payload: format!("synthetic {identity}").into_bytes(),
            }],
            obligations: parent.unresolved_obligations.clone(),
            evidence_envelope: synthetic_envelope(&request_id),
        };
        bundle.state_root = import::state_root(&bundle).unwrap();
        bundle
    }

    fn bundle_head(bundle: &ImportBundle) -> ImportAnchor {
        ImportAnchor {
            chain_identity: bundle.chain_identity.clone(),
            generation: bundle.generation,
            state_root: bundle.state_root.clone(),
            last_receipt_identity: bundle.receipts.last().unwrap().identity.clone(),
            unresolved_obligations: bundle.obligations.clone(),
        }
    }

    fn encode_request(
        request_id: [u8; REQUEST_ID_BYTES],
        base_anchor: &ImportAnchor,
        expected_head: &ImportAnchor,
        bundle: &ImportBundle,
    ) -> Vec<u8> {
        let mut output = Vec::new();
        output.extend_from_slice(FRAME_MAGIC);
        output.extend_from_slice(&request_id);
        put_str(&mut output, &base_anchor.chain_identity);
        put_u64(&mut output, base_anchor.generation);
        put_str(&mut output, &base_anchor.state_root);
        put_str(&mut output, &base_anchor.last_receipt_identity);
        encode_obligations(&mut output, &base_anchor.unresolved_obligations);
        put_str(&mut output, &expected_head.chain_identity);
        put_u64(&mut output, expected_head.generation);
        put_str(&mut output, &expected_head.state_root);
        put_str(&mut output, &expected_head.last_receipt_identity);
        encode_obligations(&mut output, &expected_head.unresolved_obligations);
        put_u32(&mut output, bundle.schema);
        put_str(&mut output, &bundle.chain_identity);
        put_u64(&mut output, bundle.generation);
        put_u64(&mut output, bundle.parent_generation);
        put_str(&mut output, &bundle.parent_state_root);
        put_str(&mut output, &bundle.state_root);
        put_u32(&mut output, bundle.receipts.len() as u32);
        for receipt in &bundle.receipts {
            put_str(&mut output, &receipt.identity);
            put_str(&mut output, &receipt.parent_identity);
            put_bytes(&mut output, &receipt.payload);
        }
        encode_obligations(&mut output, &bundle.obligations);
        put_bytes(&mut output, &bundle.evidence_envelope);
        output
    }

    fn scratch_path(label: &str) -> PathBuf {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("g1-synth-{label}-{now}"));
        fs::create_dir_all(&root).unwrap();
        root.join("synthetic-import.sqlite")
    }

    #[test]
    fn bounded_frame_decoder_accepts_valid_payload_and_rejects_truncation_and_trailing_data() {
        let request_id = [7u8; REQUEST_ID_BYTES];
        let (anchor, bundle) = fixture(request_id);
        let frame = encode_request(request_id, &anchor, &anchor, &bundle);
        assert_eq!(decode_request(&frame).unwrap().request_id, request_id);
        let mut truncated = frame.clone();
        truncated.pop();
        assert_eq!(decode_request(&truncated).unwrap_err(), "FRAME_TRUNCATED");
        let mut trailing = frame;
        trailing.push(0);
        assert_eq!(
            decode_request(&trailing).unwrap_err(),
            "FRAME_TRAILING_BYTES"
        );

        let mut length_prefix = Vec::new();
        length_prefix.extend_from_slice(&((MAX_FRAME_BYTES as u32) + 1).to_be_bytes());
        assert_eq!(
            read_frame(&mut length_prefix.as_slice()).unwrap_err(),
            "FRAME_LENGTH_OUT_OF_RANGE"
        );
    }

    #[test]
    fn malformed_oversize_and_zero_id_requests_do_not_create_a_store() {
        let path = scratch_path("malformed");
        let (kind, _) = process_request(b"bad", &path);
        assert_eq!(kind, ResultKind::Rejected);
        assert!(!path.exists());

        let mut oversized = vec![0u8; MAX_FRAME_BYTES + 1];
        oversized[..8].copy_from_slice(FRAME_MAGIC);
        let (kind, _) = process_request(&oversized, &path);
        assert_eq!(kind, ResultKind::Rejected);
        assert!(!path.exists());

        let zero_id = [0u8; REQUEST_ID_BYTES];
        let (anchor, bundle) = fixture([8u8; REQUEST_ID_BYTES]);
        let frame = encode_request(zero_id, &anchor, &anchor, &bundle);
        let (kind, _) = process_request(&frame, &path);
        assert_eq!(kind, ResultKind::Rejected);
        assert!(!path.exists());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn same_id_and_identical_request_is_idempotent_but_mutation_is_rejected() {
        let path = scratch_path("replay");
        let request_id = [9u8; REQUEST_ID_BYTES];
        let (anchor, bundle) = fixture(request_id);
        let initial = encode_request(request_id, &anchor, &anchor, &bundle);
        assert_eq!(process_request(&initial, &path).0, ResultKind::Activated);
        let current = bundle_head(&bundle);
        let retry = encode_request(request_id, &anchor, &current, &bundle);
        assert_eq!(process_request(&retry, &path).0, ResultKind::AlreadyActive);

        let mut conflict = bundle;
        conflict.receipts[0].payload = b"conflicting payload".to_vec();
        conflict.state_root = import::state_root(&conflict).unwrap();
        let conflict_frame = encode_request(request_id, &anchor, &current, &conflict);
        assert_eq!(
            process_request(&conflict_frame, &path).0,
            ResultKind::Rejected
        );
        assert_eq!(process_request(&retry, &path).0, ResultKind::AlreadyActive);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn different_id_cannot_replay_the_same_generation_as_a_new_request() {
        let path = scratch_path("different-id");
        let first_id = [10u8; REQUEST_ID_BYTES];
        let (anchor, bundle) = fixture(first_id);
        let first = encode_request(first_id, &anchor, &anchor, &bundle);
        assert_eq!(process_request(&first, &path).0, ResultKind::Activated);
        let current = bundle_head(&bundle);

        let second_id = [11u8; REQUEST_ID_BYTES];
        let mut second_bundle = bundle.clone();
        second_bundle.evidence_envelope = synthetic_envelope(&second_id);
        let second = encode_request(second_id, &anchor, &current, &second_bundle);
        assert_eq!(process_request(&second, &path).0, ResultKind::Rejected);
        let first_retry = encode_request(first_id, &anchor, &current, &bundle);
        assert_eq!(
            process_request(&first_retry, &path).0,
            ResultKind::AlreadyActive
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn sequential_generation_uses_pinned_current_head_and_rejects_rollback_or_conflict() {
        let path = scratch_path("sequential");
        let first_id = [20u8; REQUEST_ID_BYTES];
        let (base, generation_two) = fixture(first_id);
        let first = encode_request(first_id, &base, &base, &generation_two);
        assert_eq!(process_request(&first, &path).0, ResultKind::Activated);
        let head_two = bundle_head(&generation_two);

        let second_id = [21u8; REQUEST_ID_BYTES];
        let generation_three = next_bundle(&head_two, second_id, "receipt-3");
        let second = encode_request(second_id, &base, &head_two, &generation_three);
        assert_eq!(process_request(&second, &path).0, ResultKind::Activated);
        let head_three = bundle_head(&generation_three);

        // Lost-ack replay uses the separately reconstructed current head and
        // the same request id/envelope, so it is recognized without a second
        // generation or duplicate receipt effect.
        let second_retry = encode_request(second_id, &base, &head_three, &generation_three);
        assert_eq!(
            process_request(&second_retry, &path).0,
            ResultKind::AlreadyActive
        );

        // A stale pre-operation head cannot authorize a new append after the
        // store has advanced. This is synthetic comparison only, not an
        // operational rollback-resistant trust proof.
        let third_id = [22u8; REQUEST_ID_BYTES];
        let generation_four = next_bundle(&head_three, third_id, "receipt-4");
        let stale = encode_request(third_id, &base, &head_two, &generation_four);
        assert_eq!(process_request(&stale, &path).0, ResultKind::Indeterminate);

        // Reusing a consumed request id for another generation conflicts with
        // the persisted unique synthetic envelope.
        let reused_id = next_bundle(&head_three, first_id, "receipt-4-reused-id");
        let reused = encode_request(first_id, &base, &head_three, &reused_id);
        assert_eq!(process_request(&reused, &path).0, ResultKind::Indeterminate);
        assert_eq!(
            process_request(&second_retry, &path).0,
            ResultKind::AlreadyActive
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn request_cannot_select_paths_and_store_isolated_from_normal_registry() {
        let path = scratch_path("isolation");
        let request_id = [12u8; REQUEST_ID_BYTES];
        let (anchor, bundle) = fixture(request_id);
        let frame = encode_request(request_id, &anchor, &anchor, &bundle);
        assert_eq!(process_request(&frame, &path).0, ResultKind::Activated);
        assert!(path.exists());
        assert_eq!(path.file_name().unwrap(), "synthetic-import.sqlite");
        assert!(!path.parent().unwrap().join("registry.sqlite").exists());
        assert!(!path.parent().unwrap().join("broker-ready.json").exists());
        let mut with_path = frame;
        with_path.extend_from_slice(b"C:\\outside\\registry.sqlite");
        assert_eq!(
            decode_request(&with_path).unwrap_err(),
            "FRAME_TRAILING_BYTES"
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn named_pipe_adapter_rejects_bad_hex_and_oversize_without_creating_store() {
        let path = scratch_path("pipe-adapter");
        let malformed = process_pipe_message("SYNTH_IMPORT_HEX|0g", &path);
        assert!(malformed.contains("\"result\":\"REJECTED\""));
        assert!(malformed.contains("\"authority\":\"SYNTHETIC_TEST_ONLY\""));
        assert!(!path.exists());

        let too_large = format!("SYNTH_IMPORT_HEX|{}", "a".repeat(1802));
        let oversized = process_pipe_message(&too_large, &path);
        assert!(oversized.contains("\"result\":\"REJECTED\""));
        assert!(!path.exists());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn named_pipe_adapter_activates_only_the_fixed_synthetic_store() {
        let path = scratch_path("pipe-valid");
        let request_id = [31u8; REQUEST_ID_BYTES];
        let (anchor, bundle) = fixture(request_id);
        let frame = encode_request(request_id, &anchor, &anchor, &bundle);
        let message = format!(
            "SYNTH_IMPORT_HEX|{}",
            frame
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        );
        let response = process_pipe_message(&message, &path);
        assert!(response.contains("\"result\":\"ACTIVATED\""));
        assert!(response.contains("\"authority\":\"SYNTHETIC_TEST_ONLY\""));
        assert!(path.exists());
        assert!(!path.parent().unwrap().join("registry.sqlite").exists());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn default_build_configuration_gates_the_maintenance_binary() {
        let manifest = include_str!("../Cargo.toml");
        assert!(manifest.contains("synthetic-maintenance = []"));
        assert!(manifest.contains("required-features = [\"synthetic-maintenance\"]"));
    }
}
