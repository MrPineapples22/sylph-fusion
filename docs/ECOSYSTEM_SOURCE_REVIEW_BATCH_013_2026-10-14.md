# Ecosystem source review — batch 013

This batch reviews 15 treasury, bridge, token-wrap, and secrets/identity sources. Per-source status, provenance, risk and validation are in `research/registry/source-review-batch-013-2026-10-14.json`.

## Findings

- Squads sources show useful separation between policy, proposal, threshold approval and execution, alongside risks from key concentration, lost thresholds, settings authority, forks and timelocks. The Smart Account repository is AGPL-3.0 and documents verifiable-build steps; none of these sources changes SYLPH signing authority.
- Wormhole and deBridge provide cross-chain messaging/transfer infrastructure. Source confirmation, attestation, destination execution and settlement are separate states and outside the current Solana-only trading path.
- The deBridge meta-aggregation API is an additional router layer; any comparison must use executable net proceeds and preserve underlying quote provenance.
- Vault could not be substantively inspected in this pass; the record deliberately leaves features and licensing unverified. Infisical, SOPS, Smallstep and SPIRE are deployment/security patterns, not wallet-signer substitutes.
- Service identity and secret storage must stay distinct from transaction authorization.

## Verification

Public repository pages were reviewed where available. No secrets were opened, no signing or custody service was configured, no bridge transfer was initiated, and runtime code was unchanged.
