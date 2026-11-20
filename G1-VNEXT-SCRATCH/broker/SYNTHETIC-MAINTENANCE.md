# Synthetic maintenance import test endpoint

This is an opt-in G1 scratch prototype. The default build has no maintenance
listener. With Cargo feature `synthetic-maintenance`, the broker service may
be configured with `--synthetic-maintenance-client-sid <SID>` and will start a
second local named pipe, `\\.\pipe\SylphG1SyntheticMaintenanceTestOnly`.
The SID must be syntactically valid and distinct from the normal IPC client
SID and service SID. The endpoint has a separate pipe ACL and operation lock.
It is not the normal pipe, has no `Registry` reference, does not publish or
withdraw normal readiness, and writes only
`<configured-data-dir>/synthetic-maintenance-data/synthetic-import.sqlite`.
That path is separate from `registry.sqlite`. Endpoint startup/runtime errors
are recorded in `synthetic-maintenance-status.txt`; they do not alter normal
readiness or registry contents.

The feature-gated `g1-synthetic-maintenance.exe` and `g1-client.exe
synthetic-import` are **clients only**. Each reads a framed request from stdin,
verifies the named-pipe server process identity, and sends the request to the
broker. They never open or write the synthetic database. Outside unit tests,
the broker runtime is the only writer. Requests cannot supply paths, SQL,
signer identity, authorization results, or trust policy.

## Wire limits and results

Client input begins with a 4-byte unsigned big-endian length followed by
exactly that many bytes and then EOF. The named-pipe adapter uses the existing
2 KiB pipe framing and an ASCII hex wrapper, limiting the binary frame to
**900 bytes** (1800 hex characters). It is intended for tiny synthetic
fixtures. It cannot carry the historical receipt inventory and does not meet
complete-history import requirements. The endpoint does not chunk or assemble
multi-message requests. Oversized, partial, malformed, or trailing data is
rejected without opening the synthetic store.

The frame uses schema `G1SIMP01`, a nonzero 16-byte request ID, an immutable
base anchor, a separately supplied expected current head, a typed bundle, and
bounded receipt and obligation fields. Strings/bytes have explicit lengths;
UTF-8, count/size limits, and exact end-of-frame are checked. Durable request
identity and generation checks are delegated to `ImportKernel` and
`DurableImportStore`.

The envelope is the public marker
`SYLPH_G1_SYNTHETIC_TEST_ONLY_V1\0` followed by the request ID. It is not a
signature or authentication. The authenticator proves no identity, finality,
provider independence, or operational authority. Responses use schema
`SYLPH_G1_SYNTHETIC_IMPORT_RESULT_V1`, authority `SYNTHETIC_TEST_ONLY`, and
one of `ACTIVATED`, `ALREADY_ACTIVE`, `REJECTED`, or `INDETERMINATE`.

## Build and tests

From the copied Windows scratch package:

```powershell
cargo fmt --manifest-path broker/Cargo.toml -- --check
cargo test --locked --manifest-path broker/Cargo.toml --target x86_64-pc-windows-msvc --features synthetic-maintenance --bin g1-synthetic-maintenance -- --test-threads=1
cargo test --locked --manifest-path broker/Cargo.toml --target x86_64-pc-windows-msvc --features synthetic-maintenance --bin g1-broker -- --test-threads=1
cargo test --locked --manifest-path broker/Cargo.toml --target x86_64-pc-windows-msvc --features synthetic-maintenance --bin g1-client -- --test-threads=1
cargo build --locked --release --bins --manifest-path broker/Cargo.toml --target x86_64-pc-windows-msvc --features synthetic-maintenance
```

The broker test binary includes a Windows junction rejection test and an
in-process named-pipe listener roundtrip using the current test process SID.
The roundtrip checks synthetic persistence, malformed-request rejection,
shutdown, and unchanged normal registry/readiness bytes. It does not launch
the listener through SCM or prove its service token. Unless a hosted Windows
run installs and starts the feature-enabled service with its configured
maintenance SID, SCM service-token and service-argument coverage remain
BLOCKED. No G1 qualification or production authorization is implied.
