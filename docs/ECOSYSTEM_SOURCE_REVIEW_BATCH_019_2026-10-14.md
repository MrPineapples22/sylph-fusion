# Ecosystem source review — Batch 019

**Date:** 2026-10-14
**Scope:** SRC-184–SRC-198 (15 sources)
**Status:** Partial research review; no runtime changes.

## Summary

The infrastructure providers span shreds, Yellowstone-compatible streams, RPC, transaction transport and managed blockchain endpoints. These are separate layers. A fast shred observation is provisional; it is not a confirmed transaction, complete history, or proof that an execution landed. For any candidate provider, compare timestamped observations from the same region, test disconnect/replay recovery, and reconcile important state with canonical RPC/on-chain evidence.

Provider-published benchmarks are useful when they include method, region, sample size, dates and exclusions. They remain provider claims unless independently reproduced. Avoid using ping latency as a proxy for net execution quality: measure confirmed landing, fees, tips, price impact and realized fills.

Historical services such as Allium and Dune can support cohort studies and backtests. Preserve query/schema versions and extraction time, inspect the SQL, and independently check critical results. Do not promote a dashboard or third-party parsed feed into SYLPH's canonical state source.

## Evidence boundary

- Provider product descriptions and performance claims can change; account-specific pricing, quotas, access and data rights remain unverified.
- No credentials were used, no paid/API calls were made, and no live trading or signing path was exercised.
- No package installation, REA run, build or code patch was performed.

Per-source notes and validation requirements: [`source-review-batch-019-2026-10-14.json`](../research/registry/source-review-batch-019-2026-10-14.json).

## Progress

The registry now records 234 of 288 sources (81.25%). The original manifest remains unchanged.
