# V15 LiteSVM research runner

This runner is experimental and has not been verified against historical mainnet transactions. It is not connected to any signer or live capital authority.

## Local validation

Run `cargo check --all-targets` and `cargo test` in this directory before attempting a replay. The CI workflow reports build status; a successful compile is not evidence of historical parity.

The input JSON requires: `slot`; `program` with `id`, local `path`, and SHA-256 `sha256`; `accounts` containing `address`, `lamports`, `owner`, `executable`, `rentEpoch`, and `dataBase64`; `payerKeypairPath`; `instructionDataBase64`; and `metas` containing `address`, `isSigner`, and `isWritable`.

Use only disposable local test keys. Do not use a wallet holding funds.

The current implementation runs one instruction with one signer, checks the executable hash, and reports lamport changes and account data hashes. It does not establish historical runtime version, full CPI dependencies, historical blockhash, feature gates, or full transaction context. Its outputs must not be used to certify V13/V14 economic performance.

## Acceptance gates

1. Compile and pass unit tests.
2. Add a deterministic local transfer fixture and verify fees, CU and account conservation.
3. Add a pinned historical executable and complete prestate with verifiable provenance.
4. Compare every writable account's data and balances against independently reconstructed mainnet results.
5. Add Mollusk instruction-level parity and failure-path tests.
6. Keep certification BLOCKED until every gate passes with retained evidence.
