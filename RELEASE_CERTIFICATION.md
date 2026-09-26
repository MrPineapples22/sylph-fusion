# SOL/SYLPH Release Certification Baseline

Current certification state: **UNVERIFIED CANDIDATE — PRODUCTION RELEASE BLOCKED**.

This is the result encoded by `src/platform/certification/release-certification.ts`, which initializes mandatory gates as incomplete or blocked and requires current release evidence. It is not an administrative label that can be changed by a build succeeding.

## Present evidence

- Core, intelligence/platform, and terminal test suites have passed in the current workspace audit run.
- Engine build and paper-mode configuration check have passed.
- The runnable operator surface reports simulation/paper capability and blocks execution review, live reconciliation, and durable operator ledger functions.
- A live configuration preflight requires a keypair path and two distinct RPC URLs, while engine startup separately rejects live signing because an isolated durable signer is not configured.
- 2026-09-23 containment pass: a live order that reaches block-height expiry now persists `LIVE_RECONCILIATION_UNRESOLVED` and blocks all automated economic actions pending finalized wallet reconciliation. The terminal is loopback-only; browser command failure cannot create a second paper ledger; experimental platform and intelligence signers default-deny and label opt-in artifacts as simulation only.

## Blocking evidence required for production review

1. Independently reviewed isolated signer service and explicit transaction policy firewall.
2. Mainnet-safe balance, order, fill, and ambiguous-transaction reconciliation with durable journal evidence.
3. Tested provider capability/failure matrix with independent primary/challenger paths.
4. Deterministic replay and point-in-time evidence tied to the deployed decision path.
5. Adversarial, restart, outage, and soak evidence for the exact release build.
6. Two-Astra independent review of risk/execution and verification/certification conclusions.

Until those artifacts exist, approved capability is simulation, research, and non-financial operator observation only. Prohibited capability is any live transaction or production-release claim.

## Current containment evidence

- `src/fusion.ts` retains unresolved expired-order evidence and blocks further automation.
- `terminal/server.mjs` listens only on `127.0.0.1`; `terminal/src/submit-paper-order.js` rejects unavailable command-gateway requests rather than falling back silently.
- `src/platform/orchestrator.ts` returns `ECONOMIC_EXECUTION_UNAVAILABLE` / `ECONOMIC_SETTLEMENT_UNAVAILABLE` before synthetic execution or settlement effects.
- `src/platform/signing/signer-service.ts` and `src/intelligence/vault/vault-signer.ts` default-deny synthetic signing. Their explicitly enabled test artifacts are marked as simulations.
- `src/intelligence/verification/edison-verification.ts` cannot report success: its 25 scenario descriptions are explicitly marked unimplemented until they are bound to executable, independently asserted fixtures.
- HELIOS/SOLARIS routing rejects unknown leader schedules and unregistered TPU endpoints; direct TPU transport is disabled by default. No synthetic leader, Jito status, validator address, or direct datagram fallback is permitted.
- SOLARIS treats fallback fee policy as unobserved and blocks route planning until fresh live tip and observed contention evidence are present.
- Provider-health defaults now explicitly report no configuration or authentication; PumpPortal and Solana RPC remain stale/unavailable until runtime configuration and validated observations are supplied.
- Operator certificate and twin panels render absent proof data as unverified rather than passing or permitted.
- The primary terminal, legacy app, shared market launcher, and core risk configuration require explicit market-adapter endpoints. Unconfigured search/risk paths reject before network I/O.

These are containment controls, not production evidence. They do not close any mandatory production gate.
