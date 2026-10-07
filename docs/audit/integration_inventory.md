# Integration inventory

Generated 2026-09-23 from source and configuration names. Configuration alone is not operational evidence.

| Integration | Role | Code evidence | Certification state |
|---|---|---|---|
| Solana RPC/WSS | Chain reads, health, confirmation | `rpc.ts`, `feed.ts`, provider health, `platform/ingestion/finalized-block-auditor.ts`, `platform/execution/finalized-signing-correlation.ts`, `Store.getSigningIntent()` | The finalized audit verifies the reported first Ed25519 signature against the first required signer/message and captures static/ALT account order, raw safe lamport arrays, token-balance metadata digest, and CPI trace. A diagnostic comparator can compare those reported fields with the immutable local signing-intent row read from SQLite. Neither path certifies settlement: block membership, finality, metadata, provider identity, and intent-to-chain linkage remain untrusted until separately reviewed and durably receipt-bound. |
| PumpPortal | Discovery/WebSocket feed | `feed.ts`, `market-hub.ts`, validator | Requires schema, continuity, reconnect, and stale-feed evidence. |
| Yellowstone gRPC | Alternative transaction feed | `feed.ts` | Test-covered transport path; runtime capability must be verified separately. |
| Jupiter Swap API V2 Router | Graduated-token paper quote/build instructions | `execution.ts`, `JUPITER_URL`, `JUPITER_API_KEY` | V2 `/build` quote, blockhash expiry, route instruction allowlist, compute-price cap, and live ALT reads are checked. Source snapshot is rechecked after awaits. Paper builder only; direct signing/submission remains quarantined. No live Jupiter endpoint was called in tests. |
| Jito | Bundle submission/tips | `execution.ts`, SOLARIS modules | Inflight status is diagnostic only; the legacy reconciler now requires matching finalized transaction evidence from all configured RPC endpoints before mutating state. Endpoint independence, durable signed-message binding, and certified settlement remain unverified. |
| RugCheck/DexScreener/Kolscan | Enrichment/research | `market.ts`, `market-hub.ts` | Advisory input only until provenance and freshness contracts pass. |
| AWS KMS | Ed25519 signing adapter | `platform/signing/aws-kms-ed25519.ts` | Contract is present; no key material or deployment verification was performed. |

The finalized-block change was tested with deterministic fixtures and made no Solana RPC calls. The existing mainnet verification scripts are evidence-collection tools, not proof that a provider is healthy today.

