# JEV Advisory Engine

Current state: **PARTIAL — deterministic advisory pilot**.

`src/intelligence/astra/jev-laya.ts` implements JEV as a fast bounded rule engine over an immutable `AstraFeatureContext`. It accepts no provider clients, secrets, commands, execution authority, wallet, or signer. Every output is marked `ADVISORY_ONLY` and `RULE_UNCALIBRATED`.

It produces high-interest, watch, low-interest, need-more-evidence, or OOD outcomes, with one centralized escalation policy. Stale, invalid, conflicting, or insufficient observations produce an explicit safe outcome rather than zero-filled features.

Not implemented: trained artifact, calibration, runtime/shadow integration, empirical latency SLO, durable inference persistence, and promotion evidence.

