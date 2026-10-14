# Ecosystem source review — batch 012

This batch reviews SBPF, differential fuzzing, protocol vectors, local contract testing, audit reports, fault injection, alternate clients, and risk-console examples. See `research/registry/source-review-batch-012-2026-10-14.json` for each source's evidence, overlap and validation requirements.

## Findings

- SBPF's VM features vary by version; differential tests must pin the runtime version and feature set. Solfuzz-Agave can fuzz transaction/instruction/cost APIs but targets x86_64 Linux, so it is not a Windows runtime dependency.
- Protocol vectors can strengthen transaction decoder and fee tests, but their version coverage and expected-output provenance must be audited.
- Toxiproxy can add deterministic TCP latency/reset testing for RPC/feed recovery; it does not cover every gRPC, QUIC or UDP failure mode. Use only isolated test endpoints.
- Alternate validator clients can reveal protocol differences; one client is not automatically canonical. Sombra and OpenSol are advisory risk/agent concepts whose evidence and tool permissions need independent review.

## Verification

Official repository pages were reviewed. No fuzzer, validator, proxy, program PoC, or agent was run. No runtime code changed.
