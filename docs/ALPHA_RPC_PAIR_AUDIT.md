# Solana RPC transaction-pair audit — non-certifying

Run: `node --test test/alpha-rpc-pair-audit.test.mjs`

Input: JSON object with wallet, mint, entrySignature, exitSignature, entryTransaction and exitTransaction. Transaction objects are the `result` objects from Solana `getTransaction` with `encoding: "jsonParsed"`, `maxSupportedTransactionVersion: 0` or another explicitly supported version, and finalized commitment. Supply RPC results from a trusted archival provider. This script does **not** fetch from RPC and does not use credentials.

It checks token-balance direction and closure, fee payer identity, SOL balance delta, timestamps and metadata errors. It deliberately emits a **non-certifying audit** and cannot feed the Alpha Tournament directly.

Critical: SOL account balance changes can include unrelated transfers, rent, WSOL account changes, priority fees and Jito tips. No reliable PnL should be inferred without decoding the complete instruction and inner-instruction graph and reconciling every wallet-owned token account. Fee attribution and executable trade price are **not** established. These checks must be added before promoting audit records to the observed-fill adapter.

Solana documentation: https://solana.com/docs/rpc/http/gettransaction and https://solana.com/docs/rpc/json-structures
