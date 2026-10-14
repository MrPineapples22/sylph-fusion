# Ecosystem source review registry

## Inputs

- `resource_manifest.csv` is the attached 288-row source manifest, copied without modification. SHA-256: `5cf2eed491246816cf8eea758575311aa9b71bf2e6d31779b40d3301cdd6a5cd`.
- `manifest-validation-2026-10-14.json` is the reproducible structural validation summary.
- `source-review-batch-*.json` records source-level research, provenance, discoveries, overlap, risks, and required validation. A source is counted reviewed only when it has a batch record. Manifest `NOT_REVIEWED` values remain unchanged to preserve the supplied input.

## Progress

| Batch | Sources reviewed | Coverage | Main area |
|---|---:|---:|---|
| 001 | 5 | SRC-028, SRC-177, SRC-257–259 | Yellowstone, REA, Jito, Jupiter, Pump |
| 002 | 3 | SRC-254–256 | Solana fees and production readiness |
| 003 | 4 | SRC-063, SRC-076, SRC-079–080 | Raydium SDK, Jito examples, LiteSVM |
| 004 | 6 | SRC-029, SRC-176, SRC-181, SRC-269, SRC-274, SRC-278 | Helius Yellowstone, Anza Kit, SYLPH feed/ingress/recovery |
| 005 | 10 | SRC-252, SRC-260–268 | REA skill, setup, JavaScript analysis, browser/process observation, CLI, security and operating guidance |
| 006 | 17 | SRC-270–273, SRC-275–277, SRC-279–288 | SYLPH fusion, execution, market/RPC, truth/journal/stream, authority/AMM, runtime, certification and build config |
| 007 | 15 | SRC-001–015 | Geyser benchmarking, validator streaming, Firehose/Substreams and archival storage |
| 008 | 15 | SRC-016–027, SRC-030–032 | Metaplex indexing, shred tools, Vixen redirect, account connector, RPC latency and Codama |
| 009 | 15 | SRC-033–047 | Codama renderers, Shank, serializers, dissectors and multi-language DEX parsers |
| 010 | 15 | SRC-048–062 | BlockBuster, Raydium/Meteora/Orca/Jupiter SDKs and trading-bot examples |
| 011 | 15 | SRC-064–075, SRC-077–078, SRC-081 | Orca, execution/RPC/Jito, Firedancer and SVM |
| 012 | 9 | SRC-082–090 | SBPF, differential fuzzing, test vectors, chaos testing and research tools |
| 013 | 15 | SRC-091–105 | Squads multisig, Wormhole/deBridge, token wrapping, vault and identity/secrets tools |
| 014 | 15 | SRC-106–120 | Analytical storage, feature stores, quant/ML and property-based testing |
| 015 | 15 | SRC-121–135 | Change detection, portfolio risk, probabilistic modeling and formal/concurrency testing |
| 016 | 15 | SRC-136–150 | Fuzzing, observability, telemetry, durable workflows and streaming data systems |
| 017 | 15 | SRC-151–165 | Time-series observability and wallet/token relationship graph analytics |
| 018 | 15 | SRC-166–175, SRC-178–180, SRC-182–183 | Software supply-chain controls and Solana client/indexing compatibility |
| 019 | 15 | SRC-184–198 | Solana streaming/RPC providers and historical data services |
| 020 | 15 | SRC-199–213 | Historical market data, token analytics and execution services |
| 021 | 15 | SRC-214–228 | Solana transaction delivery, routers, venues and trading terminals |
| 022 | 15 | SRC-229–243 | Token risk screening, transaction safety and custody/signing controls |
| 023 | 9 | SRC-244–251, SRC-253 | Portfolio monitoring, REA references, graph tooling and GitHub source hosting |
| **Total** | **288 / 288** | **100.00%** | **All manifest rows have review records; source-specific validation remains open where noted** |

Each source review is bounded and may remain `PARTIAL_REVIEW` until license/data-rights, pinned revisions, supported capabilities and required fixtures are established. Research-only status never implies approval for runtime use.

## REA boundary

REA is used out of band where the target type and authorization fit its supported analysis. It is not used to crawl or certify all 288 URLs. Keep source/doc inspection, official protocol references and deterministic behavior tests as separate evidence. Never route REA output into SYLPH's trading or signer decisions.

## Resume

Catalog triage is complete. For follow-up implementation work, select a concrete finding from a batch, inspect the current local source and pinned upstream documentation, reproduce the behavior with a focused deterministic test, and only then make a small patch. Preserve existing workspace changes and do not grant a source trading authority based on inclusion in the manifest.
