# Ecosystem source review — batch 011

This batch reviews Orca Whirlpools, an unavailable Raydium project, transaction delivery and Jito infrastructure, and the Anza SVM. Per-source details are recorded in `research/registry/source-review-batch-011-2026-10-14.json`.

## Findings

- Orca's current repo separates core quote math, generated clients, and high-level SDKs; its README says the legacy web3.js SDK remains the applicable option for projects that have not migrated to Kit. Concentrated liquidity requires tick-aware quote and simulation fixtures.
- The listed Raydium launchpad repository returned 404, so its status, code and license remain unknown.
- Jito RPC bindings, tip routing, Jito-Solana validator changes, and transaction send helpers are different layers. Submission acknowledgment or tip-account availability is not bundle landing, settlement, or net profitability.
- Lite RPC and transport tools suggest useful send/confirmation state handling, but must be evaluated against duplicate, timeout, ambiguous-submission, and fee-reconciliation cases.
- Firedancer and Anza SVM are valuable for client diversity and deterministic simulation tests, respectively. Neither turns a local execution result into network finality evidence.

## Verification

Official repository pages and descriptions were reviewed. No SDK was installed; no transaction was signed or broadcast; no validator or local SVM was run. Runtime code was unchanged.
