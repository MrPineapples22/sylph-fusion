# Ecosystem source review — Batch 017

**Date:** 2026-10-14
**Scope:** SRC-151–SRC-165 (15 sources)
**Status:** Partial research review; no runtime changes.

## Summary

The observability projects offer ways to collect metrics, traces, logs and profiles. If used, they should observe existing Engine/feed/recovery state and preserve the Engine as the state authority. Keep labels bounded, redact sensitive data, and treat telemetry as operational diagnostics rather than a complete audit record.

The graph projects can help offline researchers inspect wallet transfers, shared funders, token exposure and candidate clusters. A graph relationship is only as reliable as its source edges and attribution rules. Preserve direct evidence separately from inferred links, timestamp every edge, and do not convert graph centrality or visual clusters into automatic execution authority.

## Evidence boundary

- Records are high-level official repository/documentation reviews, not pinned-revision audits or performance evaluations.
- Several products have edition, deployment or license choices that need verification before use; these are called out in the JSON registry.
- No package installation, REA run, code change, build, or runtime test was performed.

Detailed findings and per-source validation requirements: [`source-review-batch-017-2026-10-14.json`](../research/registry/source-review-batch-017-2026-10-14.json).

## Progress

The registry now records 204 of 288 sources (70.83%). The original source manifest remains unchanged.
