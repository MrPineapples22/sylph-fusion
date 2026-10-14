# Ecosystem source review — batch 002

This batch individually reviewed the three official Solana production/fee references (SRC-254 through SRC-256). The source-level findings, evidence links and validation requirements are preserved in `research/registry/source-review-batch-002-2026-10-14.json`.

## Fee compatibility issue to verify

The official Solana docs distinguish legacy/v0 priority fees (CU price × requested CU limit with upward rounding) from v1 message-level configuration. They also state failed transactions still pay network fees. In SYLPH, `src/platform/signing/veritas-wire-decoder.ts` currently calculates priority fee from ComputeBudget instructions and returns a `legacy | 0` message version type, while `src/platform/ingestion/truth-x.ts` separately records chain-reported `meta.fee`.

This is a concrete compatibility question, not yet a reproduced production defect. A v1 fixture must first establish whether the decoder rejects, ignores, or misaccounts that transaction format and whether affected downstream consumers use its estimate. Any correction would change financial/protocol semantics and must follow `AGENTS.md` critical review: authoring Astra, independent Astra reviewer and reproducible evidence.

## Operations

The official production-readiness reference reinforces that endpoint reachability does not establish sustained capacity, recovery, monitoring or a healthy running process. SYLPH's previously recorded launcher checks surface blocked feed/RPC and legacy process state; this batch did not restart or otherwise change running services.

No transaction, signing, broadcast, capital, or risk path was changed.

## Verification

- `node --test test/platform/veritas-wire-decoder.test.mjs test/platform/execution-economics-and-governance.test.mjs` — passed, 8/8.
- Existing cases validate legacy/versioned-message decoding, signing firewall integrity and execution-economics behavior; no v1-specific fee fixture exists in this run, so the compatibility question remains open.
- Batch 001's combined catalog/feed/Jupiter/Pump/Jito regression run passed 33/33.
