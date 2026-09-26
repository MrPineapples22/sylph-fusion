# Configuration inventory

Generated 2026-09-23. Secret values were not read or recorded.

| Area | Authority observed | Notes |
|---|---|---|
| Core environment | `src/config.ts` | Zod validation for RPC, modes, limits, and selected endpoints. |
| Snapshot authority | `src/config-authority.ts` | Versioned/frozen/hashable configuration abstraction. |
| Direct consumers | `src/app.ts`, `src/fusion.ts`, `scripts/*`, terminal server | Several direct `process.env` reads remain. |
| Operator template | `.env.example` | Documents RPC/WSS, market providers, Jupiter, timeout, and execution-related fields. |
| Release packaging | `scripts/package-windows-release.mjs` | Copies a template and explicitly excludes user credentials/data. |

## Gaps

1. There is no demonstrated single bootstrap sequence that validates, resolves, freezes, hashes, and publishes one snapshot for every runtime path.
2. Direct environment reads can create configuration drift after startup.
3. A credential-safe inventory records names and owners only; it must never copy `.env` values into documentation, logs, artifacts, or UI.

## Phase-1 acceptance evidence

One `ConfigurationRegistry` snapshot hash must appear in every execution journal, projection, and capability decision; a test must prove that post-freeze mutation cannot alter an active decision.

