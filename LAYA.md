# Laya Advisory Specialist

Current state: **PARTIAL — deterministic advisory pilot**.

Laya consumes the exact JEV-bound feature snapshot and rejects a token/snapshot mismatch. It produces a structured advisory assessment with hypotheses, evidence IDs, uncertainty, OOD state, requested next evidence, and explicit agreement/disagreement with JEV.

It does not query raw providers or access filesystem, credentials, wallet keys, commands, execution, risk limits, capital, or settlement. It is not a trained specialist and has no demonstrated incremental value over JEV; those are release blockers.

