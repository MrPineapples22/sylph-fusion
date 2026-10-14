# Ecosystem source review — Batch 018

**Date:** 2026-10-14
**Scope:** 15 unique sources: SRC-166–175, SRC-178–180, SRC-182–183
**Status:** Partial research review; no runtime changes.

## Summary

The supply-chain tools offer layered checks for source patterns, test quality, dependency updates, artifact signing, vulnerability advisories, leaked credentials and policy enforcement. The strongest reusable release pattern is to bind a build to a digest, verify the expected signer identity, scan dependencies, and keep each check's scope and version visible. None of these tools proves the application behaves correctly at runtime.

For Solana compatibility, Token-2022 extensions require explicit handling; the Solana JavaScript client repository now separates v3+ development from the v1 maintenance branch; Meteora DBC has its own lifecycle and graduation behavior; AccountsDB Kafka and Carbon are indexing approaches that overlap existing ingress/decoder boundaries. These should inform compatibility fixtures and lifecycle-aware decoding, not create a second canonical feed path.

## Evidence boundary

- Findings are sourced from official repository or developer documentation, with pinned revisions and exact API compatibility still to be established.
- Two overlapping entries from earlier review batches (the SYLPH repository and REA) were excluded from this batch to prevent duplicate source accounting.
- No package installation, secret scan, REA run, build, live-chain access or code patch was performed.

Detailed records: [`source-review-batch-018-2026-10-14.json`](../research/registry/source-review-batch-018-2026-10-14.json).

## Progress

The registry now records 219 of 288 unique sources (76.04%). The original manifest remains unchanged.
