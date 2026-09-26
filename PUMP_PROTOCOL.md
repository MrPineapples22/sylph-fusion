# Pump Protocol Semantics Baseline

Verified implementation: `src/market.ts` decodes Pump bonding curves with Pump SDK, validates owners, supports native-SOL curves, and uses SDK integer buy/sell quote functions. Completed curves are rejected for new curve entries.

Unverified/missing: a finalized Pump completion event decoder, program-versioned completion proof, PumpSwap destination decoder, pool ownership/mint-pair verification, and source-to-destination handoff certificate. A DEX Screener listing or Jupiter route is supporting evidence, not completion/migration proof.

The older candidate-snapshot fallback curve-completion calculation is semantically unsafe where initial curve reserve lineage is missing; it must not be used for lifecycle authority.

