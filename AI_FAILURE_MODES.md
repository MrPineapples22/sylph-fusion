# AI Failure Modes

| Condition | Current safe response |
|---|---|
| stale/conflicting/missing feature | JEV returns `NEED_MORE_EVIDENCE`; no zero fill |
| provider or schema anomaly | JEV returns `OOD` or evidence-blocked advisory result |
| Laya input snapshot mismatch | request is rejected |
| Laya unavailable | JEV remains advisory only; deterministic monitoring/safety continue |
| both unavailable | no impact on signer, reconciliation, provider health, or deterministic safety |
| calibration/training evidence absent | all rule outputs remain uncalibrated and non-promotable |

Durable replay divergence, model corruption, model artifact mismatch, and live shadow failures remain unimplemented release-gate work.

