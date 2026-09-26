# Failure Modes Baseline

| Failure mode | Present handling | State |
|---|---|---|
| provider timeout/429/stale feed | health tracker, circuit/backoff, tests | PARTIAL |
| source conflict | explicit conflict status in projections | PARTIAL |
| provider fallback failure | no champion/challenger proof | MISSING |
| unknown token semantics | some inspection | PARTIAL; must become fail-closed certificate gate |
| replay divergence | no canonical state equality test or incident path | MISSING |
| ambiguous live transaction | no live execution path | BLOCKED pending reconciliation architecture |
| restart/durable recovery | local utilities only | PARTIAL |
| model leakage/calibration drift | no durable lifecycle/prequential evidence | MISSING |
| UI apparent certainty from defaults | explicit warnings exist; fallback data risk remains | PARTIAL |

The response to missing or conflicting evidence is to preserve an explicit blocked/degraded/unknown state, not to synthesize a positive value.

