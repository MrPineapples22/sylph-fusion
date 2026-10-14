# Ecosystem source review — batch 009

This batch covers 15 IDL generators, serializers, protocol dissectors and DEX parsers. Per-source findings are in `research/registry/source-review-batch-009-2026-10-14.json`.

## Findings

- Codama's JS renderer generates typed Kit-compatible clients from versioned IDLs and exposes options for Node ESM import extensions and dependency mappings. It may modify package files or clean generated directories, so any evaluation belongs in a temporary workspace.
- Shank/Codama describe schema generation, not verification that an IDL matches deployed bytecode. Generated account and instruction codecs require golden byte fixtures.
- Wincode and the parser SDK family are useful serialization/parser comparison sources, but shared lineage between Rust and language bindings is not independent corroboration.
- DEX parsers cover overlapping protocols, including Pump, Jupiter, Raydium and Meteora. Their output must be checked against raw confirmed transactions, inner instructions, address lookup tables, fee metadata, and current program IDs.
- Firedancer's dissector is a human network-debugging aid. Solana shred parsing is pre-confirmation and must not enter execution eligibility without fork/rollback handling.

## Verification

Review used official repository documentation. No packages were installed and no external parser was executed. No runtime source changed; all candidates remain bounded by the fixture, license and compatibility checks recorded in the JSON ledger.
