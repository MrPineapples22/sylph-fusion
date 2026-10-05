# SYLPH FUSION — CERTIFICATION MATRIX (MECHANICALLY GENERATED)
Generated At: 2026-10-05T01:50:41.100Z

## Authority Invariant Verification
| Invariant | Description | Verification Mechanism | Status |
|---|---|---|---|
| INV_AUTH_001 | Authority Lattice Monotonicity | Rust Kernel + ActionProofBundle | VERIFIED |
| INV_AUTH_002 | Permit Single-Use / Anti-Replay | Rust Kernel Permit Consumption | VERIFIED |
| INV_AUTH_003 | Wall-Clock Expiration | System Time + Permit TTL | VERIFIED |
| INV_AUTH_004 | Block Height vs Slot Integrity | Branded Slot / BlockHeight Types | VERIFIED |
| INV_AUTH_005 | Stale State Root Rejection | State Root CAS + Hash Verification | VERIFIED |
| INV_AUTH_006 | Cryptographic Revocation | RevocationRegistry + Bloom Filter | VERIFIED |
| INV_AUTH_007 | Unknown Settlement Rejection | UNKNOWN Evidence Quarantine | VERIFIED |
| INV_AUTH_008 | Risk-Reducing Degradation | A2 Action Lattice Preservation | VERIFIED |
| INV_AUTH_009 | Release Root Integrity | Deterministic ReleaseRootManager | VERIFIED |
| INV_AUTH_010 | Config Root Immutability | ControlRootManager Hash Match | VERIFIED |
| INV_AUTH_011 | Exitability Verification | LiquidityDependencyGraph Stress | VERIFIED |
| INV_SYNTH_001 | No Synthetic Defaults | AST Scanner (audit-synthetic-authority.mjs) | 0 VIOLATIONS |
| INV_ENC_001 | Cross-Language Binary Parity | 100 Golden Vectors (TS <-> Rust) | 100% BIT-EXACT |
| INV_ROOT_001 | State Root Completeness | Single-Field Mutation Property Tests | 100% SENSITIVE |
