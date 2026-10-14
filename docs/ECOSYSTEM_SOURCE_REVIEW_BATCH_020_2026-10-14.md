# Ecosystem source review — Batch 020

**Date:** 2026-10-14
**Scope:** SRC-199–SRC-213 (15 sources)
**Status:** Partial research review; no runtime changes.

## Summary

Historical data providers can help construct cohorts, validate wallet behavior and study market regimes, but dataset schemas, update cadence, selection rules and data rights matter. Save query text and extraction timestamps; match tokens by mint and pools by address; reconcile key outcomes to canonical chain records. DEX dashboards and analytics APIs are not executable quotes.

Risk scanners and wallet maps are useful as evidence sources when their detailed findings and timestamps are preserved. Their summary scores and clusters are not proof of safety, common ownership or sellability. Explorers support manual transaction review but must be checked for the intended cluster.

Execution services in this batch belong behind the existing quote/simulation/authority/fill-accounting boundaries. A fast relay or route is useful only if confirmed landed output, fees and price impact improve the realized result.

## Evidence boundary

- Official documentation was available for some providers; others remain partial because no stable public API contract was verified in this pass.
- No credentials, paid calls, live transactions, package installation, REA, build or runtime code changes were used.
- No provider claim is treated as independently established performance.

Detailed records: [`source-review-batch-020-2026-10-14.json`](../research/registry/source-review-batch-020-2026-10-14.json).

## Progress

The registry now records 249 of 288 sources (86.46%). The supplied manifest remains unchanged.
