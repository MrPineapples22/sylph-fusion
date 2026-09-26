# Signing Security Architecture Baseline

Current state: **fail-closed; production signing unavailable**.

Existing local primitives include an AWS KMS Ed25519 adapter that pins a concrete key and verifies signatures, plus `DurableLiveSigner`, which commits a single-use signing intent before crossing a signer boundary. The engine nevertheless rejects all live startup, correctly preventing the legacy application-owned-key execution path.

`src/platform/signing/signing-firewall.ts` is a new fail-closed pre-signing policy boundary. It recomputes the message hash, binds signer/fee payer/policy/intent/simulation, rejects replay, requires journal/provider/kill-switch gates, and denies incomplete decoding, unapproved programs, altered economics, or disabled mainnet. It deliberately needs a separate real Solana message decoder and isolated service deployment before it can be used for production.

Required production topology:

```text
intent → simulation → frozen decoded message → signing firewall
→ isolated signer → immutable signed wire → broadcaster → reconciler → durable evidence
```

The application process must never hold a private key or KMS signing permission.

