use rusqlite::config::DbConfig;
use rusqlite::limits::Limit;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};

const EXPECTED_SQLITE_VERSION: &str = "3.54.1";
const EXPECTED_SCHEMA_VERSION: i32 = 1;

pub struct Registry {
    connection: Connection,
    pub environment_class: String,
    pub version: String,
    pub sourceid: String,
    pub journal_mode: String,
    pub synchronous: i32,
    pub foreign_keys: i32,
    pub trusted_schema: i32,
    pub defensive: bool,
    pub attach_limit: i32,
    pub attach_create: bool,
    pub attach_write: bool,
    pub extension_loading_disabled: bool,
}

fn map_error(prefix: &str, error: impl std::fmt::Display) -> String {
    format!("{prefix}:{error}")
}

fn configure_connection(
    connection: &Connection,
    writable: bool,
    initialize_wal: bool,
) -> Result<(), String> {
    connection
        .set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)
        .map_err(|e| map_error("SQLITE_DEFENSIVE_ENABLE", e))?;

    // Disable ATTACH writes/creation at the SQLite connection level and set the
    // per-connection ATTACH limit to zero, which rejects all ATTACH operations.
    connection
        .set_db_config(DbConfig::SQLITE_DBCONFIG_ENABLE_ATTACH_CREATE, false)
        .map_err(|e| map_error("SQLITE_ATTACH_CREATE_DISABLE", e))?;
    connection
        .set_db_config(DbConfig::SQLITE_DBCONFIG_ENABLE_ATTACH_WRITE, false)
        .map_err(|e| map_error("SQLITE_ATTACH_WRITE_DISABLE", e))?;
    connection
        .set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0)
        .map_err(|e| map_error("SQLITE_ATTACH_LIMIT_SET", e))?;

    // No broker/client operation can enable extensions. Set both APIs to the
    // disabled state, then query SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION directly.
    connection
        .load_extension_disable()
        .map_err(|e| map_error("SQLITE_EXTENSION_DISABLE", e))?;
    let mut extension_loading_enabled = 1;
    let database = unsafe { connection.handle() };
    let set_extension_rc = unsafe {
        rusqlite::ffi::sqlite3_db_config(
            database,
            rusqlite::ffi::SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION,
            0,
            &mut extension_loading_enabled,
        )
    };
    if set_extension_rc != rusqlite::ffi::SQLITE_OK {
        return Err(format!("SQLITE_EXTENSION_CONFIG_SET_RC:{set_extension_rc}"));
    }
    let mut extension_loading_enabled = 1;
    let get_extension_rc = unsafe {
        rusqlite::ffi::sqlite3_db_config(
            database,
            rusqlite::ffi::SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION,
            -1,
            &mut extension_loading_enabled,
        )
    };
    if get_extension_rc != rusqlite::ffi::SQLITE_OK {
        return Err(format!(
            "SQLITE_EXTENSION_CONFIG_READ_RC:{get_extension_rc}"
        ));
    }

    if writable {
        if initialize_wal {
            let mode: String = connection
                .query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))
                .map_err(|e| map_error("SQLITE_JOURNAL_MODE_SET", e))?;
            if !mode.eq_ignore_ascii_case("wal") {
                return Err(format!("SQLITE_JOURNAL_MODE_MISMATCH:{mode}"));
            }
        }
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(|e| map_error("SQLITE_SYNCHRONOUS_SET", e))?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| map_error("SQLITE_FOREIGN_KEYS_SET", e))?;
    }
    connection
        .pragma_update(None, "trusted_schema", "OFF")
        .map_err(|e| map_error("SQLITE_TRUSTED_SCHEMA_SET", e))?;

    let defensive = connection
        .db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE)
        .map_err(|e| map_error("SQLITE_DEFENSIVE_READ", e))?;
    let attach_create = connection
        .db_config(DbConfig::SQLITE_DBCONFIG_ENABLE_ATTACH_CREATE)
        .map_err(|e| map_error("SQLITE_ATTACH_CREATE_READ", e))?;
    let attach_write = connection
        .db_config(DbConfig::SQLITE_DBCONFIG_ENABLE_ATTACH_WRITE)
        .map_err(|e| map_error("SQLITE_ATTACH_WRITE_READ", e))?;
    let attach_limit = connection
        .limit(Limit::SQLITE_LIMIT_ATTACHED)
        .map_err(|e| map_error("SQLITE_ATTACH_LIMIT_READ", e))?;
    let extension_probe_failed = connection
        .query_row(
            "SELECT load_extension('SYLPH_G1_DISABLED_SENTINEL')",
            [],
            |row| row.get::<_, String>(0),
        )
        .is_err();

    if !defensive
        || attach_create
        || attach_write
        || attach_limit != 0
        || extension_loading_enabled != 0
        || !extension_probe_failed
    {
        return Err(format!(
            "SQLITE_SECURITY_PROFILE_MISMATCH:defensive={defensive},attach_create={attach_create},attach_write={attach_write},attach_limit={attach_limit},extension_enabled={extension_loading_enabled},extension_probe_failed={extension_probe_failed}"
        ));
    }
    Ok(())
}

