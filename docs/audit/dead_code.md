# Dead-code and generated-artifact audit

Generated 2026-09-23. Nothing was deleted.

## Generated or packaged output

- `dist/` is TypeScript output and source maps.
- `terminal/dist/` is bundled terminal output.
- `release/` contains candidate packages and duplicated build output.
- `node_modules/` is third-party installed content.

These directories should not be used as sources of truth during architecture changes. Their modifications in the current working tree are preserved.

## Candidate review targets

- The repository has 325 TypeScript files, more than 1,100 JavaScript files, and more than 1,000 source maps when generated output is included. This obscures source ownership.
- `jacks-one/` is a separate project with its own manifest and contracts. It is out of the trading runtime until an explicit dependency is documented.
- Multiple root-level reports and release artifacts record earlier claims. Treat them as historical evidence, not current certification.
- The intelligence tree contains many named engines; import presence in `master-orchestrator.ts` does not demonstrate they are reached from `fusion.ts`.

## Safe retirement protocol

Before removing any candidate: map importers, runtime entry points, package/release scripts, and test references; then remove in an isolated change with a build, targeted tests, and an updated inventory. Unknown files remain preserved.

