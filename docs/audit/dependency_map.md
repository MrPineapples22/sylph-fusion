# SYLPH dependency map

Generated 2026-09-23. Arrows mean direct import/composition observed in source; they do not prove a path runs in production.

```text
fusion.ts
  ├─ config.ts → RpcPool / Feed / Market / Executor
  ├─ Store + SessionLogger
  ├─ platform/execution/authority.ts
  └─ dashboard.ts → projection/read APIs

app.ts
  ├─ MarketHub
  ├─ PaperPortfolio
  └─ dashboard.ts

platform/orchestrator.ts
  ├─ vault + ledger + risk + security
  ├─ market truth + revalidator
  ├─ signer + settlement firewall
  └─ reconciler + sentinels

intelligence/master-orchestrator.ts
  ├─ truth (chain, RPC pool, time, feature store)
  ├─ signals / models / policy / opportunity
  └─ execution intelligence and UI state

terminal/
  └─ operator runtime → read-model/projection HTTP APIs → rendered capability state
```

## Required dependency direction

`providers → normalized events → canonical market/token state → features/models → opportunity → deterministic risk → execution review → signing firewall → send/confirm → reconciliation → read-only UI`

No source inspection in this audit establishes that the legacy `fusion.ts`, platform orchestrator, and intelligence orchestrator converge into that one chain. Any live path must be traced with an end-to-end correlation ID before certification.