fn profile(connection: &Connection) -> Result<(String, i32, i32, i32, String), String> {
    let journal_mode = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
        .map_err(|e| map_error("SQLITE_JOURNAL_MODE_READ", e))?;
    let synchronous = connection
        .query_row("PRAGMA synchronous", [], |row| row.get::<_, i32>(0))
        .map_err(|e| map_error("SQLITE_SYNCHRONOUS_READ", e))?;
    let foreign_keys = connection
        .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i32>(0))
        .map_err(|e| map_error("SQLITE_FOREIGN_KEYS_READ", e))?;
    let trusted_schema = connection
        .query_row("PRAGMA trusted_schema", [], |row| row.get::<_, i32>(0))
        .map_err(|e| map_error("SQLITE_TRUSTED_SCHEMA_READ", e))?;
    let sourceid = connection
        .query_row("SELECT sqlite_source_id()", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| map_error("SQLITE_SOURCE_ID_READ", e))?;
    Ok((
        journal_mode,
        synchronous,
        foreign_keys,
        trusted_schema,
        sourceid,
    ))
}

impl Registry {
    /// Explicit one-time bootstrap for disposable synthetic qualification only.
    /// Atomic file creation prevents this operation from adopting an existing
    /// or attacker-substituted database object.
    pub fn initialize(path: &Path) -> Result<Self, String> {
        if has_sqlite_sidecar(path) {
            return Err("SQLITE_INITIALIZE_SIDECAR_EXISTS".into());
        }
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|e| map_error("SQLITE_INITIALIZE_CREATE_NEW", e))?;
        drop(file);
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
        )
        .map_err(|e| map_error("SQLITE_INITIALIZE_OPEN", e))?;
        if rusqlite::version() != EXPECTED_SQLITE_VERSION {
            return Err(format!(
                "SQLITE_VERSION_MISMATCH:expected={EXPECTED_SQLITE_VERSION},actual={}",
                rusqlite::version()
            ));
        }
        configure_connection(&connection, true, true)?;
        connection
            .execute_batch(
                "BEGIN IMMEDIATE;\
                 CREATE TABLE effects(\
                    request_id TEXT PRIMARY KEY NOT NULL,\
                    payload TEXT NOT NULL\
                );\
                 CREATE TABLE registry_meta(\
                    singleton INTEGER PRIMARY KEY CHECK(singleton=1),\
                    schema_version INTEGER NOT NULL CHECK(schema_version=1),\
                    environment_class TEXT NOT NULL CHECK(environment_class='SYNTHETIC_TEST_ONLY'),\
                    generation INTEGER NOT NULL CHECK(generation>=1)\
                 );\
                 INSERT INTO registry_meta(singleton,schema_version,environment_class,generation)\
                    VALUES(1,1,'SYNTHETIC_TEST_ONLY',1);\
                 PRAGMA user_version=1;\
                 COMMIT;",
            )
            .map_err(|e| map_error("SQLITE_INITIALIZE_SCHEMA", e))?;
        Self::from_connection(connection)
    }

    /// Normal service startup: open an existing initialized database only.
    /// This path never uses SQLITE_OPEN_CREATE and never creates the schema.
    pub fn open_existing(path: &Path) -> Result<Self, String> {
        if !path.is_file() {
            return Err("SQLITE_AUTHORITY_DATABASE_MISSING".into());
        }
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_FULL_MUTEX;
        let connection = Connection::open_with_flags(path, flags)
            .map_err(|e| map_error("SQLITE_OPEN_EXISTING", e))?;
        Self::validate_existing(&connection)?;
        configure_connection(&connection, true, false)?;
        Self::from_connection(connection)
    }

    fn from_connection(connection: Connection) -> Result<Self, String> {
        let (journal_mode, synchronous, foreign_keys, trusted_schema, sourceid) =
            profile(&connection)?;
        let environment_class: String = connection
            .query_row(
                "SELECT environment_class FROM registry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .map_err(|e| map_error("SQLITE_ENVIRONMENT_CLASS_READ", e))?;
        if !journal_mode.eq_ignore_ascii_case("wal")
            || synchronous != 2
            || foreign_keys != 1
            || trusted_schema != 0
        {
            return Err(format!(
                "SQLITE_PROFILE_MISMATCH:{journal_mode}/{synchronous}/{foreign_keys}/{trusted_schema}"
            ));
        }
        Ok(Self {
            connection,
            environment_class,
            version: rusqlite::version().to_string(),
            sourceid,
            journal_mode,
            synchronous,
            foreign_keys,
            trusted_schema,
            defensive: true,
            attach_limit: 0,
            attach_create: false,
            attach_write: false,
            extension_loading_disabled: true,
        })
    }

    fn validate_existing(connection: &Connection) -> Result<(), String> {
        let version: i32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|e| map_error("SQLITE_SCHEMA_VERSION_READ", e))?;
        if version != EXPECTED_SCHEMA_VERSION {
            return Err(format!("SQLITE_SCHEMA_VERSION_MISMATCH:{version}"));
        }
        let schema_object_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| map_error("SQLITE_SCHEMA_INVENTORY", e))?;
        if schema_object_count != 2 {
            return Err(format!("SQLITE_SCHEMA_OBJECT_COUNT:{schema_object_count}"));
        }
        let effects_sql: Option<String> = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='effects'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| map_error("SQLITE_EFFECTS_SCHEMA", e))?;
        let expected_effects_sql =
            "CREATE TABLE effects(request_id TEXT PRIMARY KEY NOT NULL,payload TEXT NOT NULL)";
        match effects_sql {
            None => return Err("SQLITE_EFFECTS_TABLE_MISSING".into()),
            Some(actual) if actual != expected_effects_sql => {
                return Err("SQLITE_EFFECTS_SCHEMA_SEMANTICS_MISMATCH".into())
            }
            Some(_) => {}
        }
        let meta_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='registry_meta'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| map_error("SQLITE_META_SCHEMA", e))?;
        if meta_table_count != 1 {
            return Err("SQLITE_REGISTRY_META_TABLE_MISSING".into());
        }
        let meta_sql: String = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='registry_meta'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| map_error("SQLITE_META_SCHEMA_SQL_READ", e))?;
        let expected_meta_sql = "CREATE TABLE registry_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_version INTEGER NOT NULL CHECK(schema_version=1),environment_class TEXT NOT NULL CHECK(environment_class='SYNTHETIC_TEST_ONLY'),generation INTEGER NOT NULL CHECK(generation>=1))";
        // Exact source spelling is intentional: normalizing the entire SQL
        // would also normalize string literals and could accept a changed
        // CHECK value. This schema is created by our own fixed bootstrap SQL.
        if meta_sql != expected_meta_sql {
            return Err("SQLITE_REGISTRY_META_CONSTRAINTS_MISMATCH".into());
        }
        let mut meta_columns = connection
            .prepare("PRAGMA table_info(registry_meta)")
            .map_err(|e| map_error("SQLITE_META_COLUMNS_PREPARE", e))?;
        let actual_meta_columns = meta_columns
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i32>(3)?,
                    row.get::<_, i32>(5)?,
                ))
            })
            .map_err(|e| map_error("SQLITE_META_COLUMNS_READ", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| map_error("SQLITE_META_COLUMNS_ROW", e))?;
        if actual_meta_columns
            != vec![
                ("singleton".into(), "INTEGER".into(), 0, 1),
                ("schema_version".into(), "INTEGER".into(), 1, 0),
                ("environment_class".into(), "TEXT".into(), 1, 0),
                ("generation".into(), "INTEGER".into(), 1, 0),
            ]
        {
            return Err(format!(
                "SQLITE_REGISTRY_META_COLUMNS_MISMATCH:{actual_meta_columns:?}"
            ));
        }
        let metadata_rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM registry_meta", [], |row| row.get(0))
            .map_err(|e| map_error("SQLITE_REGISTRY_METADATA_COUNT", e))?;
        if metadata_rows != 1 {
            return Err(format!(
                "SQLITE_REGISTRY_METADATA_ROW_COUNT:{metadata_rows}"
            ));
        }
        let metadata: (i32, String, i64) = connection
            .query_row(
                "SELECT schema_version,environment_class,generation FROM registry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|e| map_error("SQLITE_REGISTRY_METADATA_READ", e))?;
        if metadata.0 != EXPECTED_SCHEMA_VERSION
            || metadata.1 != "SYNTHETIC_TEST_ONLY"
            || metadata.2 < 1
        {
            return Err(format!("SQLITE_REGISTRY_METADATA_INVALID:{metadata:?}"));
        }
        let mut columns = connection
            .prepare("PRAGMA table_info(effects)")
            .map_err(|e| map_error("SQLITE_EFFECTS_COLUMNS_PREPARE", e))?;
        let actual_columns = columns
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i32>(3)?,
                    row.get::<_, i32>(5)?,
                ))
            })
            .map_err(|e| map_error("SQLITE_EFFECTS_COLUMNS_READ", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| map_error("SQLITE_EFFECTS_COLUMNS_ROW", e))?;
        if actual_columns
            != vec![
                ("request_id".into(), "TEXT".into(), 1, 1),
                ("payload".into(), "TEXT".into(), 1, 0),
            ]
        {
            return Err(format!(
                "SQLITE_EFFECTS_COLUMNS_MISMATCH:{actual_columns:?}"
            ));
        }
        let integrity: String = connection
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|e| map_error("SQLITE_OPEN_INTEGRITY", e))?;
        if integrity != "ok" {
            return Err(format!("SQLITE_OPEN_INTEGRITY_FAILED:{integrity}"));
        }
        Ok(())
    }

    pub fn count(&self) -> Result<i64, String> {
        self.connection
            .query_row("SELECT COUNT(*) FROM effects", [], |row| row.get(0))
            .map_err(|e| map_error("SQLITE_COUNT", e))
    }

    pub fn append(&self, request_id: &str, payload: &str) -> Result<bool, String> {
        if !valid_request_id(request_id) {
            return Err("REQUEST_ID_INVALID".into());
        }
        if !valid_payload(payload) {
            return Err("PAYLOAD_INVALID".into());
        }
        let changed = self
            .connection
            .execute(
                "INSERT OR IGNORE INTO effects(request_id,payload) VALUES(?1,?2)",
                params![request_id, payload],
            )
            .map_err(|e| map_error("SQLITE_INSERT", e))?;
        if changed > 0 {
            return Ok(true);
        }
        let existing = self
            .connection
            .query_row(
                "SELECT payload FROM effects WHERE request_id=?1",
                params![request_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| map_error("SQLITE_DUPLICATE_CHECK", e))?;
        match existing {
            Some(value) if value == payload => Ok(false),
            _ => Err("REQUEST_ID_CONFLICT".into()),
        }
    }

    pub fn check_integrity(&self) -> Result<String, String> {
        self.connection
            .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
            .map_err(|e| map_error("SQLITE_INTEGRITY", e))
    }
}

