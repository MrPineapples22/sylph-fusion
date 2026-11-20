# G1-V6.4 Rust broker prototype

This isolated prototype builds four Windows executables: `g1-broker.exe`, `g1-client.exe`, `g1-attacker.exe`, and `g1-verifier.exe`. It is synthetic-only and is not qualified for G1, production, wallet, or trading use.

## Build and local checks

With the pinned Rust 1.89.0 toolchain and the `x86_64-pc-windows-msvc` target installed:

```powershell
cargo fmt --check
cargo generate-lockfile
cargo test --target x86_64-pc-windows-msvc
cargo build --release --target x86_64-pc-windows-msvc --bins
```

The first networked Windows CI run must upload the generated `Cargo.lock` as an artifact for review. After that exact lockfile is incorporated into the candidate, use `cargo test --locked` and `cargo build --locked` in all subsequent reproductions. Release executables are under `target\x86_64-pc-windows-msvc\release`.

## Windows service contract

Provision the service externally in a disposable administrative test environment. The broker accepts only either LocalService with its service SID verified in the token's normal and restricted SID lists, or the exact `NT SERVICE\SylphG1Broker` virtual-account SID with that service SID verified in both lists. Configure the service SID as restricted (`sc.exe sidtype SylphG1Broker restricted`). The binary expects:

```text
g1-broker.exe --service-name SylphG1Broker --data-dir <absolute-existing-directory> --client-sid <authorized-standard-user-SID>
```

The service emits its process ID, selected identity mode, user SID, service SID, normal/restricted SID membership, integrity RID, privilege counts, and each privilege name/attribute in `broker-token.json`. Its process identity diagnostic also includes its process ID and the same privilege list, allowing an external runner to compare it with the launched PID. It creates `registry.sqlite` and `broker-token.json` beneath the configured directory. At each run start it removes stale `broker-ready.json` (failure other than NotFound aborts startup). It publishes a create-new readiness record only after the first `CreateNamedPipe` succeeds with `FILE_FLAG_FIRST_PIPE_INSTANCE`; the record includes process ID, a per-start nonce, service name, and pipe name. The broker does not adopt an existing database. Its fixed pipe is `\\.\pipe\SylphG1Broker`. The server reads one size-bounded message before impersonating the writer, checks the client SID, reverts before dispatch, and stops if reverting fails. The client independently obtains the named-pipe server PID and checks that process token against the expected restricted service identity before sending a request.

Client commands are `g1-client.exe status`, `g1-client.exe write <request-id> <payload>`, and `g1-client.exe forbidden`. Only the fixed test write is supported; SQL and paths are never accepted over IPC. The attacker has `identity`, `read <synthetic-db-path>`, `write <synthetic-db-path>`, `pipe-server`, `pipe-server-hold <ready-file> <release-file>`, and `forbidden` commands. The read-only probe requests exactly `GENERIC_READ` and reports its access mask, Win32 error, caller SID, and PID. `pipe-server` reports caller SID/PID, requestedOpenMode, result, and Win32 error. The bounded hold mode creates a synthetic first pipe instance, writes an initial caller/SID/PID readiness record, accepts one client connection within 15 seconds, then records the connected client PID, `PeekNamedPipe` byte count, and one-byte nonblocking `ReadFile` outcome before waiting at most 120 seconds for a release marker. The expected result is `CONNECTED_ZERO_REQUEST_BYTES` with a client PID, zero peek bytes, and `ERROR_NO_DATA` from the read attempt. It never dispatches request bytes. The CI harness should require the legitimate client to report server-identity rejection before sending any request and compare the recorded process identity with the temporary standard-user token. The verifier supports `process`, `identity <path>`, `same <left> <right>`, `different <left> <right>`, and read-only `sqlite <path>` inspection.

When explicitly built with the `synthetic-maintenance` feature, the broker has a separate optional test-only endpoint enabled by the `--synthetic-maintenance-client-sid` service argument. It uses a distinct named pipe, client SID, operation lock, and `synthetic-maintenance-data/synthetic-import.sqlite`; it receives no normal `Registry` reference and does not publish or modify readiness. The feature-enabled `g1-client synthetic-import` and `g1-synthetic-maintenance.exe` read one bounded binary frame from stdin, verify the server process, and connect to that pipe. They are clients only; the broker owns all non-test writes. The pipe payload limit is 900 bytes, so this is tiny-fixture-only and cannot carry historical receipts. It reports only `SYNTHETIC_TEST_ONLY`. See [SYNTHETIC-MAINTENANCE.md](SYNTHETIC-MAINTENANCE.md); no operational trust or G1 qualification is implied.

Named-pipe ACLs apply to a pipe object while an instance exists; they do not reserve the pipe name when the broker is stopped. Therefore a stopped-service attempt may create a same-name pipe and cause name-squatting denial of service. Such a result is not an ACL bypass into broker authority, but it also cannot be reported as stopped-state ACL denial. The current prototype has no separate protected activation/namespace mechanism to prevent this case; classify the stopped-state requirement as blocked unless CI demonstrates an independently reviewed mechanism.

## Explicit limits

This is a bounded prototype, not a security boundary qualification. SQLite is specified through exact rusqlite 0.42.0 with its bundled SQLite 3.54.1 source and a Rust 1.89.0 toolchain. At the initial authoring pass, crates.io TLS failed in the local account, so the lockfile and compilation must be established on the approved disposable Windows CI runner. Startup verifies the built SQLite version string and records the runtime SQLite source ID; the source ID still requires evidence review and is not automatically accepted as trusted. The broker enables and verifies SQLite defensive mode, disables ATTACH writes/creation and extension loading, sets the attached-database limit to zero, and verifies required PRAGMAs. The new IPC and identity code is still uncompiled and unexecuted pending the runner lock/build. LocalService or virtual-account provisioning, service SID/ACL provisioning, hard-link denial, same-user isolation, token correctness, handle protections, SCM configuration, and actual named-pipe access controls require independent execution on the disposable Windows CI runner. No robust ACL verification, durable ownership epochs, operation ledger, authorization quorum, recovery protocol, arbitrary storage preflight, migration handling, VFS fault injection, or P02/P10/P12/P15/P16/Alpha qualification is implemented here. The current report files are diagnostics, not proof that the configured directory ACL is protected.

The service code deliberately stops if service identity checks fail, but until a real Windows run verifies the SCM setup and the access-control tests, the broker must remain unavailable for operational use. A successful compile or unit test is not G1 approval.
