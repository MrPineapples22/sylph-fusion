# Synthetic maintenance import harness

This is an opt-in G1 scratch prototype. It is deliberately separate from
`g1-broker`, the normal service entrypoint, the normal named pipe, readiness,
and `registry.sqlite`.

## Build and run

The binary is excluded from default builds. In the copied Windows scratch
package only, build it explicitly:

```powershell
cargo test --locked --target x86_64-pc-windows-msvc --features synthetic-maintenance --bin g1-synthetic-maintenance
cargo build --locked --target x86_64-pc-windows-msvc --features synthetic-maintenance --bin g1-synthetic-maintenance
```

It accepts no arguments. It reads one length-prefixed binary request from
standard input and writes one JSON result. Its only database path is fixed
relative to the executable:
`synthetic-maintenance-data/synthetic-import.sqlite`. The database is created
new; if present, it is opened only through the existing import store's complete
validation path. The request cannot choose a filesystem path, database name,
SQL statement, trust policy, signer, or authentication result.

## Wire format

The stream begins with a 4-byte unsigned big-endian payload length, followed by
exactly that many bytes and then EOF. Payload size is limited to 64 MiB. The
payload is:

1. 8 bytes `G1SIMP01`.
2. 16-byte nonzero request ID.
3. Anchor: chain string, generation u64, state-root string, last-receipt
   string, obligation count u32, then each obligation's identity, state, and
   external-identity strings.
4. Bundle: schema u32, chain string, generation u64, parent generation u64,
   parent and state-root strings, receipt count u32, then each receipt's
   identity string, parent-identity string, and payload bytes; obligation
   count u32 and obligations in the anchor format; envelope bytes.

Each string or byte sequence is encoded as a 4-byte big-endian length followed
by the bytes. Strings must be UTF-8. Individual fields are limited to 1 MiB,
receipt and obligation counts to 100,000 each, and trailing bytes are rejected.

The envelope is exactly the public marker
`SYLPH_G1_SYNTHETIC_TEST_ONLY_V1\0` followed by the request ID. It is not a
signature or authentication. The authenticator reports only synthetic test
identity and `SYNTHETIC_TEST_ONLY`; it offers no operational trust, chain
finality, signer authentication, or authority.

## Replay and outcomes

The request ID is persisted as part of the exact envelope in the durable
generation record. Replaying the identical request returns `ALREADY_ACTIVE`
after full store validation. Reusing the ID for changed content is rejected or
indeterminate if the persisted head does not match. Reusing content with a
different ID is rejected as a conflicting envelope. A storage or acknowledgment
uncertainty is never reported as successful activation.

Every stdout response carries the fixed schema and
`"authority":"SYNTHETIC_TEST_ONLY"`; results are `ACTIVATED`, `ALREADY_ACTIVE`,
`REJECTED`, or `INDETERMINATE`. A success status is a scratch-store test result
only. This harness is not connected to service IPC or operational readiness.

## Limits

This prototype does not establish an OS identity boundary, secure the binary's
directory, authenticate users, prove historical source data, or authorize a
production import. It assumes the executable directory is a disposable
scratch location with protected ancestors. Independent review and Windows
runtime testing are required before treating even the bounded prototype as
qualified.
