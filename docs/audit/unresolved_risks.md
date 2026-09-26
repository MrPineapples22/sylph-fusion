# Unresolved risks and certification blockers

Generated 2026-09-23 from current source, working-tree state, and one local test run.

## Critical

1. **No production certificate.** Current architecture documents correctly describe certification as gated. No live trading authority is inferred from code, configuration, or a passing test.
2. **Multiple composition roots and authorities.** `fusion.ts`, platform orchestration, and intelligence orchestration can represent competing state/execution paths. Establish one authority graph before any live enablement.
3. **Uncommitted sensitive-surface changes.** The working tree includes execution, signing, reconciliation, config, release, and UI changes. They require review and reproducible evidence before any merge or packaging decision.

## High

4. **Full-suite isolation defect.** `npm run test` compiled successfully but reported failures in SessionLogger integrity, SQLite restart persistence, and the end-to-end settlement pipeline. A focused run of those three files immediately passed 40/40. This indicates shared state, timing, temporary-resource, or runner interference in the broad suite. It still blocks a clean certification claim until the full suite is deterministic and the cause is captured.
5. **Configuration fragmentation.** Core schema, config authority, and direct environment reads coexist; a single frozen configuration hash is not demonstrated end to end.
6. **Provider evidence is not current proof.** Endpoint URLs/configuration and mock tests do not demonstrate health, independence, freshness, or failover under the configured deployment.
7. **Execution/reconciliation chain needs one trace.** The exact `EXECUTION_REVIEW_UNAVAILABLE` and `LIVE_RECONCILIATION_UNAVAILABLE` dependencies must be surfaced through a single capability graph with last verified evidence.

## Medium

8. Generated/release output is modified alongside source, creating source-of-truth and review noise.
9. The broad intelligence tree requires reachability, model registry, and shadow-mode evidence before it can affect policy.
10. External integrations need schema/version/freshness/capability contracts and independent failure tests.

## Next safe implementation boundary

Phase 1 only: make configuration, token identity, market snapshot, execution state, reconciliation state, and capability status single-owner contracts; add differential tests that prove the UI reads those contracts without fabrication. Do not enable live signing, broadcasting, or change credentials as part of that phase.
