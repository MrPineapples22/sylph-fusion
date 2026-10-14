# Ecosystem source review — batch 008

This batch covers 15 sources spanning Metaplex asset indexing, shred transport, parsing, monitoring, account export, RPC observability, and Codama. Individual evidence and decisions are in `research/registry/source-review-batch-008-2026-10-14.json`.

## Findings

- Metaplex DAS/Aura projects focus on digital asset/NFT indexing, compressed asset proofs, and validator-backed indexing infrastructure. Their data is not a substitute for fungible-token execution truth.
- Several shred repositories expose tentative pre-confirmation observations. They must preserve source/slot provenance, FEC/decode completeness, and fork rollback status; fastest arrival is not canonical truth.
- The manifest's `rpcpool/yellowstone-vixen` URL redirects to `solana-rpc/shipstern`. The registry keeps the supplied manifest immutable and records the redirect as a provenance issue requiring review.
- Solana Microscope has a useful read-only monitoring pattern: make decode failures observable and export metrics. The RPC latency monitor is useful for deployment telemetry but processed-slot checks do not establish finalized completeness.
- Codama can generate clients from versioned IDLs, but generated parsers still need byte-level fixtures against deployed program behavior.

## Verification

Official repository pages and README content were reviewed. No external code was installed, no shred capture or live endpoint was used, and no runtime code changed. Each integration candidate remains bounded by its recorded validation requirements.
