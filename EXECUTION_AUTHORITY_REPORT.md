# Execution Authority Report

`src/platform/execution/execution-authority-readiness.ts` is the new central capability policy. It requires current, healthy attestations for execution review, live reconciliation, signer, firewall, journal, providers, and simulation. Each attestation requires self-test, fixture-test, live probe, configuration hash, implementation version, and expiry.

Until a real adapter produces those attestations, `open`, `increase`, `reduce`, `close`, and `reconcile` remain `BLOCKED`. The policy has no UI, model, strategy, provider, or wallet override.

