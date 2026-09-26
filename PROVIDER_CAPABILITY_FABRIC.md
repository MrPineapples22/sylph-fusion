# Provider Capability Fabric

`CapabilityFabric` holds explicit provider contracts and selects providers by capability, authority threshold, health state, freshness, latency, reliability, rate-limit pressure, and independence group. A provider is not eligible merely because it is in a website registry.

The current capability set covers chain account state, streams, discovery, post-graduation pool discovery, executable quote, authority analysis, and indexed market data. It is intentionally configuration-neutral pending a durable deployment contract.

Fallback is not asserted when the candidate is unhealthy, stale, unsuitable, or shares the selected provider’s declared independence group. A future runtime router must record an immutable failover receipt and must not upgrade authority silently.