pub fn inspect_readonly(path: &Path) -> Result<String, String> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_FULL_MUTEX;
    let connection = Connection::open_with_flags(path, flags)
        .map_err(|e| map_error("SQLITE_READONLY_OPEN", e))?;
    if rusqlite::version() != EXPECTED_SQLITE_VERSION {
        return Err(format!(
            "SQLITE_VERSION_MISMATCH:expected={EXPECTED_SQLITE_VERSION},actual={}",
            rusqlite::version()
        ));
    }
    configure_connection(&connection, false, false)?;
    let integrity = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .map_err(|e| map_error("SQLITE_INTEGRITY", e))?;
    let effect_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM effects", [], |row| row.get(0))
        .map_err(|e| map_error("SQLITE_COUNT", e))?;
    let (journal_mode, synchronous, foreign_keys, trusted_schema, sourceid) = profile(&connection)?;
    Ok(format!(
        "{{\"schema\":\"SYLPH_G1_SQLITE_READONLY_1\",\"integrity\":\"{integrity}\",\"effectCount\":{effect_count},\"sqliteVersion\":\"{}\",\"sqliteSourceId\":\"{sourceid}\",\"pragmas\":{{\"journalMode\":\"{journal_mode}\",\"synchronous\":{synchronous},\"foreignKeys\":{foreign_keys},\"trustedSchema\":{trusted_schema}}}}}",
        rusqlite::version()
    ))
}

