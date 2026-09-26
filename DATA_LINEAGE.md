# Data Lineage and Replay Baseline

Current data flows include provider observations, discovery caches, evidence registry entries, intelligence in-memory engines, projection view models, and terminal API responses. Provenance/freshness structures are present, but there is no single durable lineage from source observation through a production decision and settlement.

| Area | State | Gap |
|---|---|---|
| Evidence envelope | PARTIAL | observed/available time, commitment and parser hash exist; revisions overwrite in memory and required version/lineage fields are absent |
| Evidence independence | PARTIAL | correlation groups/temporal graph exist; no economic-source lineage or independence certificate |
| Point-in-time retrieval | PARTIAL | feature store supports as-of queries; availability-time enforcement is incomplete, so late facts can leak into history |
| Deterministic replay | PARTIAL / INSUFFICIENT | event-ID hashes exist, not production reducer replay/state-hash equality |
| Outcome/label finality | MISSING | no durable OBSERVED→FINAL lifecycle with provenance |

The required future watermark must bind slots, blockhashes, signatures, journal root, decoder/reducer versions, and canonical state hash. Any live/replay divergence must become an incident.

