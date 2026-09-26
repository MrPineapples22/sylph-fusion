# External Evidence Gaps

The repository has in-memory event/evidence/feature primitives, explicit unknown/missing states, provider health, and PumpPortal frame validation. It lacks the production boundary:

- durable append-only raw and normalized evidence revisions;
- provider capability, adapter and semantic versioning per observation;
- `stateAsKnownAt` based on knowledge/availability time;
- raw-parser differential replay;
- lineage/failure-domain independence certificates;
- schema-drift quarantine wired to adapters;
- runtime capability selection and challenger shadow traffic.

Until these exist, provider outputs remain non-certified inputs and historical model/replay claims are limited to process-local fixtures.

