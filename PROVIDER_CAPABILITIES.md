# Provider Capability Baseline

Classification is runtime evidence, not a registry label.

| Provider/function | Connected path | Current status | Certification limitation |
|---|---|---|---|
| Solana RPC/WSS | `src/rpc.ts`, `src/feed.ts` | PARTIAL | sequential failover; quorum implementation is separate and unwired |
| Yellowstone gRPC | `src/feed.ts` | PARTIAL | optional path; no certification drill evidence |
| PumpPortal WS | `src/market-hub.ts`, validator | PARTIAL | discovery input; not certified as independent market truth |
| DexScreener | `src/market-hub.ts` | PARTIAL | often the single cross-validation source |
| RugCheck / Solana Tracker | risk modules | PARTIAL | advisory risk data, not chain authority |
| Jupiter / Jito | `src/execution.ts` | DESIGNED_ONLY for production | no certified live signer/broadcast/reconciliation composition |
| External provider registry | `external-registry.ts` | CONFLICTING | metadata covers many providers without runtime adapters |

External Capability Fabric: PARTIAL. EEQC acquisition planning: MISSING. Champion/challenger provider loop: DESIGNED_ONLY. Provider-failure testing: PARTIAL (local synthetic failure tests exist; end-to-end real-provider drills do not).

`scripts/live-market-bridge.mjs` fabricates local slot/estimated reserve data and is simulation-only; it must not be promoted to chain truth.

