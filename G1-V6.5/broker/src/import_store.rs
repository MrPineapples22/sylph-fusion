//! Disk-backed synthetic import store for G1 qualification only.
//!
//! This store is intentionally not exposed by the broker IPC and accepts only
//! the sealed `VerifiedImport` capability produced by the typed validator.
//! It is not an operational trust or recovery authority.

use crate::import::{
    canonical_claim, validate_structure, Authentication, EvidenceAuthenticator, ImportAnchor,
    Obligation, VerifiedImport,
};
use rusqlite::{params, Connection, OpenFlags, TransactionBehavior};
use std::fs::OpenOptions;
use std::path::Path;

const SQLITE_VERSION: &str = "3.54.1";
const GENERATIONS_SQL: &str = "CREATE TABLE authority_generations(generation INTEGER PRIMARY KEY,parent_generation INTEGER NOT NULL,parent_state_root TEXT NOT NULL,chain_identity TEXT NOT NULL,state_root TEXT NOT NULL,last_receipt_identity TEXT NOT NULL,receipt_count INTEGER NOT NULL,obligation_count INTEGER NOT NULL,canonical_claim BLOB NOT NULL,signer_identity TEXT NOT NULL,trust_epoch INTEGER NOT NULL,envelope BLOB NOT NULL,synthetic_only INTEGER NOT NULL CHECK(synthetic_only=1))";
const RECEIPTS_SQL: &str = "CREATE TABLE authority_receipts(generation INTEGER NOT NULL,ordinal INTEGER NOT NULL,identity TEXT NOT NULL,parent_identity TEXT NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(generation,ordinal),UNIQUE(generation,identity),FOREIGN KEY(generation) REFERENCES authority_generations(generation))";
const OBLIGATIONS_SQL: &str = "CREATE TABLE authority_obligations(generation INTEGER NOT NULL,ordinal INTEGER NOT NULL,identity TEXT NOT NULL,state TEXT NOT NULL,external_identity TEXT NOT NULL,PRIMARY KEY(generation,ordinal),UNIQUE(generation,identity),FOREIGN KEY(generation) REFERENCES authority_generations(generation))";
const ACTIVE_SQL: &str = "CREATE TABLE active_authority(singleton INTEGER PRIMARY KEY CHECK(singleton=1),generation INTEGER NOT NULL,FOREIGN KEY(generation) REFERENCES authority_generations(generation))";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApplyOutcome {
    Activated,
    AlreadyActive,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TestCommitFault {
    None,
    BeforeCommit,
    LoseAcknowledgmentAfterCommit,
}

pub struct DurableImportStore {
    connection: Connection,
    base_anchor: ImportAnchor,
    approved_head: ImportAnchor,
}

impl DurableImportStore {
    /// Create a new, empty synthetic store. Existing files are never adopted.
    pub fn create(path: &Path, anchor: &ImportAnchor) -> Result<Self, String> {
        if anchor.generation == 0
            || anchor.generation > i64::MAX as u64
            || anchor.state_root.is_empty()
            || anchor.last_receipt_identity.is_empty()
        {
            return Err("IMPORT_STORE_REQUIRES_SYNTHETIC_ANCHOR".into());
        }
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|error| format!("IMPORT_STORE_CREATE_NEW:{error}"))?;
        drop(file);
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
        )
        .map_err(|error| format!("IMPORT_STORE_OPEN:{error}"))?;
        configure(&connection)?;
        connection
            .execute_batch(&format!(
                "BEGIN IMMEDIATE;{GENERATIONS_SQL};{RECEIPTS_SQL};{OBLIGATIONS_SQL};{ACTIVE_SQL};\
                 INSERT INTO authority_generations(generation,parent_generation,parent_state_root,chain_identity,state_root,last_receipt_identity,receipt_count,obligation_count,canonical_claim,signer_identity,trust_epoch,envelope,synthetic_only) VALUES({},0,'',{}, {},{},0,{},X'','synthetic-anchor',1,X'01',1);\
                 INSERT INTO active_authority(singleton,generation) VALUES(1,{});\
                 PRAGMA user_version=1;",
                anchor.generation,
                quote(&anchor.chain_identity),
                quote(&anchor.state_root),
                quote(&anchor.last_receipt_identity),
                anchor.unresolved_obligations.len(),
                anchor.generation,
            ))
            .map_err(|error| format!("IMPORT_STORE_SCHEMA:{error}"))?;
        for (ordinal, obligation) in anchor.unresolved_obligations.iter().enumerate() {
            connection
                .execute(
                    "INSERT INTO authority_obligations(generation,ordinal,identity,state,external_identity) VALUES(?1,?2,?3,?4,?5)",
                    params![anchor.generation as i64, ordinal as i64, obligation.identity, obligation.state, obligation.external_identity],
                )
                .map_err(|error| format!("IMPORT_STORE_ANCHOR_OBLIGATION:{error}"))?;
        }
        connection
            .execute_batch("COMMIT;")
            .map_err(|error| format!("IMPORT_STORE_INITIALIZE_COMMIT:{error}"))?;
        Ok(Self {
            connection,
            base_anchor: anchor.clone(),
            approved_head: anchor.clone(),
        })
    }

    pub fn open_existing(
        path: &Path,
        expected_anchor: &ImportAnchor,
        approved_head: &ImportAnchor,
        authenticator: &dyn EvidenceAuthenticator,
    ) -> Result<Self, String> {
        if !valid_anchor(expected_anchor)
            || !valid_anchor(approved_head)
            || expected_anchor.generation > approved_head.generation
            || expected_anchor.chain_identity != approved_head.chain_identity
        {
            return Err("IMPORT_STORE_EXPECTED_ANCHOR_INVALID".into());
        }
        if !path.is_file() {
            return Err("IMPORT_STORE_MISSING".into());
        }
        // Validate the whole existing store through a read-only connection
        // before opening it for any writable configuration or recovery.
        let inspection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
        )
        .map_err(|error| format!("IMPORT_STORE_INSPECTION_OPEN:{error}"))?;
        if rusqlite::version() != SQLITE_VERSION {
            return Err(format!("IMPORT_SQLITE_VERSION:{}", rusqlite::version()));
        }
        inspection
            .pragma_update(None, "trusted_schema", "OFF")
            .map_err(|error| format!("IMPORT_INSPECTION_TRUSTED_SCHEMA:{error}"))?;
        validate_schema(&inspection)?;
        DurableImportStore {
            connection: inspection,
            base_anchor: expected_anchor.clone(),
            approved_head: approved_head.clone(),
        }
        .verify_inventory(authenticator)?;

        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
        )
        .map_err(|error| format!("IMPORT_STORE_OPEN_EXISTING:{error}"))?;
        configure(&connection)?;
        validate_schema(&connection)?;
        let store = Self {
            connection,
            base_anchor: expected_anchor.clone(),
            approved_head: approved_head.clone(),
        };
        store.verify_inventory(authenticator)?;
        Ok(store)
    }

    pub fn active_generation(&self) -> Result<u64, String> {
        self.connection
            .query_row(
                "SELECT generation FROM active_authority WHERE singleton=1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value as u64)
            .map_err(|error| format!("IMPORT_ACTIVE_GENERATION:{error}"))
    }

    pub fn activate(
        &mut self,
        verified: &VerifiedImport,
        authenticator: &dyn EvidenceAuthenticator,
    ) -> Result<ApplyOutcome, String> {
        self.activate_with_fault(verified, authenticator, TestCommitFault::None)
    }

    fn activate_with_fault(
        &mut self,
        verified: &VerifiedImport,
        authenticator: &dyn EvidenceAuthenticator,
        fault: TestCommitFault,
    ) -> Result<ApplyOutcome, String> {
        let bundle = verified.bundle();
        if !verified.trust_claim().synthetic_only
            || verified.trust_claim().chain_identity != bundle.chain_identity
            || canonical_claim(bundle).map_err(|reason| reason)? != verified.canonical_claim()
        {
            return Err("IMPORT_VERIFIED_CAPABILITY_MISMATCH".into());
        }
        authenticate_verified(verified, authenticator)?;

        // A retry must reconcile the full durable history before treating a
        // matching generation header as an already-applied operation.
        self.verify_inventory(authenticator)?;
        let active = self.active_generation()?;
        if bundle.generation == active {
            let existing: (String, Vec<u8>, Vec<u8>, String, i64) = self.connection.query_row(
                "SELECT state_root,canonical_claim,envelope,signer_identity,trust_epoch FROM authority_generations WHERE generation=?1",
                [active as i64],
                |row| Ok((row.get(0)?, row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?)),
            ).map_err(|error| format!("IMPORT_ACTIVE_IDENTITY:{error}"))?;
            if existing.0 == bundle.state_root
                && existing.1 == verified.canonical_claim()
                && existing.2 == bundle.evidence_envelope
                && existing.3 == verified.trust_claim().signer_identity
                && existing.4 == verified.trust_claim().trust_registry_epoch as i64
            {
                return Ok(ApplyOutcome::AlreadyActive);
            }
            if existing.0 == bundle.state_root && existing.1 == verified.canonical_claim() {
                return Err("IMPORT_ATTESTATION_RENEWAL_UNSUPPORTED".into());
            }
            return Err("IMPORT_ACTIVE_GENERATION_CONFLICT".into());
        }

        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("IMPORT_BEGIN:{error}"))?;
        let anchor = load_anchor(&tx)?;
        validate_structure(&anchor, bundle)
            .map_err(|error| format!("IMPORT_REVALIDATE:{error}"))?;
        if canonical_claim(bundle).map_err(|reason| reason)? != verified.canonical_claim() {
            return Err("IMPORT_CLAIM_CHANGED_DURING_ACTIVATION".into());
        }
        let last_receipt = bundle.receipts.last().ok_or("IMPORT_EMPTY_RECEIPTS")?;
        tx.execute(
            "INSERT INTO authority_generations(generation,parent_generation,parent_state_root,chain_identity,state_root,last_receipt_identity,receipt_count,obligation_count,canonical_claim,signer_identity,trust_epoch,envelope,synthetic_only) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,1)",
            params![bundle.generation as i64, bundle.parent_generation as i64, bundle.parent_state_root, bundle.chain_identity, bundle.state_root, last_receipt.identity, bundle.receipts.len() as i64, bundle.obligations.len() as i64, verified.canonical_claim(), verified.trust_claim().signer_identity, verified.trust_claim().trust_registry_epoch as i64, bundle.evidence_envelope],
        ).map_err(|error| format!("IMPORT_GENERATION_INSERT:{error}"))?;
        for (ordinal, receipt) in bundle.receipts.iter().enumerate() {
            tx.execute(
                "INSERT INTO authority_receipts(generation,ordinal,identity,parent_identity,payload) VALUES(?1,?2,?3,?4,?5)",
                params![bundle.generation as i64, ordinal as i64, receipt.identity, receipt.parent_identity, receipt.payload],
            ).map_err(|error| format!("IMPORT_RECEIPT_INSERT:{ordinal}:{error}"))?;
        }
        for (ordinal, obligation) in bundle.obligations.iter().enumerate() {
            tx.execute(
                "INSERT INTO authority_obligations(generation,ordinal,identity,state,external_identity) VALUES(?1,?2,?3,?4,?5)",
                params![bundle.generation as i64, ordinal as i64, obligation.identity, obligation.state, obligation.external_identity],
            ).map_err(|error| format!("IMPORT_OBLIGATION_INSERT:{error}"))?;
        }
        // Recheck the signed claim after all staging writes and immediately
        // before making this generation active. Operational revocation
        // serialization is unavailable in this synthetic prototype.
        authenticate_verified(verified, authenticator)?;
        let changed = tx
            .execute(
                "UPDATE active_authority SET generation=?1 WHERE singleton=1 AND generation=?2",
                params![bundle.generation as i64, bundle.parent_generation as i64],
            )
            .map_err(|error| format!("IMPORT_ACTIVATION_UPDATE:{error}"))?;
        if changed != 1 {
            return Err("IMPORT_ACTIVATION_COMPARE_AND_SWAP_FAILED".into());
        }
        if fault == TestCommitFault::BeforeCommit {
            tx.rollback()
                .map_err(|error| format!("IMPORT_INJECTED_ROLLBACK:{error}"))?;
            return Err("IMPORT_INJECTED_BEFORE_COMMIT".into());
        }
        tx.commit()
            .map_err(|error| format!("IMPORT_COMMIT_OUTCOME_UNKNOWN:{error}"))?;
        if fault == TestCommitFault::LoseAcknowledgmentAfterCommit {
            return Err("IMPORT_ACK_UNKNOWN_AFTER_COMMIT".into());
        }
        self.approved_head = ImportAnchor {
            chain_identity: bundle.chain_identity.clone(),
            generation: bundle.generation,
            state_root: bundle.state_root.clone(),
            last_receipt_identity: last_receipt.identity.clone(),
            unresolved_obligations: bundle.obligations.clone(),
        };
        self.verify_inventory(authenticator)?;
        Ok(ApplyOutcome::Activated)
    }

    fn verify_inventory(&self, authenticator: &dyn EvidenceAuthenticator) -> Result<(), String> {
        let integrity: String = self
            .connection
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|error| format!("IMPORT_INTEGRITY:{error}"))?;
        if integrity != "ok" {
            return Err(format!("IMPORT_INTEGRITY_FAILED:{integrity}"));
        }
        let mut statement = self.connection.prepare("SELECT generation,parent_generation,parent_state_root,chain_identity,state_root,last_receipt_identity,receipt_count,obligation_count,canonical_claim,signer_identity,trust_epoch,envelope,synthetic_only FROM authority_generations ORDER BY generation").map_err(|error|format!("IMPORT_GENERATIONS_PREPARE:{error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, Vec<u8>>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, i64>(10)?,
                    row.get::<_, Vec<u8>>(11)?,
                    row.get::<_, i64>(12)?,
                ))
            })
            .map_err(|error| format!("IMPORT_GENERATIONS_READ:{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("IMPORT_GENERATIONS_ROW:{error}"))?;
        let Some(base) = rows.first() else {
            return Err("IMPORT_GENERATION_HISTORY_MISSING".into());
        };
        if base.1 != 0
            || !base.2.is_empty()
            || base.6 != 0
            || base.8.len() != 0
            || base.9 != "synthetic-anchor"
            || base.10 != 1
            || base.11 != [1]
            || base.12 != 1
            || base.0 != self.base_anchor.generation as i64
            || base.3 != self.base_anchor.chain_identity
            || base.4 != self.base_anchor.state_root
            || base.5 != self.base_anchor.last_receipt_identity
        {
            return Err("IMPORT_BASE_GENERATION_INVALID".into());
        }
        let mut previous_generation = base.0;
        let mut previous_root = base.4.clone();
        let mut previous_chain = base.3.clone();
        let mut previous_receipt = base.5.clone();
        let mut previous_obligations = load_obligations(&self.connection, previous_generation)?;
        if previous_obligations.len() as i64 != base.7 {
            return Err("IMPORT_BASE_OBLIGATION_INVENTORY_INCOMPLETE".into());
        }
        if previous_obligations != self.base_anchor.unresolved_obligations {
            return Err("IMPORT_BASE_ANCHOR_OBLIGATIONS_MISMATCH".into());
        }
        for row in rows.iter().skip(1) {
            if row.0
                != previous_generation
                    .checked_add(1)
                    .ok_or("IMPORT_GENERATION_OVERFLOW")?
                || row.1 != previous_generation
                || row.2 != previous_root
                || row.3 != previous_chain
                || row.12 != 1
                || row.9.is_empty()
                || row.10 <= 0
            {
                return Err(format!("IMPORT_GENERATION_CHAIN_INVALID:{}", row.0));
            }
            let receipts = load_receipts(&self.connection, row.0)?;
            let obligations = load_obligations(&self.connection, row.0)?;
            if receipts.len() as i64 != row.6
                || obligations.len() as i64 != row.7
                || receipts.last().map(|receipt| receipt.identity.as_str()) != Some(row.5.as_str())
            {
                return Err(format!("IMPORT_INVENTORY_INCOMPLETE:{}", row.0));
            }
            let anchor = ImportAnchor {
                chain_identity: previous_chain.clone(),
                generation: previous_generation as u64,
                state_root: previous_root.clone(),
                last_receipt_identity: previous_receipt.clone(),
                unresolved_obligations: previous_obligations.clone(),
            };
            let bundle = crate::import::ImportBundle {
                schema: 1,
                chain_identity: row.3.clone(),
                generation: row.0 as u64,
                parent_generation: row.1 as u64,
                parent_state_root: row.2.clone(),
                state_root: row.4.clone(),
                receipts,
                obligations: obligations.clone(),
                evidence_envelope: row.11.clone(),
            };
            validate_structure(&anchor, &bundle)
                .map_err(|error| format!("IMPORT_REPLAY_REJECTED:{}:{error}", row.0))?;
            if canonical_claim(&bundle).map_err(|error| error)? != row.8 {
                return Err(format!("IMPORT_CANONICAL_CLAIM_MISMATCH:{}", row.0));
            }
            match authenticator.authenticate(&row.8, &row.11) {
                Authentication::Verified(claim)
                    if claim.synthetic_only
                        && claim.chain_identity == row.3
                        && claim.signer_identity == row.9
                        && claim.trust_registry_epoch == row.10 as u64
                        && claim.claim_purpose == "SYLPH_HISTORICAL_AUTHORITY_IMPORT_V1" => {}
                Authentication::Unavailable(reason) => {
                    return Err(format!("IMPORT_AUTHENTICATION_UNAVAILABLE:{reason}"));
                }
                _ => return Err(format!("IMPORT_AUTHENTICATION_INVALID:{}", row.0)),
            }
            previous_generation = row.0;
            previous_root = row.4.clone();
            previous_chain = row.3.clone();
            previous_receipt = row.5.clone();
            previous_obligations = obligations;
        }
        let active: i64 = self
            .connection
            .query_row(
                "SELECT generation FROM active_authority WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("IMPORT_ACTIVE_GENERATION:{error}"))?;
        if active != previous_generation {
            return Err("IMPORT_ACTIVE_POINTER_ROLLBACK_OR_GAP".into());
        }
        let active_rows: i64 = self
            .connection
            .query_row("SELECT COUNT(*) FROM active_authority", [], |row| {
                row.get(0)
            })
            .map_err(|error| format!("IMPORT_ACTIVE_ROW_COUNT:{error}"))?;
        if active_rows != 1 {
            return Err(format!("IMPORT_ACTIVE_ROW_COUNT_INVALID:{active_rows}"));
        }
        if previous_generation != self.approved_head.generation as i64
            || previous_chain != self.approved_head.chain_identity
            || previous_root != self.approved_head.state_root
            || previous_receipt != self.approved_head.last_receipt_identity
            || previous_obligations != self.approved_head.unresolved_obligations
        {
            return Err("IMPORT_APPROVED_HEAD_MISMATCH".into());
        }
        let foreign_key_errors: i64 = self
            .connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .map_err(|error| format!("IMPORT_FOREIGN_KEY_CHECK:{error}"))?;
        if foreign_key_errors != 0 {
            return Err(format!("IMPORT_FOREIGN_KEY_ERRORS:{foreign_key_errors}"));
        }
        Ok(())
    }
}

fn configure(connection: &Connection) -> Result<(), String> {
    if rusqlite::version() != SQLITE_VERSION {
        return Err(format!("IMPORT_SQLITE_VERSION:{}", rusqlite::version()));
    }
    let mode: String = connection
        .query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if !mode.eq_ignore_ascii_case("wal") {
        return Err("IMPORT_JOURNAL_MODE".into());
    }
    connection
        .pragma_update(None, "synchronous", "FULL")
        .map_err(|e| e.to_string())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    connection
        .pragma_update(None, "trusted_schema", "OFF")
        .map_err(|e| e.to_string())?;
    let profile:(i32,i32,i32)=connection.query_row("SELECT (SELECT synchronous FROM pragma_synchronous),(SELECT foreign_keys FROM pragma_foreign_keys),(SELECT trusted_schema FROM pragma_trusted_schema)",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(|e|format!("IMPORT_PRAGMA_VERIFY:{e}"))?;
    if profile != (2, 1, 0) {
        return Err(format!("IMPORT_PRAGMA_PROFILE:{profile:?}"));
    }
    Ok(())
}

fn validate_schema(connection: &Connection) -> Result<(), String> {
    let version: i32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if version != 1 {
        return Err("IMPORT_SCHEMA_VERSION".into());
    }
    let mut statement = connection.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").map_err(|e|e.to_string())?;
    let objects = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut expected = vec![
        ("active_authority", ACTIVE_SQL),
        ("authority_generations", GENERATIONS_SQL),
        ("authority_obligations", OBLIGATIONS_SQL),
        ("authority_receipts", RECEIPTS_SQL),
    ];
    expected.sort_by_key(|entry| entry.0);
    if objects.len() != expected.len()
        || objects
            .iter()
            .zip(expected)
            .any(|((kind, name, sql), (expected_name, expected_sql))| {
                kind != "table" || name != expected_name || sql.as_deref() != Some(expected_sql)
            })
    {
        return Err("IMPORT_SCHEMA_SEMANTICS".into());
    }
    Ok(())
}

fn authenticate_verified(
    verified: &VerifiedImport,
    authenticator: &dyn EvidenceAuthenticator,
) -> Result<(), String> {
    match authenticator.authenticate(
        verified.canonical_claim(),
        &verified.bundle().evidence_envelope,
    ) {
        Authentication::Verified(claim)
            if claim == *verified.trust_claim()
                && claim.chain_identity == verified.bundle().chain_identity
                && claim.claim_purpose == "SYLPH_HISTORICAL_AUTHORITY_IMPORT_V1"
                && claim.synthetic_only =>
        {
            Ok(())
        }
        Authentication::Unavailable(reason) => {
            Err(format!("IMPORT_AUTHENTICATION_UNAVAILABLE:{reason}"))
        }
        Authentication::Invalid(reason) => Err(format!("IMPORT_AUTHENTICATION_INVALID:{reason}")),
        _ => Err("IMPORT_AUTHENTICATION_CLAIM_CHANGED".into()),
    }
}

fn load_anchor(connection: &Connection) -> Result<ImportAnchor, String> {
    let (generation,chain_identity,state_root,last_receipt_identity):(i64,String,String,String)=connection.query_row("SELECT g.generation,g.chain_identity,g.state_root,g.last_receipt_identity FROM authority_generations g JOIN active_authority a ON a.generation=g.generation WHERE a.singleton=1",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).map_err(|e|format!("IMPORT_ANCHOR:{e}"))?;
    let mut statement=connection.prepare("SELECT identity,state,external_identity FROM authority_obligations WHERE generation=?1 ORDER BY identity").map_err(|e|e.to_string())?;
    let unresolved_obligations = statement
        .query_map([generation], |row| {
            Ok(Obligation {
                identity: row.get(0)?,
                state: row.get(1)?,
                external_identity: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(ImportAnchor {
        chain_identity,
        generation: generation as u64,
        state_root,
        last_receipt_identity,
        unresolved_obligations,
    })
}

fn load_receipts(
    connection: &Connection,
    generation: i64,
) -> Result<Vec<crate::import::ReceiptRecord>, String> {
    let mut statement=connection.prepare("SELECT ordinal,identity,parent_identity,payload FROM authority_receipts WHERE generation=?1 ORDER BY ordinal").map_err(|e|e.to_string())?;
    let values = statement
        .query_map([generation], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                crate::import::ReceiptRecord {
                    identity: row.get(1)?,
                    parent_identity: row.get(2)?,
                    payload: row.get(3)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for (expected, (ordinal, _)) in values.iter().enumerate() {
        if *ordinal != expected as i64 {
            return Err(format!(
                "IMPORT_RECEIPT_ORDINAL_GAP:{generation}:{expected}"
            ));
        }
    }
    Ok(values.into_iter().map(|(_, receipt)| receipt).collect())
}

fn load_obligations(connection: &Connection, generation: i64) -> Result<Vec<Obligation>, String> {
    let mut statement=connection.prepare("SELECT ordinal,identity,state,external_identity FROM authority_obligations WHERE generation=?1 ORDER BY ordinal").map_err(|e|e.to_string())?;
    let rows = statement
        .query_map([generation], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                Obligation {
                    identity: row.get(1)?,
                    state: row.get(2)?,
                    external_identity: row.get(3)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for (expected, (ordinal, _)) in rows.iter().enumerate() {
        if *ordinal != expected as i64 {
            return Err(format!(
                "IMPORT_OBLIGATION_ORDINAL_GAP:{generation}:{expected}"
            ));
        }
    }
    let rows = rows.into_iter().map(|(_, obligation)| obligation).collect();
    Ok(rows)
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn valid_anchor(anchor: &ImportAnchor) -> bool {
    anchor.generation > 0
        && anchor.generation <= i64::MAX as u64
        && !anchor.chain_identity.is_empty()
        && !anchor.state_root.is_empty()
        && !anchor.last_receipt_identity.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::{
        Authentication, EvidenceAuthenticator, ImportBundle, ImportKernel, ReceiptRecord,
        TrustClaim,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Authenticator {
        expected: Vec<u8>,
    }
    impl EvidenceAuthenticator for Authenticator {
        fn authenticate(&self, claim: &[u8], _envelope: &[u8]) -> Authentication {
            if claim != self.expected {
                return Authentication::Invalid("TEST_CLAIM_MISMATCH".into());
            }
            Authentication::Verified(TrustClaim {
                chain_identity: "solana-mainnet".into(),
                signer_identity: "synthetic-import-store-test".into(),
                trust_registry_epoch: 1,
                claim_purpose: "SYLPH_HISTORICAL_AUTHORITY_IMPORT_V1".into(),
                synthetic_only: true,
            })
        }
    }

    struct UnavailableAuthenticator;
    impl EvidenceAuthenticator for UnavailableAuthenticator {
        fn authenticate(&self, _claim: &[u8], _envelope: &[u8]) -> Authentication {
            Authentication::Unavailable("SYNTHETIC_TEST_AUTHORITY_UNAVAILABLE".into())
        }
    }

    fn fixture() -> (ImportAnchor, ImportBundle) {
        let anchor = ImportAnchor {
            chain_identity: "solana-mainnet".into(),
            generation: 4,
            state_root: "anchor-root".into(),
            last_receipt_identity: "receipt-4".into(),
            unresolved_obligations: vec![],
        };
        let mut bundle = ImportBundle {
            schema: 1,
            chain_identity: anchor.chain_identity.clone(),
            generation: 5,
            parent_generation: 4,
            parent_state_root: anchor.state_root.clone(),
            state_root: String::new(),
            receipts: vec![ReceiptRecord {
                identity: "receipt-5".into(),
                parent_identity: "receipt-4".into(),
                payload: b"synthetic-payload".to_vec(),
            }],
            obligations: vec![],
            evidence_envelope: b"synthetic-envelope".to_vec(),
        };
        bundle.state_root = crate::import::state_root(&bundle).unwrap();
        (anchor, bundle)
    }

    fn path(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "sylph-g1-import-{label}-{}-{nonce}.sqlite",
            std::process::id()
        ))
    }

    fn accepted(anchor: &ImportAnchor, bundle: ImportBundle) -> VerifiedImport {
        let expected = canonical_claim(&bundle).unwrap();
        let auth = Authenticator { expected };
        match ImportKernel::validate(anchor, bundle, &auth) {
            crate::import::ImportDecision::Accepted(value) => value,
            _ => panic!("synthetic store fixture did not validate"),
        }
    }

    fn approved_head(verified: &VerifiedImport) -> ImportAnchor {
        let bundle = verified.bundle();
        ImportAnchor {
            chain_identity: bundle.chain_identity.clone(),
            generation: bundle.generation,
            state_root: bundle.state_root.clone(),
            last_receipt_identity: bundle.receipts.last().unwrap().identity.clone(),
            unresolved_obligations: bundle.obligations.clone(),
        }
    }

    #[test]
    fn disk_store_rolls_back_before_commit_and_survives_reopen() {
        let path = path("rollback");
        let (anchor, bundle) = fixture();
        let verified = accepted(&anchor, bundle);
        let head = approved_head(&verified);
        let auth = Authenticator {
            expected: verified.canonical_claim().to_vec(),
        };
        let mut store = DurableImportStore::create(&path, &anchor).unwrap();
        assert!(store
            .activate_with_fault(&verified, &auth, TestCommitFault::BeforeCommit)
            .is_err());
        drop(store);
        let mut reopened =
            DurableImportStore::open_existing(&path, &anchor, &anchor, &auth).unwrap();
        assert_eq!(reopened.active_generation().unwrap(), 4);
        assert_eq!(
            reopened.activate(&verified, &auth).unwrap(),
            ApplyOutcome::Activated
        );
        drop(reopened);
        let recovered = DurableImportStore::open_existing(&path, &anchor, &head, &auth).unwrap();
        assert_eq!(recovered.active_generation().unwrap(), 5);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn lost_ack_after_commit_retries_as_exactly_once_activation() {
        let path = path("lost-ack");
        let (anchor, bundle) = fixture();
        let verified = accepted(&anchor, bundle);
        let head = approved_head(&verified);
        let auth = Authenticator {
            expected: verified.canonical_claim().to_vec(),
        };
        let mut store = DurableImportStore::create(&path, &anchor).unwrap();
        assert!(
            matches!(store.activate_with_fault(&verified, &auth, TestCommitFault::LoseAcknowledgmentAfterCommit), Err(reason) if reason == "IMPORT_ACK_UNKNOWN_AFTER_COMMIT")
        );
        drop(store);
        let mut reopened = DurableImportStore::open_existing(&path, &anchor, &head, &auth).unwrap();
        assert_eq!(
            reopened.activate(&verified, &auth).unwrap(),
            ApplyOutcome::AlreadyActive
        );
        drop(reopened);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn incomplete_receipt_inventory_and_existing_store_replacement_are_rejected() {
        let path = path("inventory");
        let (anchor, bundle) = fixture();
        let verified = accepted(&anchor, bundle);
        let head = approved_head(&verified);
        let auth = Authenticator {
            expected: verified.canonical_claim().to_vec(),
        };
        let mut store = DurableImportStore::create(&path, &anchor).unwrap();
        assert!(DurableImportStore::create(&path, &anchor).is_err());
        store.activate(&verified, &auth).unwrap();
        drop(store);
        let connection =
            Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
        connection
            .execute("DELETE FROM authority_receipts WHERE generation=5", [])
            .unwrap();
        drop(connection);
        assert!(
            matches!(DurableImportStore::open_existing(&path, &anchor, &head, &auth), Err(reason) if reason == "IMPORT_INVENTORY_INCOMPLETE:5")
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn complete_older_prefix_is_rejected_when_approved_head_is_newer() {
        let path = path("truncated-suffix");
        let (anchor, bundle) = fixture();
        let verified = accepted(&anchor, bundle);
        let head = approved_head(&verified);
        let auth = Authenticator {
            expected: verified.canonical_claim().to_vec(),
        };
        let mut store = DurableImportStore::create(&path, &anchor).unwrap();
        store.activate(&verified, &auth).unwrap();
        drop(store);
        let connection =
            Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
        connection
            .execute("DELETE FROM authority_receipts WHERE generation=5", [])
            .unwrap();
        connection
            .execute("DELETE FROM authority_obligations WHERE generation=5", [])
            .unwrap();
        connection
            .execute("DELETE FROM authority_generations WHERE generation=5", [])
            .unwrap();
        connection
            .execute(
                "UPDATE active_authority SET generation=4 WHERE singleton=1",
                [],
            )
            .unwrap();
        drop(connection);
        let before = std::fs::read(&path).unwrap();
        assert!(matches!(
            DurableImportStore::open_existing(&path, &anchor, &head, &auth),
            Err(reason) if reason == "IMPORT_APPROVED_HEAD_MISMATCH"
        ));
        assert_eq!(std::fs::read(&path).unwrap(), before);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn coordinated_receipt_and_digest_rewrite_fails_authentication_on_reopen() {
        let path = path("coordinated-mutation");
        let (anchor, bundle) = fixture();
        let verified = accepted(&anchor, bundle.clone());
        let head = approved_head(&verified);
        let auth = Authenticator {
            expected: verified.canonical_claim().to_vec(),
        };
        let mut store = DurableImportStore::create(&path, &anchor).unwrap();
        store.activate(&verified, &auth).unwrap();
        drop(store);

        let mut forged = bundle;
        forged.receipts[0].payload = b"forged-content-rehashed-by-attacker".to_vec();
        forged.state_root = crate::import::state_root(&forged).unwrap();
        let forged_claim = canonical_claim(&forged).unwrap();
        let connection =
            Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
        connection
            .execute(
                "UPDATE authority_receipts SET payload=?1 WHERE generation=5 AND ordinal=0",
                [&forged.receipts[0].payload],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE authority_generations SET state_root=?1,canonical_claim=?2 WHERE generation=5",
                params![forged.state_root, forged_claim],
            )
            .unwrap();
        drop(connection);
        assert!(matches!(
            DurableImportStore::open_existing(&path, &anchor, &head, &auth),
            Err(reason) if reason == "IMPORT_AUTHENTICATION_INVALID:5"
        ));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn missing_attester_blocks_reopen_before_writable_access() {
        let path = path("missing-attester");
        let (anchor, bundle) = fixture();
        let verified = accepted(&anchor, bundle);
        let head = approved_head(&verified);
        let auth = Authenticator {
            expected: verified.canonical_claim().to_vec(),
        };
        let mut store = DurableImportStore::create(&path, &anchor).unwrap();
        store.activate(&verified, &auth).unwrap();
        drop(store);
        let before = std::fs::read(&path).unwrap();
        assert!(matches!(
            DurableImportStore::open_existing(&path, &anchor, &head, &UnavailableAuthenticator),
            Err(reason) if reason.starts_with("IMPORT_AUTHENTICATION_UNAVAILABLE")
        ));
        assert_eq!(std::fs::read(&path).unwrap(), before);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn unexpected_schema_trigger_is_rejected_before_writable_open() {
        let path = path("schema-trigger");
        let (anchor, _) = fixture();
        let _store = DurableImportStore::create(&path, &anchor).unwrap();
        drop(_store);
        let before = std::fs::read(&path).unwrap();
        let connection =
            Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
        connection.execute_batch("CREATE TRIGGER injected AFTER INSERT ON authority_generations BEGIN SELECT 1; END;").unwrap();
        drop(connection);
        let after_injection = std::fs::read(&path).unwrap();
        assert_ne!(before, after_injection);
        assert!(matches!(
            DurableImportStore::open_existing(&path, &anchor, &anchor, &UnavailableAuthenticator),
            Err(reason) if reason == "IMPORT_SCHEMA_SEMANTICS"
        ));
        assert_eq!(std::fs::read(&path).unwrap(), after_injection);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn mismatched_expected_anchor_is_rejected_without_mutation() {
        let path = path("mismatched-anchor");
        let (anchor, _) = fixture();
        let _store = DurableImportStore::create(&path, &anchor).unwrap();
        drop(_store);
        let before = std::fs::read(&path).unwrap();
        let mut wrong = anchor.clone();
        wrong.state_root = "rollback-anchor".into();
        assert!(matches!(
            DurableImportStore::open_existing(&path, &wrong, &wrong, &UnavailableAuthenticator),
            Err(reason) if reason == "IMPORT_BASE_GENERATION_INVALID"
        ));
        assert_eq!(std::fs::read(&path).unwrap(), before);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn base_and_import_obligation_order_survives_commit_and_reopen() {
        let path = path("obligation-order");
        let (mut anchor, mut bundle) = fixture();
        let obligations = vec![
            Obligation {
                identity: "z-obligation".into(),
                state: "UNKNOWN".into(),
                external_identity: "effect-z".into(),
            },
            Obligation {
                identity: "a-obligation".into(),
                state: "PREPARED".into(),
                external_identity: "effect-a".into(),
            },
        ];
        anchor.unresolved_obligations = obligations.clone();
        bundle.obligations = obligations;
        bundle.state_root = crate::import::state_root(&bundle).unwrap();
        let verified = accepted(&anchor, bundle);
        let head = approved_head(&verified);
        let auth = Authenticator {
            expected: verified.canonical_claim().to_vec(),
        };
        let mut store = DurableImportStore::create(&path, &anchor).unwrap();
        assert_eq!(
            store.activate(&verified, &auth).unwrap(),
            ApplyOutcome::Activated
        );
        drop(store);
        let reopened = DurableImportStore::open_existing(&path, &anchor, &head, &auth).unwrap();
        assert_eq!(reopened.active_generation().unwrap(), 5);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn invalid_expected_anchor_integer_range_is_rejected_before_open() {
        let path = path("anchor-overflow");
        let (mut anchor, _) = fixture();
        anchor.generation = u64::MAX;
        assert!(matches!(
            DurableImportStore::open_existing(&path, &anchor, &anchor, &UnavailableAuthenticator),
            Err(reason) if reason == "IMPORT_STORE_EXPECTED_ANCHOR_INVALID"
        ));
        assert!(!path.exists());
    }

    #[test]
    fn mutated_base_sentinel_is_rejected_without_repairing_the_database() {
        let path = path("base-sentinel");
        let (anchor, _) = fixture();
        let store = DurableImportStore::create(&path, &anchor).unwrap();
        drop(store);
        let connection =
            Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
        connection
            .execute(
                "UPDATE authority_generations SET trust_epoch=2 WHERE generation=4",
                [],
            )
            .unwrap();
        drop(connection);
        let before = std::fs::read(&path).unwrap();
        assert!(matches!(
            DurableImportStore::open_existing(&path, &anchor, &anchor, &UnavailableAuthenticator),
            Err(reason) if reason == "IMPORT_BASE_GENERATION_INVALID"
        ));
        assert_eq!(std::fs::read(&path).unwrap(), before);
        let _ = std::fs::remove_file(path);
    }
}
