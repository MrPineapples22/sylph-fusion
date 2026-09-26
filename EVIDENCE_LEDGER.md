# SOL/SYLPH Evidence Ledger

| Claim | Evidence | Scope / limitation | Classification |
|---|---|---|---|
| Engine source compiles | `npm run build:engine` on 2026-09-23 | Type checking only | PROVEN |
| Core, intelligence, platform and terminal tests pass | `npm test` plus individual suite runs on 2026-09-23 | Fixture/simulation evidence; no mainnet proof | PROVEN |
| Terminal does not accept LAN operator traffic | `terminal/server.mjs`; local-bind regression | Only the terminal surface; not other local services | PROVEN |
| Browser cannot silently create a second paper execution effect when the gateway is down | `terminal/src/submit-paper-order.js`; outage regression | Test-only fallback can be explicitly enabled | PROVEN |
| Expired live transaction blocks further automation | `src/fusion.ts`; durable-retry regression | Does not perform wallet reconciliation itself | PROVEN |
| Experimental platform cannot fabricate economic execution or settlement effects | `src/platform/orchestrator.ts`; platform quarantine regression | Platform remains a non-production model | PROVEN |
| Edison golden-scenario catalogue cannot report fabricated verification | `src/intelligence/verification/edison-verification.ts`; intelligence regression | The 25 scenarios remain specifications until executable, independently asserted fixtures are built | PROVEN |
| Leader-direct routing cannot infer a validator or emit a datagram without registered endpoint and loaded schedule evidence | HELIOS/SOLARIS regressions; `npm run test:platform` | This is containment only; no verified live routing capability exists | PROVEN |
| Fee routing cannot treat policy defaults as current market observations | Solaris fee-evidence regression | No live fee-feed adapter is implemented or certified | PROVEN |
| Provider health cannot claim configuration, authentication or usable capability at startup | provider health and platform regressions | Runtime configuration and validated provider observations are still required | PROVEN |
| Missing terminal certificate/twin telemetry cannot render a pass or invented favorable metric | terminal build and test suite | Render-level regression coverage remains to be added | PROVEN |
| Stale market evidence cannot render the overall system operational merely because paper exits remain available | `src/operator-read-model.ts`, `terminal/src/OperatorTerminal.jsx`; operator-read-model and terminal regressions | Exit/reduction capabilities remain intentionally available in paper mode | PROVEN |
| Market adapters do not use implicit public endpoints | `src/market-hub.ts`, `src/app.ts`, `terminal/server.mjs`, `src/config.ts`; adapter and terminal regressions | Covers the repository's market-adapter boundary, not live provider quality or provider independence | PROVEN |
| Live signing and settlement are safe | No deployed signer, journal or settlement evidence | Repository intentionally blocks live startup | NOT_PROVEN |
| Provider independence and live freshness meet release requirements | No independent production probe/certificate | Unit and fixture coverage exists only | NOT_PROVEN |
| Strategy profitability or mainnet execution quality | No qualified live evidence | Simulation is not economic performance evidence | NOT_PROVEN |

`NOT_PROVEN` is not a zero or a pass. It is a required gate for any production-release decision.
