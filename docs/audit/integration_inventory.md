# Integration inventory

Generated 2026-09-23 from source and configuration names. Configuration alone is not operational evidence.

| Integration | Role | Code evidence | Certification state |
|---|---|---|---|
| Solana RPC/WSS | Chain reads, health, confirmation | `rpc.ts`, `feed.ts`, provider health | Requires endpoint-specific freshness, slot agreement, and failure evidence. |
| PumpPortal | Discovery/WebSocket feed | `feed.ts`, `market-hub.ts`, validator | Requires schema, continuity, reconnect, and stale-feed evidence. |
| Yellowstone gRPC | Alternative transaction feed | `feed.ts` | Test-covered transport path; runtime capability must be verified separately. |
| Jupiter | Quotes/swap instructions | `execution.ts`, config | Endpoint/API-key presence does not prove routability or safe simulation. |
| Jito | Bundle submission/tips | `execution.ts`, SOLARIS modules | Requires independent delivery and ambiguous-submission reconciliation evidence. |
| RugCheck/DexScreener/Kolscan | Enrichment/research | `market.ts`, `market-hub.ts` | Advisory input only until provenance and freshness contracts pass. |
| AWS KMS | Ed25519 signing adapter | `platform/signing/aws-kms-ed25519.ts` | Contract is present; no key material or deployment verification was performed. |

No external calls were made for this audit. The existing mainnet verification scripts are evidence-collection tools, not proof that a provider is healthy today.

