# Windows candidate provenance

The optional `Attested Windows candidate` workflow builds and tests the actual Windows package, creates a gzip-compressed tar archive, records its digest and checked-out source commit/tree, and attests **both** archive and identity sidecar through GitHub's Sigstore integration. It is manual and restricted to the canonical repository's `main` branch. It uploads the two subjects and bundle for 30 days. It does not deploy, create a GitHub release, start the engine, provision keys, award certification, or enable trading.

The workflow uses the existing engine/terminal build, offline suites, evidence-register check, and Windows candidate packager. The archive contains the candidate's complete hash inventory, launchers, locked dependency manifests, and runtime assets, including `.env.example`; no wallet, `.env`, database, or installed dependencies are copied. Node 24.21.0 and pnpm 11.19.0 match the existing verify workflow. New attestation/upload actions are pinned to full commit IDs resolved from their v4/v7 tags on 2026-10-07. Build dependencies and GitHub-hosted Windows image are not hermetic or reproducible-build guarantees.

## Verify a downloaded candidate

Use a separately trusted installation of this repository's verifier and a current official GitHub CLI supporting all required flags. Obtain the expected 40-character source commit and tree IDs from an independently reviewed repository revision. Do not copy them from the downloaded identity file as a substitute for that review. For the local non-reusable workflow, the signer workflow revision must equal that source commit.

```powershell
node scripts/candidate-provenance.mjs C:\downloads\sylph-windows-candidate.tar.gz C:\downloads\candidate-identity.json C:\downloads\attestation.jsonl EXPECTED_COMMIT_SHA EXPECTED_TREE_SHA
```

Replace the bundle filename with the actual downloaded `bundle-path` artifact basename. No verification result is accepted as an input. The script invokes `gh attestation verify` on both files, using the bundle, and requires the canonical repository, exact workflow certificate identity, GitHub OIDC issuer, `refs/heads/main`, expected source and signer commit, SLSA v1 predicate, and a hosted runner. GitHub CLI supplies cryptographic signature/certificate/transparency verification against its Sigstore trust roots. The script additionally requires a matching verified SHA-256 subject, exact sidecar schema, independently supplied source/tree expectations, archive digest, and unchanged inputs across verification. Invalid/missing files, unavailable or failing CLI, unsupported flags, malformed output, wrong policy, and changes during verification deny the result. Bundle verification may still require network access for the CLI's trust-root refresh; this is not a fully offline promise.

Success emits `VERIFIED_CANDIDATE_PROVENANCE` with `runtimeAuthority: false`, `certificationGranted: false`, and `extractedRuntimeVerified: false`. The JSON receipt is informational and can be forged by a local writer: rerun verification on the artifacts rather than trusting a saved receipt. Verification assumes a trusted local CLI, verifier, operating system, filesystem, and policy inputs. Before/after hashes detect ordinary concurrent changes, not a hostile host's file-substitution attacks.

## Remaining boundary

This demonstrates that the selected GitHub workflow signed the two candidate subjects at the selected source revision. It does **not** establish an independently isolated trusted builder. The workflow can control provenance predicate contents and the source-tree sidecar, and it can be changed in the selected commit. Exact signer revision pinning makes that policy reviewable; it does not replace review. No SLSA Build L3 claim is made. An independently governed reusable build/attest workflow with restricted inputs and protected release policy remains separate work.

The verifier does not extract an archive, authenticate subsequently installed dependencies, measure the running process, bind a configured SQLite database, or connect its receipt to `RuntimeTelemetryOptions` or `BuildSealAuthority`. The source IDs accepted by telemetry remain host assertions. Supplying IDs from this receipt does not prove that a process loaded these verified bytes. A reviewed extraction/inventory/dependency/launch measurement contract and real runtime evidence are still required before any C5 claim; BuildSeal's production denial and C5–C10 gates remain intact.

The new workflow has not been dispatched or proven on GitHub. A maintainer must review and land it on `main`, confirm artifact-attestation availability and policy, run it, preserve the downloaded subjects/bundle before retention expiry, and execute the real verifier against separately approved source/tree IDs. Local process stubs exercise orchestration and denial behavior only; they are not evidence of a genuine Sigstore signature or a successful hosted build.

## Research basis

- [GitHub actions/attest](https://github.com/actions/attest) specifies the supported provenance mode, subject paths, and bundle output.
- [GitHub CLI verification](https://cli.github.com/manual/gh_attestation_verify) documents exact source/signer policy flags and warns that predicate fields are workflow-controlled; certificate identity and witnessed timestamps have a different trust basis.
- [SLSA v1.2 artifact verification](https://slsa.dev/spec/v1.2/verifying-artifacts) requires signature, builder, subject digest, and expected source/build checks. This candidate pipeline is partial provenance infrastructure, not a production authorization implementation.
