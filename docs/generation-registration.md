# Local SQLite initial-generation registration

This is an isolated storage facility on the existing `Store`. It claims one initial
identity in the Store database's existing `signing_intents` namespace. It is not
connected to Fusion, a coordinator, signer, submission, or capital reservation.
It does not approve a live trading deployment.

`registerInitialGeneration({intentId, registrationRequestId, intentSha256})` commits
generation 1, state REGISTERED, and a worker timestamp before acknowledging CREATED.
An exact repeat returns ALREADY_REGISTERED and the original timestamp. A different
request or digest for that intent conflicts. A request ID already bound to another
intent conflicts. Legacy signing rows remain blocking tombstones, including old
PREPARED and SIGNED rows; this API does not interpret them as settled or releasable.

The digest is supplied by the caller. It is a binding, not evidence of canonical
economics, verified chain truth, or permission. `readGenerationIdentity` returns a
bounded observation. MISSING, an exception, a timeout, or a lost acknowledgement
never permits signing or another external side effect. After uncertain acknowledgement,
reopen the same database, inspect the same identity, and retry the **same** request
if necessary. Do not generate a replacement request or economic intent to work
around an error. Registration has no advance, reset, deletion, release, or fallback.

## Runtime and storage eligibility

The embedded SQLite version is probed in memory before opening a configured target.
Eligible versions are 3.51.3 or later, plus the explicit fixed backports 3.44.6 and
3.50.7. Canonical three-component numeric versions are required. Node >=24 alone
does not prove this eligibility. The target connection's runtime must agree with
the probe. This gate addresses the SQLite WAL-reset defect; it does not certify
future runtimes or arbitrary storage hardware.

Registration requires a file-backed connection with WAL and synchronous FULL.
Existing in-memory Store save/load operations work, but registration is refused.
Connection busy handling is finite. Concurrent initial WAL conversion can return
BUSY immediately, so that setup step alone retries within a five-second deadline.
Registration itself uses one BEGIN IMMEDIATE transaction and has no application
retry loop. BUSY is an error, never an in-memory fallback.

The supported persistence boundary is local, same-host access to the same physical
file on storage honoring SQLite locking and synchronization. Network/sync-mounted
storage, independently copied databases, different DB_PATH values, backup rollback,
hostile SQL or filesystem access, and device power-loss behavior are not verified.
Direct UPDATE/DELETE/kind-change guards narrow accidental mutation; arbitrary SQL
REPLACE can bypass delete triggers when recursive triggers are disabled. Supported
Store registration/signing APIs never use REPLACE for identity records.

## Upgrade procedure before any real database rollout

No real database rollout is part of authoring or fixture verification. Upgraded
Store initialization migrates a recognized version-0 schema automatically; therefore
complete this procedure **before starting any upgraded process against a real DB**.

1. Identify the exact local database, its owners, and all processes using it. Quiesce
   all writers and stop automatic restarts. Preserve the current binary for recovery.
2. With the pre-upgrade maintenance binary or a separately reviewed SQLite maintenance
   tool, create a SQLite-consistent backup using VACUUM INTO or SQLite backup. The
   existing pre-upgrade `Store.backup(destination)` uses VACUUM INTO. Select an explicit
   new destination; do not overwrite any file or copy only an open main DB without
   its WAL. Fixture backups do not substitute for the actual operator backup.
3. Open the backup independently and verify integrity, schema version, complete
   signing rows (including NULLs/unusual historical keys), and unrelated business
   tables. Record its source and quiescent time. Protect the verified backup.
4. Independently review the migration and verification evidence and select one backend.
   Start the reviewed upgrade under quiescence. Version 0 rebuilds the recognized
   signing table atomically, copies original columns verbatim, checks both directions
   and row counts, installs constraints/triggers, validates integrity, and sets
   user_version=1. Version 1 verifies the exact identity schema on reopen. Unknown
   versions, modified signing definitions, incoming foreign keys, custom indexes on
   the signing table, views/triggers, or staging-name collisions fail closed.
   Unrelated tables and their indexes are preserved. User objects with names such
   as sqliteXchild are included in dependency checks; only the literal reserved
   sqlite_ prefix is excluded. Refusal leaves schema/rows unchanged; WAL conversion
   may already have changed journal mode.
5. Confirm all old rows remain tombstones, unrelated records remain intact, and
   ordinary Store operations pass. A separate release decision is still required for
   any future consumer. This API itself never enables live execution.

After a failure, preserve the original database and associated WAL. Do not restore
a stale backup over identities committed after it. Recovery must retain the latest
authoritative identity history; ambiguous history requires reconciliation rather
than resets. No migration from existing JSON/Map prototypes is included. Their
identities need a separately reviewed tombstone migration before later composition.

## Errors and verification limits

Stable codes: INVALID_REGISTRATION, IDENTITY_CONFLICT, REQUEST_ID_CONFLICT,
LEGACY_INTENT_BLOCKED, REGISTRATION_STORAGE_UNSUPPORTED, SQLITE_RUNTIME_UNSUPPORTED,
SCHEMA_UNSUPPORTED, STORAGE_BUSY, STORAGE_FAILURE, STORAGE_INVARIANT_FAILURE, and
STORAGE_OUTCOME_UNKNOWN. SQLite diagnostic codes are bounded numeric values; new
registration errors do not return arbitrary SQL or user data. Unexpected constraints
are invariant failures, never successful idempotency. Failure to establish rollback
poisons the connection and preserves the original cause internally.

Tests use owned temporary databases and child processes with bounded barriers. They
exercise public Store races, concurrent initialization, legacy cross-path races,
deterministic migration/registration process death, lost acknowledgement recovery,
busy handling, version gates, schema refusal, validation/SQL constraints, and
injected COMMIT/ROLLBACK failures. These are process and behavior tests, not physical
power-loss or hostile-tamper certification. PostgreSQL production authority, durable
capital/signing/submission lifecycle, simulation composition, restart reconciliation,
and settlement proof remain separate work.
