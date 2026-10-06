# RuntimeRoot hash schema v2

## Scope and status

This independently reviewed change versions the inner `RuntimeRoot` hash so the root independently commits transaction-version support and the complete active-feature digest. At the time of that compatibility review, it did not change simulation-certificate outer schema `2.0.0`. It did not create RPC authenticity or grant transaction/execution authority. Independent Astra accepted the RuntimeRoot implementation snapshot after an isolated build and 16 focused tests: runtime source SHA-256 `EA3B0148156D2E13AB62AAC36B1C3770460C11CDB5CCA3581610A76798BFC730`, certificate source `4CB6BEB2293D86CF426B4DCCFC4B75289E045A111546D8B55E8BB5C8C9852FE5`, schema test `B5ED5B812572F9A7FC63B9D2A112DF44E3EA7FB31A76502AA235062DF3A21CB6`, and the original reviewed version of this document `DAF73E89F2A0CFE8B58B2D82DAF24CE8D563682C49B1FDCCFE9EEEB44E1F0FCB`. This document has since been updated to clarify RPC provenance; that editorial follow-up was reviewed separately. The later source comment clarifies that creation uses validated caller inputs and local defaults, not authenticated RPC observations. A subsequent simulation-certificate change emits outer schema `2.1.0` with explicit `cpiTraceStatus: UNAVAILABLE`, while continuing to verify legacy `2.0.0` certificates; it still creates no RPC authenticity or execution authority.

The root producer and the shared pure integrity functions (`verifyRuntimeRootIntegrity`, `verifyProgramRootIntegrity`, and `verifyProgramRootForestIntegrity`) live in `src/platform/truth/runtime-program-root.ts`. Certificate cloning in `src/platform/simulation/simulation-certificate.ts` calls those same validators, so certificate and compatibility checks have one source for the embedded root preimages. `EnvironmentCertificationEngine.verifyCompatibility()` validates both runtime roots and both complete program-root forests before comparing their fields/hashes; an invalid root produces an explicit invalid-root reason and cannot be treated as compatible. It still does not compare the full runtime-root hash for equality because context slots may advance, but both commitments must be internally valid. Creator-returned roots are frozen; ProgramRoot child trees are detached and recursively frozen so caller-owned children are not frozen or retained by reference. `UltimateExecutionPermitAuthority` and `UltimateExecutionRecordLedger` carry roots/hashes but do not recompute their inner preimages. No separately persisted standalone RuntimeRoot records were found; prior certificate payloads may contain schema-v1 roots.

## Version discrimination and preimages

An absent `runtimeRootHashSchemaVersion` means legacy schema v1. Explicit marker `1` is also accepted as v1; the marker is descriptive and is not added to the historical v1 preimage. V1 hashes exactly the prior JSON property sequence:

```json
{"cluster":...,"genesisHash":...,"epoch":...,"contextSlot":...,"agaveVersion":...,"activeFeatureSetHash":...,"resourcePolicyVersion":...}
```

The field `transactionVersionSupported` was absent from that preimage. The historical creator always emitted `all` and did not accept an override, so the shared integrity validator requires `all` for v1 rather than trusting a later uncommitted `legacy` or `v0` value. This preserves valid old roots while rejecting unauthenticated field edits. The outer simulation certificate evidence digest also binds its nested runtime-root fields.

New roots use `runtimeRootHashSchemaVersion: 2`. V2 hashes this ordered JSON object with SHA-256:

```json
{"runtimeRootHashSchemaVersion":2,"cluster":...,"genesisHash":...,"epoch":...,"contextSlot":...,"agaveVersion":...,"activeFeatureSetHash":...,"transactionVersionSupported":...,"resourcePolicyVersion":...}
```

The v2 `activeFeatureSetHash` is the full 64-character lowercase SHA-256 hex digest of `JSON.stringify([...activeFeatures].sort())`; v1 retains its previous 16-character lowercase-hex truncation and the verifier enforces that exact historical shape. V2 `transactionVersionSupported` is exactly one of `legacy`, `v0`, or `all`, and is committed in the inner preimage. The creator defaults it to `all` and accepts an explicit value for roots where the supported transaction version is known.

The creator validates data before hashing: epoch and context slot are nonnegative safe integers; the options object must contain only enumerable own data properties; active features must be a dense ordinary array of at most 4096 unique nonempty strings, each at most 1024 UTF-16 code units; transaction support and cluster must be members of their declared enums; and genesis hash, Agave version, and resource-policy version must be nonempty strings of at most 4096 code units. Resource policy defaults to `res_pol_2026_q4`. Getters, proxies, holes, duplicate feature names, malformed types, and out-of-range values fail rather than being coerced by JSON serialization. Factory defaults are illustrative local values: the root creator does not query Solana RPC, and valid hashes do not establish endpoint or feature-activation provenance. Solana `getVersion` reports node version plus an optional feature-set identifier, while Agave stores active feature state in its Bank; these concepts cannot be collapsed into the caller-provided feature-name digest ([Solana RPC](https://solana.com/docs/rpc/http), [Agave feature-gate setup](https://github.com/anza-xyz/agave/wiki/Feature-Gate-Setup-Process)).

Certificate validation accepts v1 roots with no marker (and explicit marker 1) under the exact v1 preimage and exact 16-character lowercase-hex feature digest, and v2 roots under the v2 preimage and full feature-digest format. Unknown explicit versions, null markers, malformed legacy feature digests, changed transaction support under a retained v2 hash, and a v2 hash whose marker is removed all fail closed.

## Runtime compatibility policy

`verifyCompatibility()` invalidates chain identity (`cluster` or `genesisHash`), feature-set, transaction-version-support, Agave-version, resource-policy, program-root drift, and a current runtime observation whose `contextSlot` is behind the certified root. It preserves the existing one-epoch grace rule. Context slots are not compared for exact equality because observations normally advance; a newer current slot remains compatible when the other fields match, while a stale current slot fails closed. Certificate construction separately enforces minimum/runtime/simulation slot ordering. This policy is intentionally conservative for runtime identity and mode changes while permitting newer observations in the same compatible environment.

## Verification matrix

- Recompute historical v1 roots byte-for-byte and build/verify certificates containing them.
- Show that changing v1 `transactionVersionSupported` does not change its legacy inner hash while certificate checks still apply its version compatibility rule.
- Show v2 `all` and `legacy` roots differ only in the committed mode and therefore have different root hashes.
- Reject a v1 non-16-character/lowercase-hex feature digest, a v2 mode changed without rehashing, a missing/unknown/null schema marker, and a v2 short/non-hex feature digest.
- Verify reordered v2 keys preserve the outer evidence hash because the certificate's canonical serializer handles object order.
- Reject invalid epochs/slots, malformed parameter objects, feature accessors/proxies/holes, over-limit arrays/text, empty or duplicate feature names, invalid enums, and non-string genesis/runtime labels without invoking getters.
- Verify runtime compatibility rejects chain, software, resource-policy, feature, transaction-support, and current-context regression while permitting a newer context slot under the existing epoch policy.

The tests cover a local construction/validation contract only. They do not attest that the runtime data came from a trustworthy Solana RPC or node process. ProgramRoot validation uses the historical ordered JSON preimage recursively, rejects accessors/proxies/cycles, and bounds each forest to 512 distinct nodes, per-node depth to 32, and direct children to 64. Compatibility and certificate validation share this validator; compatibility also requires each root's deployment slot, including nested CPI roots, not exceed its corresponding runtime context slot. Neither validates RPC provenance or makes the root an execution authority.