fn has_sqlite_sidecar(path: &Path) -> bool {
    ["-wal", "-shm", "-journal"].iter().any(|suffix| {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        PathBuf::from(name).exists()
    })
}

fn valid_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn valid_payload(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value.bytes().all(|b| b.is_ascii_graphic() || b == b' ')
}

#[cfg(test)]
mod tests {
    use super::{valid_payload, valid_request_id, Registry};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn test_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "sylph-g1-rusqlite-{}-{}.db",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn cleanup(path: &std::path::Path) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn request_id_and_payload_validation_is_bounded() {
        assert!(valid_request_id("request_01-A"));
        assert!(!valid_request_id(""));
        assert!(!valid_request_id("bad/path"));
        assert!(!valid_request_id(&"x".repeat(65)));
        assert!(valid_payload("synthetic event 1"));
        assert!(!valid_payload(""));
        assert!(!valid_payload("control\nbyte"));
        assert!(!valid_payload(&"x".repeat(513)));
    }

    #[test]
    fn bundled_sqlite_profile_and_request_idempotency_are_checked() {
        let path = test_path();
        let registry = Registry::initialize(&path).expect("explicit registry initialization");
        assert_eq!(registry.version, "3.54.1");
        assert_eq!(registry.environment_class, "SYNTHETIC_TEST_ONLY");
        assert!(!registry.sourceid.is_empty());
        assert_eq!(registry.journal_mode.to_ascii_lowercase(), "wal");
        assert_eq!(registry.synchronous, 2);
        assert_eq!(registry.foreign_keys, 1);
        assert_eq!(registry.trusted_schema, 0);
        assert!(registry.defensive);
        assert_eq!(registry.attach_limit, 0);
        assert!(!registry.attach_create);
        assert!(!registry.attach_write);
        assert!(registry.extension_loading_disabled);
        assert!(registry.append("req-1", "one").unwrap());
        assert!(!registry.append("req-1", "one").unwrap());
        assert!(registry.append("req-1", "different").is_err());
        assert_eq!(registry.count().unwrap(), 1);
        assert!(registry
            .connection
            .execute_batch("ATTACH DATABASE ':memory:' AS denied")
            .is_err());
        drop(registry);
        cleanup(&path);
    }

