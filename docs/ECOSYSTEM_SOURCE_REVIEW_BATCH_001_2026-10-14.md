# Ecosystem source review — batch 001

**Date:** 2026-10-14
**Repository baseline:** `f5c31177f2b8d79cdf5e3662e4049ac44b9562b2`
**Manifest:** 288 rows, 21 categories, 67 unique hosts; SHA-256 `5cf2eed491246816cf8eea758575311aa9b71bf2e6d31779b40d3301cdd6a5cd`.

## Validation and scope

The attached manifest was copied unchanged to `research/registry/resource_manifest.csv`. Validation confirmed 288 records, unique IDs and URLs, valid HTTP(S) URLs, and priority counts P0=45, P1=84, P2=159. The script report is `research/registry/manifest-validation-2026-10-14.json`; the reproducible validator and regression check are `scripts/validate-resource-manifest.mjs` and `test/resource-manifest.test.mjs`.

This batch individually reviewed five P0 sources: Yellowstone gRPC, REA, Jito low-latency sending, Jupiter Swap V2, and Pump public docs. The record-level findings and next validation requirements are in `research/registry/source-review-batch-001-2026-10-14.json`. These are partial technical reviews; license/data rights, exact upstream commit pins, and full compatibility validation remain open where stated. The other 283 sources are not yet individually reviewed.

## Findings that affect the integration plan

### Yellowstone recovery

The upstream README describes a Geyser gRPC surface for slots, blocks, transactions, deshred transactions and accounts, with TLS/auth options and known block reconstruction limitations. Its changelog also records replay/reconnect edge cases around duplicate events, partial slots and fork/blockhash checks. SYLPH already captures protobuf bytes and feeds versioned observations into canonical ingress, so the useful next work is differential replay fixtures and exact version-compatibility evidence, not another feed implementation.

### Jito execution evidence

Jito documents that a `sendBundle` receipt and bundle ID do not guarantee on-chain landing; callers need bundle status evidence. Bundles are atomic/all-or-nothing within a slot and tip selection participates in an auction. SYLPH currently exposes read-only connectivity and tip-floor research, so the right missing measurement is landed status correlated to finalized signatures, fees, tips and settlement. No sender path was changed.

### Jupiter quote boundary

The current V2 `/order` reference describes assembled transaction output and a taker field. SYLPH's current adapter is intentionally quote-only: it bounds and validates requests, discards any returned unsigned transaction, and exposes no signing or submit authority. Existing environment notes say API-key and taker configuration are absent, so authenticated V2 behavior still needs a fixture or authorized non-capital validation.

### Pump lifecycle and reserve math

Pump's official docs describe newer curve and PumpSwap instruction families, multi-hop routes and non-SOL/pump-token quote mints. Effective PumpSwap quote reserves use the pool quote-vault amount plus a signed virtual reserve; fees may remain accrued and be swept separately. SYLPH's curve reader is research-only and not itself an executable quote. These semantics warrant versioned account/event fixtures and Astra protocol/math review before changing quote logic.

### REA scope

REA is useful for local authorized JavaScript/Electron artifact analysis and structural mapping. It does not review all URLs or establish runtime behavior from a static relation. Existing REA outputs in `.audit/` remain out-of-band support; no REA command was run in this batch, and no REA result feeds decisions or execution.

## Verification

- `node scripts/validate-resource-manifest.mjs --json-out research/registry/manifest-validation-2026-10-14.json` — passed; 288/288 valid, no duplicate IDs/URLs.
- `node --test test/resource-manifest.test.mjs` — passed, 1/1.
- No trading/build/runtime change was made by this research batch. Signing, broadcast, capital authorization, and risk limits were not changed.

## Next batch

Continue P0 sources by grouping related Solana fee/production docs, Jupiter/Pump protocol references, execution and simulation repositories, then review the remaining 40 P0 resources. Record each source's exact upstream revision or capture date before considering any runtime integration.
