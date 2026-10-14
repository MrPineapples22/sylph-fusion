# Ecosystem source review — Batch 021

**Date:** 2026-10-14
**Scope:** SRC-214–SRC-228 (15 sources)
**Status:** Partial research review; no runtime changes.

## Summary

Transaction relays and terminals must be evaluated by confirmed outcomes and full cost. A send acknowledgement, fast path, retry policy or provider-reported landing rate is not enough by itself. Capture attempted route, signature, confirmation slot, expiry, priority fee, tip, protocol fee, token delta and realized slippage.

For routing, preserve explicit lifecycle and program state: Pump.fun's bonding curve transitions to PumpSwap; Meteora DBC has its own graduation path; Orca Whirlpool depth depends on tick state; Raydium pool type matters. Use current official SDK/API versions, and make quote/build/sign/send/confirm separate boundaries. Keep signer and capital authorization in existing SYLPH controls.

Trading terminals are useful operator interfaces, but UI signals and wallet rankings are not validated net-PnL or risk evidence. Verify mint, pool and transaction on chain, and reconcile actual fills independently.

## Evidence boundary

- Official docs were available for some APIs and protocol lifecycles; several provider product and access claims remain unverified.
- No credentials, paid calls, wallet connections, live trades, package installs, REA runs, builds or runtime code changes were used.
- Records are not integration approval.

Detailed per-source records: [`source-review-batch-021-2026-10-14.json`](../research/registry/source-review-batch-021-2026-10-14.json).

## Progress

The registry now records 264 of 288 sources (91.67%). The original manifest remains unchanged.
