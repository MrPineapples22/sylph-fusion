# Connectivity audit — 2026-10-12

## Current evidence

The repository's static connectivity compiler completed against the current checkout and found:

- 682 TypeScript source modules and 1,113 static import/re-export edges under `src/`.
- Zero TypeScript compiler/configuration diagnostics.
- All four configured authority modules reachable from `src/fusion.ts` in the compiler's directed graph; zero duplicate configured authority exports.
- A passing source-bound test receipt for `npm run build:engine && npm run test:all`, receipt hash `c817cbc76a38390c0f271e922894bb5452e2aa1c06ac7047530bea3ab1e175a4`.
- Highest static level C4. The repository's convergence test stopped at C4 because no eligible runtime telemetry span was supplied.

The full receipt-producing test run passed: 622 core, 760 intelligence, 1,005 platform, and 316 terminal tests. The Windows package-candidate test also confirms that `terminal/src/learning-projection.js`, now imported by the server, is included in the candidate package. The UI production bundle built successfully. Four focused tests cover the terminal/source connectivity cross-check.

## Terminal runtime cross-check

The static compiler's graph is limited to `src/`, so a separate read-only cross-check now compares the package import closure from `terminal/server.mjs` with that TypeScript inventory. For the current built output it found 372 files in the terminal closure, including 354 `dist/*.js` modules. All 354 mapped one-to-one to source files whose hashes match the static graph. Of the 139 modules labeled ORPHAN by the scoped graph, 15 are imported by the terminal server's built runtime closure, including `master-orchestrator.ts`, `operator-read-model.ts`, and `projection-service.ts`. There were no unmapped built JavaScript modules.

This narrows the meaning of that ORPHAN count: those 15 have no incoming TypeScript-to-TypeScript edge in the `src/` graph, but are reachable from the terminal server through generated `dist/` imports. The other 124 still need review; this cross-check does not prove their behavior or that every import is exercised by an HTTP request. The audit recomputes the source manifest root, checks every source hash, validates orphan records against the graph, and rejects unmapped output instead of guessing. Reproduce after building and running the static compiler with `npm run audit:connectivity:terminal`.

## What this does not establish

The static compiler only inventories TypeScript included under `src/`. It excludes terminal JavaScript/MJS, scripts, Rust, generated `dist/`, and external services. It therefore cannot describe the complete server-to-source import graph. For example, `terminal/server.mjs` imports the built `dist/intelligence/master-orchestrator.js` and `dist/operator-read-model.js`; their TypeScript source modules can appear as zero-incoming in the narrower `src/` graph. The reported 139 ORPHAN entries mean zero incoming edges in that scoped graph; they are leads for review, not proof of dead code.

C4 is static integration evidence, not a claim that every candidate, UI, provider, and execution path is operationally connected. C5–C10 remain unproven: no physical runtime span, signed continuity, authoritative live effect, full deterministic replay campaign, fault-containment campaign, or real canary evidence was supplied by this audit. The release remains not certified and paper/research only.

Generated machine-readable artifacts are in `artifacts/connectivity/` when the audit command is run. Reproduce with:

```text
npm run audit:connectivity:static
npm run audit:convergence:test
```

These reports bind to source hashes and local test output, but the receipt issuer is unauthenticated and does not independently attest dependency installation or hosted execution.
