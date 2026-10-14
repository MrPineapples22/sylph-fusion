# Ecosystem source review — batch 004

This batch reviews Helius's Yellowstone fork, Anza Kit, the SYLPH repository/commit reference, and three project sources for feed, ingress, and gap recovery. The per-source register is `research/registry/source-review-batch-004-2026-10-14.json`.

## Findings

- Helius's Yellowstone repository identifies itself as a fork of `rpcpool/yellowstone-grpc` and is AGPL-3.0. It is not an independent feed for corroboration; fork deltas and licensing still need review before reuse.
- Anza Kit is the renamed Solana JavaScript SDK 2.x line, while the project remains on `@solana/web3.js` 1.98.4. Its explicit failed-subscription/catch-up pattern is a useful design comparison, but this does not prove support for the newest transaction/fee format or justify a wholesale migration.
- The local and remote SYLPH `main` refs match at `f5c31177f2b8d79cdf5e3662e4049ac44b9562b2`. The working tree is extensively modified, so GitHub main links do not describe every current local file.
- Local source review confirms Feed keeps historical repair effects separate from live health, canonical ingress hash-verifies durable evidence and isolates staging batches behind a capability, and the gap reconciler refuses unverified persisted frontiers. The focused regressions passed.

## Verification

`node --test test/feed-processing-intent-health.test.mjs test/platform/canonical-ingress-durability.test.mjs test/platform/pass-24-gap-recovery-fabric.test.mjs` passed **31/31**. This confirms those local tested transitions; it does not prove that currently running processes have loaded the edited files or that replay throughput is sufficient to catch up to finalized tip.

No live process, signing path, broadcast route, capital authorization, or risk limit was changed.
