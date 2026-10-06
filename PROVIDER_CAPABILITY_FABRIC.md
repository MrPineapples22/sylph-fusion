# Provider Capability Fabric

`CapabilityFabric` holds explicit provider contracts and selects providers by capability, authority threshold, health state, freshness, latency, reliability, rate-limit pressure, and independence group. A provider is not eligible merely because it is in a website registry.

The current capability set covers chain account state, streams, discovery, post-graduation pool discovery, executable quote, authority analysis, and indexed market data. It is intentionally configuration-neutral pending a durable deployment contract.

Fallback is not asserted when the candidate is unhealthy, stale, unsuitable, or shares the selected provider’s declared independence group. A future runtime router must record an immutable failover receipt and must not upgrade authority silently.

Runtime provider health carries an explicit authentication requirement: `REQUIRED`, `NOT_REQUIRED`, or `UNKNOWN`. Omitted or invalid classifications default to `UNKNOWN` and fail closed for capability and authoritative market-feed freshness, even if a caller supplies a truthy authentication value. Endpoint configuration alone does not prove authentication. `NOT_REQUIRED` is reserved for exact reviewed public-read endpoints and operations; custom origins and paths remain `UNKNOWN`. MarketHub's PumpPortal classification is limited to the canonical WSS `/api/data` endpoint on the default port, with no URL credentials or fragment and either no query or one nonempty `api-key`; its only subscription is `subscribeNewToken`. DexScreener classification is limited to the canonical HTTPS base origin/root with no credentials, query, or fragment. A required-auth provider is eligible only after literal-boolean authentication verification, and it must still satisfy transport, validated-observation, freshness, circuit, and rate-limit checks.

`authenticated` is still a trusted in-process caller assertion; the tracker does not prove credential possession, provider identity, or observation provenance. Current production MarketHub call sites set it to `false`; tests exercise the positive path. A future required-auth integration must bind a positive value to adapter-confirmed authentication evidence before relying on this capability gate. MarketHub currently leaves RugCheck and custom Solana RPC endpoints unknown.

