# Ecosystem source review — batch 007

This batch reviews the first 15 P1 streaming, archive, and indexer repositories. Source-level records are in `research/registry/source-review-batch-007-2026-10-14.json`.

## Findings

- Historical bulk replay sources can improve research coverage but are not substitutes for live account updates or canonical finalized state. Jetstreamer’s README specifically notes that Old Faithful lacks account updates, that parallel slot ranges can yield out-of-order downstream writes, and that maintenance moved from Anza to Vaultic.
- Thorofare offers a useful provider comparison pattern: measure multiple slot stages and report distributions, while distinguishing comparative endpoint wins from absolute freshness.
- Several repositories provide validator-side Geyser implementations or alternate transports. They require infrastructure deployment and protocol conformance testing; a different client connected to the same provider is not independent corroboration.
- Firehose/Substreams and Streamling are potential historical analytics and transformation references. Their cursor/reorg, schema, and data-lineage contracts must be tested against SYLPH’s canonical journal before any derived data is used.
- Dstore offers a pattern for emulator-backed storage tests. Its existence does not prove a replacement store has equivalent durability, atomicity, or restart behavior.

## Verification

Reviews used official repository pages and READMEs. No third-party repository was cloned, installed, or executed. License classifications are recorded only where repository metadata was visible; otherwise the record remains explicitly unverified. No runtime code changed.
