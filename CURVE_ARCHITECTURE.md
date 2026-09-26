# Curve and Migration Architecture Baseline

Current status: **PARTIAL; not certification-ready**.

The executable curve path is `Market.snapshot()` → Pump SDK decode → `fusion.ts`. It reads Pump account, global and fee accounts under expected owners and uses SDK integer quotes. Completion presently blocks new curve entries and triggers an exit/panic branch for held curve positions.

Existing migration signals are conflicting: `MarketHub` labels a non-Pump DexScreener listing as migrated, `PairResolver` infers migration from reported reserves, and `PostGraduationAmmBridge` maintains a separate in-memory Raydium-oriented state. None is a canonical chain-verified handoff.

`src/lifecycle/launch-lifecycle.ts` is the new pure canonical reducer foundation. It is not yet runtime wired, durable, or a provider adapter.

