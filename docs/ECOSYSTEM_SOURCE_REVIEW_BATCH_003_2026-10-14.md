# Ecosystem source review — batch 003

This batch covers Raydium SDK V2, Jito Searcher Examples, LiteSVM, and Anchor-LiteSVM. Detailed provenance, findings, local overlap, risks and validation requirements are in `research/registry/source-review-batch-003-2026-10-14.json`.

## Integration decisions

- **Raydium SDK V2:** SYLPH already has a read-only pool cross-check with identity checks and a clear warning that reported TVL is not executable depth. The upstream SDK is marked GPL-3.0, so do not add it as a dependency before license review. A future quote path needs on-chain pool state, route/pool type, token extensions, fees and slot freshness.
- **Jito Searcher Examples:** useful references for challenge-response auth and bundle event types; examples require a keypair and Block Engine access and can submit signed bundles. The repository was not run. Current local probe is connectivity-only, so no submission or landing claim changes.
- **LiteSVM and Anchor-LiteSVM:** both can improve program-level tests, with Apache-2.0 and MIT licenses respectively. Their account-write and signature-bypass test features must remain isolated from production evidence. This checkout has no local Rust/Anchor program target, so adoption is deferred pending a concrete program fixture need.

## Verification

`node --test terminal/test/raydium-pool-research.test.mjs terminal/test/jito-block-engine-health.test.mjs` passed **5/5**. This verifies the current Raydium identity/read-only adapter and Jito connectivity-only state; it does not exercise upstream SDKs or LiteSVM.

No dependency, signer, broadcast, risk, capital, or running service was changed.
