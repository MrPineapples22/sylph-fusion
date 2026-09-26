# Protocol Semantics Baseline

Pump.fun/PumpSwap-oriented execution code, Solana token inspection, bonding-curve handling, Jupiter routing, and Jito bundle pathways are present. This does not establish protocol-neutral production semantics.

| Requirement | State | Evidence / gap |
|---|---|---|
| Token-2022 hazard inspection | PARTIAL | `metron-theseus.ts` and risk code inspect a subset of extensions |
| Token behavior certificate | MISSING | no versioned `TokenBehaviorCertificate` or downstream `UNVERIFIED_SEMANTICS` gate |
| Semantic differential verification | MISSING | no independent decoder or three-way economic-effect comparison |
| Migration/economic equivalence | DESIGNED_ONLY | no certified state-machine proof across supported venues |

Unknown semantics must fail closed for new entry and surface an explicit reason in projections.

