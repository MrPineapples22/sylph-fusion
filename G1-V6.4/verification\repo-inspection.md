# Repository and revision inspection

Inspected through the connected GitHub repository integration on 2026-11-19.

- Repository: `MrPineapples22/sylph-fusion`
- Visibility: public; not archived
- Connected account permissions: admin, maintain, pull, push, triage
- Default branch: `main`
- Selected immutable base commit: `f5c31177f2b8d79cdf5e3662e4049ac44b9562b2`
- Commit signature: GitHub reported the commit as unsigned (`verified: false`, reason `unsigned`).
- `.github/workflows` at `main`: GitHub contents API returned 404; no workflow directory exists at that revision.
- Scratch branch created for CI preflight: `codex/g1-v6-4-ci-p0`, based on the exact commit above.

GitHub documents that `workflow_dispatch` requires the workflow file on the default branch. The scratch workflow will therefore include a branch-restricted first-run trigger as well as manual dispatch. It will not modify `main`; manual dispatch from the UI remains unavailable until the workflow is merged to the default branch.

The connected GitHub account has repository write access. Workflow token permissions will be limited to `contents: read`. No secrets, wallet material, or local historical evidence are included in CI.
