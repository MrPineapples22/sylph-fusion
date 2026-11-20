# Local compile and regression record — G1 v6.4

Date: 2026-11-19 (America/Phoenix)
Host: Windows 10.0.19045 x64; account `DESKTOP-TOULNBM\codexsandboxoffline`; SID `S-1-5-21-1493479061-3366213732-219378630-1009`; medium integrity; non-administrator.

## Earlier prototype build (superseded source)

Before the SQLite dependency was pinned, the no-dependency Rust prototype passed:

- `cargo fmt --check --manifest-path G1-V6.4\broker\Cargo.toml` — PASS.
- `cargo test --offline --locked --manifest-path G1-V6.4\broker\Cargo.toml --target x86_64-pc-windows-msvc -- --test-threads=1` — PASS, 2 tests in each of four binary harnesses (8 executions).
- `cargo build --offline --locked --release --bins --manifest-path G1-V6.4\broker\Cargo.toml --target x86_64-pc-windows-msvc` — PASS.

These results do not apply to the current bundled-SQLite revision; the prior build fingerprint had no dependency artifacts.

## Current source checks

- `cargo +stable fmt --manifest-path G1-V6.4\broker\Cargo.toml -- --check` — PASS (latest Rust source formatting only).
- PowerShell AST parsing — PASS for all three CI/SQLite PowerShell scripts after the current edits.
- `node --check` — PASS for every `verification/ci-preflight/*.mjs` helper.
- `cargo +stable check --workspace --bins --offline --manifest-path G1-V6.4\broker\Cargo.toml` — BLOCKED before Rust type-checking: `no matching package named rusqlite found` in the offline cache. The local account’s earlier Cargo fetch failed at crates.io with Schannel `SEC_E_NO_CREDENTIALS (0x8009030E)`.
- Current `rusqlite 0.42.0` / bundled SQLite 3.54.1 revision has not compiled or executed. A disposable hosted Windows run is required to resolve dependencies and create the first Cargo.lock; after preserving that exact lock, the workflow must switch to `--locked` and repeat build/test.

## Not run on authoring host

Service installation/start, temporary-user provisioning, NTFS hard-link/ACL tests, pipe identity/authorization, SQLite runtime profile, direct-access denial, broker alias checks, process-token checks, and SQLite fault cases are NOT_RUN. The host account is non-administrator and its earlier SCM attempt returned Win32 error 5. No local service installation is attempted.

The matrix in `mandatory-requirements.csv` is copied from the frozen G1 v6.1 authoritative baseline. All P02/P10/P12/P15/P16 and Alpha A01–A27 statuses remain BLOCKED; the v6.4 local checks do not promote them.
