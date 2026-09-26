# AI Feature Schema

The current versioned schema is `astra-features-1` in `src/intelligence/astra/features.ts`. Each observation has a name, unit, window, evidence ID, source, correlation group, observed time, available time, confidence, conflict state, and explicit `UNKNOWN` missing policy.

The adapter rejects invalid time, schema, provenance, stale, conflicting, duplicate, and non-finite values. This is a useful in-memory integrity boundary, but it is not yet the four-clock durable feature contract required for training or certification.