    #[test]
    fn normal_open_rejects_missing_database_without_creating_it() {
        let path = test_path();
        assert!(!path.exists());
        assert!(Registry::open_existing(&path).is_err());
        assert!(
            !path.exists(),
            "normal service open created an empty database"
        );
        cleanup(&path);
    }

    #[test]
    fn normal_open_rejects_uninitialized_database_without_schema_changes() {
        let path = test_path();
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute_batch("CREATE TABLE unrelated(value TEXT)")
            .unwrap();
        drop(connection);
        let before = std::fs::read(&path).unwrap();
        assert!(Registry::open_existing(&path).is_err());
        let after = std::fs::read(&path).unwrap();
        assert_eq!(before, after, "rejected schema was modified");
        cleanup(&path);
    }

    #[test]
    fn normal_open_rejects_metadata_schema_without_required_constraints_unchanged() {
        let path = test_path();
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection.execute_batch(
            "CREATE TABLE effects(request_id TEXT PRIMARY KEY NOT NULL,payload TEXT NOT NULL);\
             CREATE TABLE registry_meta(singleton INTEGER PRIMARY KEY,schema_version INTEGER NOT NULL,\
                environment_class TEXT NOT NULL,generation INTEGER NOT NULL);\
             INSERT INTO registry_meta VALUES(1,1,'SYNTHETIC_TEST_ONLY',1);\
             PRAGMA user_version=1;",
        ).unwrap();
        drop(connection);
        let before = std::fs::read(&path).unwrap();
        assert!(
            matches!(Registry::open_existing(&path), Err(reason) if reason == "SQLITE_REGISTRY_META_CONSTRAINTS_MISMATCH")
        );
        assert_eq!(
            before,
            std::fs::read(&path).unwrap(),
            "rejected metadata schema was modified"
        );
        cleanup(&path);
    }

