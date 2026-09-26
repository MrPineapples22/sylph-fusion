# Test Matrix Baseline

| Layer | Evidence | Result / limitation |
|---|---|---|
| Core | `npm test` core suite | passed in current audit run |
| Intelligence/platform | `npm run test:intelligence` | 279/279 passed; synthetic/unit evidence only |
| Terminal | terminal suite in `npm test` | passed in current audit run |
| Build/config | `npm run build:engine`, `npm run check` | passed in paper mode |
| Provider failure | provider-health, failure-injection, temporal tests | local deterministic coverage; no real-provider fault certification |
| Replay | local replay/hash utilities | insufficient for reducer state equivalence |
| Semantic differential | none | MISSING |
| Soak/adversarial/live reconciliation | none sufficient for release | BLOCKED |

Passing tests establish the behavior they exercise; they do not certify a live signer, live provider fallback, durable lineage, or production release.

