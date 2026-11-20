# SQLite broker acceptance checks (scratch only)

This plan is a test contract. No results are claimed until an actual Windows run records them.

## Runtime identity and actual connection settings

At startup, the broker must record `sqlite_version()`, `sqlite_source_id()`, compile options, and the results read back from the same connection that handles requests. Required profile for this broker experiment:

| Setting | Required observed value |
|---|---|
| `PRAGMA journal_mode` | `wal` |
| `PRAGMA synchronous` | integer `2` (`FULL`) |
| `PRAGMA foreign_keys` | integer `1` |
| `PRAGMA trusted_schema` | integer `0` |

The test must compare returned values, not only verify that PRAGMA statements were issued. Capture the exact SQLite source ID and version per runner. A version number alone does not establish that the binary includes a particular WAL fix; record the source ID and dependency/build identity for independent review.

## Scratch database behavior

Use a new runner-local scratch directory for each case. Confirm `PRAGMA integrity_check` is exactly `ok` before and after. Submit only a fixed, typed broker operation; then verify the expected row through the broker's read API and verify idempotent retry returns the original receipt without creating a second effect. Do not offer arbitrary SQL to a client.

Keep two separate cases:

1. **Broker path:** an authenticated request reaches the service-owned connection and a fixed synthetic write succeeds.
2. **Direct-access control:** the ordinary test account attempts an authorized-write open against the protected DB and sidecars. Pass requires a verified attacker token and actual `ERROR_ACCESS_DENIED`; `ERROR_SHARING_VIOLATION` is not an ACL pass. The unprotected synthetic control must still be writable so the test proves its access request is effective.

SQLite profile success and OS access denial are separate results. A successful broker transaction cannot establish filesystem isolation.

## WAL, sidecars and lifecycle

After a committed write, enumerate the main database, `-wal`, `-shm`, temporary, backup and checkpoint files. Capture names, sizes, SHA-256, volume serial and file indices where available. While the service is active and stopped, attempt direct access from the verified standard attacker token. Do not infer protection from a lock or sharing violation.

Exercise an authorized checkpoint, interruption during checkpoint, clean close, and restart. After every case, query through the broker, run `integrity_check`, compare durable request identities, and record whether a WAL/SHM file was present or removed. If an operation has an uncertain commit result, represent it as `UNKNOWN` and query by the same request ID after restart; do not silently retry as a new operation.

## Crash and acknowledgment ambiguity

Use deterministic test hooks placed at documented boundaries: before transaction, after operation intent, before COMMIT, after COMMIT returns, and after durable commit but before response delivery. The test must distinguish a failed/rolled-back transaction from a committed operation whose response was lost. Restart the service and retry the same request ID and payload digest. Assert either one original receipt/effect or a fail-closed quarantine. Never infer outcome from the client error alone.

Process termination is not a substitute for VFS-level `xWrite`/`xSync` fault injection and is not proof that outstanding OS I/O was drained. If the Windows runner cannot inject a genuine SQLite VFS failure, record that case as `BLOCKED`.

## Result labels

Every check is `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, or `INVALID_TEST`. Record the OS/build, runner image, caller SID/integrity, service SID/account, SQLite version/source ID, exact access result, process and binary hashes, pre/post state, and log path. A test using the wrong identity, failing to hit its injection point, or omitting persisted-state checks is `INVALID_TEST`, not PASS.

## Scope limitation

This file describes synthetic tests only. It does not establish service authorization, path isolation, WAL durability, finality, production trust, or G1 qualification by itself.

## Current PoC coverage and unqualified cases

The companion PowerShell harness checks the broker-reported live connection profile, runtime identity, fixed authorized write, identical retry, conflicting duplicate request ID, forbidden IPC operation, direct writable-open behavior through the original path and an optional pre-existing alias, and read-only `integrity_check` plus effect count. It must be run under the ordinary caller's actual Windows token on the authorized disposable Windows runner. A denied direct open qualifies only when the attacker token is confirmed and the observed result is exactly `ACCESS_DENIED|win32=5`; code 32 (`ERROR_SHARING_VIOLATION`) is a failure of the access-control assertion.

The current PoC uses the host's `winsqlite3.dll` dynamically. Until an approved SQLite source identity/runtime is pinned, runtime identity is BLOCKED even if version/source ID are recorded. The current broker interface has no controlled COMMIT fault hook, VFS injection point, backup/restore, migration, or WAL checkpoint fault command. Accordingly, actual SQLite/VFS crash-before-commit, commit-in-progress, durable-commit/lost-ack, synchronization-failure, and sidecar ACL scenarios are BLOCKED / NOT_RUN; process termination or successful integrity checks cannot substitute. Sidecar visibility in an inventory does not establish unauthorized denial. No result from this harness alone proves Windows service identity, general filesystem isolation, or production security.

| Check | Required evidence | Current disposition |
|---|---|---|
| Connection profile | Runtime readback: WAL, synchronous=2/FULL, foreign_keys=1, trusted_schema=0 | Pending actual Windows service run |
| SQLite runtime | Approved runtime version and source ID match | BLOCKED: dynamic system `winsqlite3.dll`, no approved source identity |
| Normal durable write/retry | New ID inserted, identical retry duplicate, conflicting same-ID payload rejected, one effect after read-only verification | Pending actual Windows service run |
| Direct protected DB/alias access | Actual standard-user SID; CreateFile generic read/write with share-all; exact Win32 access denied | Pending actual Windows service run; alias optional until CI creates it |
| Sidecar isolation | WAL/SHM path and file identity, attacker access-denial result | BLOCKED: no dedicated sidecar attacker check yet |
| Crash / commit ambiguity | Genuine VFS boundary failpoint and reopen/replay state | BLOCKED: no VFS/COMMIT failpoint in current PoC |
| Checkpoint / backup / migration | Deterministic fault and recovered-state evidence | BLOCKED: no implemented harness interface |

The harness exit code `0` only means it did not observe a FAIL result; reports with BLOCKED or NOT_RUN cases are labelled `PARTIAL_BLOCKED`, never G1 PASS.
