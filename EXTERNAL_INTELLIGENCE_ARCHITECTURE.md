# External Intelligence Architecture Baseline

Current status: **PARTIAL; not certification-ready**.

Runtime connections are narrow: Solana RPC/WSS, optional Yellowstone, PumpPortal, DexScreener, RugCheck, optional Solana Tracker, Jupiter, Jito and a Kolscan HTML scrape. The broad external registry is policy metadata; it is not runtime activation, adapter dispatch, health proof, or a certified capability catalog.

The new `src/platform/ingestion/capability-fabric.ts` provides a pure provider-neutral planning seam: a caller requests a capability and evidence requirements, then receives an authority/freshness/health-qualified provider plan. It does not make network calls, expose credentials, or confer execution authority.

## Reality classification

| Area | State |
|---|---|
| RPC availability failover | PARTIAL — sequential endpoints, not a certified quorum |
| Provider health/circuit states | PARTIAL — useful tracker, but configuration and engine integration are split |
| Provider registry | DESIGNED_ONLY — static metadata, not proof of adapters |
| Provider capability fabric | PARTIAL — pure selection contract, not runtime wired |
| BEEL / raw archive / bitemporal replay | MISSING |
| EEQC / tiered acquisition plans | PARTIAL — plan contract only |
| lineage-based independence / challenger league | MISSING |
| schema-drift quarantine | PARTIAL — frame validation only |

No provider response can sign, mutate capital, override risk, retry ambiguous transactions, or directly authorize execution.

