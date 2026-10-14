# Ecosystem source review — Batch 015

**Date:** 2026-10-14
**Scope:** SRC-121–SRC-135 (15 sources)
**Status:** Partial research review; no runtime changes.

## Summary

This batch covers offline time-series analysis, portfolio statistics, probabilistic modeling, distribution-shift monitoring, formal specification, symbolic checking, property testing and distributed-systems fault testing. The useful common pattern is to strengthen offline evaluation and state-machine verification. These sources do not justify adding a second live feature engine, risk engine, or execution authority.

Most directly relevant to the current feed/recovery audit are TLA+, Apalache, Alloy, Z3, Jepsen and Quint. Their value is to make assumptions explicit, find bounded counterexamples, and turn those counterexamples into deterministic tests. They do not establish that the running TypeScript build matches a model.

For trading research, ruptures, arch, sktime, PyMC, alibi-detect and quantstats are potential offline tools. They require point-in-time data, strict chronological splits, realistic fees/fills, and uncertainty reporting. A detected regime shift or attractive historical statistic is not a trade authorization.

The detailed per-source record, module mapping, overlap, risk and validation requirements is in [`source-review-batch-015-2026-10-14.json`](../research/registry/source-review-batch-015-2026-10-14.json).

## Evidence boundary

- Sources were assessed from their official GitHub repositories and linked project documentation available for this review.
- Some records retain `PARTIAL_REVIEW`; licensing and revision pinning are explicitly unverified where not established.
- No REA run, code patch, build, runtime test, or repository-source audit was performed in this research batch.
- Do not interpret inclusion as approval to install a package or connect it to execution, signing, custody, or capital controls.

## Progress

With this batch, the registry records 174 of 288 sources (60.42%). The supplied `resource_manifest.csv` remains unchanged; the JSON review records are the resumable progress ledger.