    #[test]
    fn normal_open_rejects_changed_check_literal_even_when_row_is_valid_under_expected_value() {
        let path = test_path();
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "PRAGMA ignore_check_constraints=ON;\
             CREATE TABLE effects(request_id TEXT PRIMARY KEY NOT NULL,payload TEXT NOT NULL);\
             CREATE TABLE registry_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),\
                schema_version INTEGER NOT NULL CHECK(schema_version=1),\
                environment_class TEXT NOT NULL CHECK(environment_class='synthetic_test_only'),\
                generation INTEGER NOT NULL CHECK(generation>=1));\
             INSERT INTO registry_meta VALUES(1,1,'SYNTHETIC_TEST_ONLY',1);\
             PRAGMA user_version=1;",
            )
            .unwrap();
        drop(connection);
        let before = std::fs::read(&path).unwrap();
        assert!(
            matches!(Registry::open_existing(&path), Err(reason) if reason == "SQLITE_REGISTRY_META_CONSTRAINTS_MISMATCH")
        );
        assert_eq!(
            before,
            std::fs::read(&path).unwrap(),
            "rejected metadata schema was modified"
        );
        cleanup(&path);
    }

    #[test]
    fn normal_open_rejects_deduplication_collation_change_unchanged() {
        let path = test_path();
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection.execute_batch(
            "CREATE TABLE effects(request_id TEXT COLLATE NOCASE PRIMARY KEY NOT NULL,payload TEXT NOT NULL);\
             CREATE TABLE registry_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),\
                schema_version INTEGER NOT NULL CHECK(schema_version=1),\
                environment_class TEXT NOT NULL CHECK(environment_class='SYNTHETIC_TEST_ONLY'),\
                generation INTEGER NOT NULL CHECK(generation>=1));\
             INSERT INTO registry_meta VALUES(1,1,'SYNTHETIC_TEST_ONLY',1);\
             PRAGMA user_version=1;",
        ).unwrap();
        drop(connection);
        let before = std::fs::read(&path).unwrap();
        assert!(
            matches!(Registry::open_existing(&path), Err(reason) if reason == "SQLITE_EFFECTS_SCHEMA_SEMANTICS_MISMATCH")
        );
        assert_eq!(
            before,
            std::fs::read(&path).unwrap(),
            "rejected effects schema was modified"
        );
        cleanup(&path);
    }

    #[test]
    fn initialization_refuses_existing_or_sidecar_state() {
        let path = test_path();
        std::fs::write(&path, b"synthetic existing evidence").unwrap();
        let before = std::fs::read(&path).unwrap();
        assert!(Registry::initialize(&path).is_err());
        assert_eq!(before, std::fs::read(&path).unwrap());
        cleanup(&path);
    }
}
