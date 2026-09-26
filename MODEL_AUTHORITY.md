# Model Authority Boundary

JEV and Laya are advisory-only. The permitted result is `ADVISE`, `ABSTAIN`, or `REQUIRE_REVIEW`; no result is a transaction, capital grant, signer request, provider override, settlement mutation, or safety-policy change.

The model seam is feature context → advisory decision/assessment → optional read-only projection. The deterministic authority chain remains Guardian → Capital → Safety → Execution → isolated signer → reconciliation. Current runtime does not integrate this advisory seam into that chain.

