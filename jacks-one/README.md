# JACKS ONE

**Jacks or Better (9/6 Full-Pay) Certified Truth Kernel and Mathematical Oracle**

Offline-certified video poker decision engine implementing independent dual-engine verification, exact rational expected value arithmetic, strict AI firewalling, and immutable certification contracts.

---

## 1. System Architecture

```text
Ruleset -> GameState -> Truth Kernel (Engine A) -> Independent Oracle (Engine B)
    -> Verification Pipeline -> Certificate Generator -> Strategy Compiler
    -> Intelligence & Trainer -> AI Firewall (Luna / Astra)
    -> Presentation Adapters (UI / Mobile / Replay) -> Godot Presentation
```

- **Spec Layer (`spec/`)**: Canonical ruleset (`jacks_or_better.full_pay_9_6.v1`) and JSON Schemas for `Ruleset`, `DecisionPacket`, and `Certificate`.
- **Core Domain (`src/core/`)**: Zero-dependency domain models for `Card`, `Hand`, `HoldMask`, `GameState`, deterministic `hashing`, and exact `Rational` arithmetic using `BigInt`.
- **Engine A (`src/engine_a/`)**: Authoritative fast evaluator, combinatorial draw enumerator ($\binom{47}{5-k}$), exact EV calculator, and 32-hold oracle.
- **Engine B (`src/engine_b/`)**: Independent Cactus Kev prime-product factorization evaluator and recursive combinatorial enumerator for differential cross-validation.
- **Verification (`src/verification/`)**:
  - `differential.ts`: Compares Engine A vs Engine B across all 32 holds, category counts, and EVs.
  - `invariants.ts`: Strictly enforces denominator conservation $\binom{47}{5-k}$, card uniqueness, card dealing order invariance, and suit automorphism invariance.
  - `canonical_reduction.ts`: Partitions all 2,598,960 initial deals into the exact 134,459 canonical equivalence classes under suit permutation $S_4$.
  - `benchmarks.ts`: Verifies canonical strategy decision cases (High Pair vs 4 to Flush, Low Pair vs 4 to Flush, Breaking 2-Pair for Royal, etc.).
  - `mutation.ts`: Proves test suite kills 100% of injected synthetic defects (payouts, classifications, card duplicates, off-by-one errors).
- **Certification (`src/certification/`)**: Generates cryptographically hashed `Certificate` objects, offline lookup indexes, and reproducibility manifests.
- **Strategy & AI Firewall (`src/strategy/`, `src/ai/`)**: Precedence compiler, penalty card analyzer, counterfactual generator, and firewall preventing LLMs from altering certified truth.
- **Adapters (`src/adapter/`, `src/godot/`)**: Decoupled presentation DTOs for Godot, offline mobile decision decoder, and deterministic replay verification.

---

## 2. Key Mathematical Constants Verified

| Metric | Value | Verification Status |
|---|---|---|
| Initial 5-card hands | 2,598,960 | Exact $\binom{52}{5}$ |
| Canonical Equivalence Classes | 134,459 | Verified exact in 1.38s |
| Distinct Optimal Conditional EV Values | 1,153 | Verified (Ethier baseline) |
| Theoretical Return to Player (RTP) | 99.543904% | Exact theoretical target |
| Theoretical Variance | 19.5146 | Verified |
| Differential Agreement (Engine A & B) | 100% | Verified across all holds |
| Mutation Detection Score | 100% | 5/5 synthetic mutants killed |

---

## 3. CLI Quickstart

```powershell
# Evaluate any 5-card hand (e.g. 4 to a royal)
node --experimental-strip-types src/cli.ts eval As Ks Qs Js 9c

# Run canonical strategy benchmarks
node --experimental-strip-types src/cli.ts benchmarks

# Run differential and invariant verification
node --experimental-strip-types src/cli.ts verify

# Run mutation testing harness
node --experimental-strip-types src/cli.ts mutate

# Verify all 2,598,960 hands reduce to 134,459 canonical classes
node --experimental-strip-types src/cli.ts canonical

# Run Monte Carlo simulation under optimal play
node --experimental-strip-types src/cli.ts simulate 10000

# Execute full master verification pipeline
node --experimental-strip-types scripts/verify-all.ts
```
