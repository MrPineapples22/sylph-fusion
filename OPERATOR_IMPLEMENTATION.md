# SYLPH operator terminal — source-based reconstruction

Audit started 2026-09-21. Existing uncommitted discovery, ingestion and mobile work is preserved. Earlier reports are historical claims, not acceptance evidence.

## Active paths and authority

| Path/domain | Current implementation | Classification |
| --- | --- | --- |
| Desktop/mobile entry | `start-app.mjs` → `terminal/server.mjs` → `terminal/src/main.jsx` → `Spotlight` | Implemented; conflicts with requested Aether Flux identity |
| Simulator | `/simulator` → `App`, browser reducer and execution engine | Experimental simulation, separate authority |
| Legacy discovery | `LiveDashboard`, `Astra`, `ui/app.js`, `src/dashboard.ts` | Multiple historical surfaces; not the default entry |
| Market | `MarketHub`, PumpPortal websocket, RPC, enrichment adapters | Implemented; freshness/provider evidence must be preserved |
| Discovery | `src/discovery.ts`, `/api/discovery` | Partial backend projection; no monotonic version; incorrect reconciliation derivation |
| Signal adapter | Empty `discoverySignals` map | Disconnected; HSI/PoD/model output must stay unavailable |
| Risk | `scanToken`, bounded discovery risk cache | Partial; token scan is not portfolio authorization |
| UI projections | `globalProjectionService` plus discovery and live market endpoints | Duplicate read shapes; consolidation needed |
| Commands | `/api/command`, `/live/api/command` → `globalCommandGateway` | Paper/shadow simulator only; LIVE rejected |
| Execution evidence | Fixed pool/slot/evidence values and synthetic signatures in gateway | Simulation only; never admissible as live evidence |
| Positions | In-memory paper gateway, browser simulator, separate engine ledgers | Separate scopes; no unified live wallet reconciliation |
| Provider health | `globalProviderHealthTracker` | Implemented validated-observation tracking |
| Incidents | Provider alerts, browser alert grouping | Partial; root-cause history/capability effects needed |
| Operator runtime | Independent view/selection/confirmation state | Missing formal workspace/context runtime |
| Release | TypeScript + Vite, Windows package scripts | Implemented packaging; production certification unproven |
| Tests | Core/intelligence/platform/terminal Node suites | Baseline passes; many source checks do not prove browser interaction |

## Implementation sequence and evidence

1. Consolidate backend operator projection, domain provenance, version/generation guards and explicit unknowns.
2. Persistent safety shell and Aether Flux workspace with stable scanning, visible filters and evidence inspection.
3. Formal operating context, interruption priority, comparison and return points.
4. Reviewed execution contracts only where a real authoritative adapter exists; unavailable capabilities remain blocked with reasons.
5. Capital, incident/recovery, mobile, keyboard and performance validation.
6. Adversarial tests, browser inspection, fault injection, restart/recovery and 24-hour soak.

Production release is NOT certified. Missing live signer/reconciliation/review adapters and incomplete release gates are blockers, not permission to fabricate success. Market feed status cannot prove financial reconciliation. A passing build cannot prove the requested acceptance experience.
