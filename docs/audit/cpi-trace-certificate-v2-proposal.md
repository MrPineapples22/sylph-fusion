# CPI trace certificate schema proposal

## Status

Research/design proposal only. Astra Protocol and Astra Verification accepted this design at SHA-256 `2BD62756754B397B17210D9220792039CBBAB8098B33BBBDB48A067828E32F85`; that hash includes all deterministic schema and trust-boundary rules below. Subsequent edits to this document record review and fixture status only. No certificate schema change is authorized by this proposal.

Keep exact legacy verifier behavior for outer schemas `2.0.0` and `2.1.0`. A candidate additive schema is `2.2.0`, with an explicit normalization version. Until the revised candidate passes protocol and verification review, the builder emits `2.1.0` with `cpiTraceStatus: UNAVAILABLE` and the verifier rejects trace claims on legacy schemas.

## Current boundary

`unsigned-observation-verifier.ts` asks `simulateTransaction` for `innerInstructions: true`, validates bounded parsed or partially decoded instructions, and returns counts and a hash in a private, non-authorizing receipt. Its current `COMPLETE` value means only that every reported instruction had a non-null stack height; the receipt comment explicitly limits this to reported trace-field coverage. It does not check whether the heights form a valid parent path, and it cannot prove that the provider reported every CPI.

The observer rejects every non-null simulation error before issuing a receipt. `simulation-certificate.ts` cannot accept the observer's private receipt and has no production caller. Its `cpiGraphHash` is a legacy flat invoked-program-list digest, not a CPI graph. Do not bridge these APIs by trusting caller-supplied counts/status or by treating unkeyed hashes as provider authenticity.

## Candidate schema 2.2.0 payload

Use terms that distinguish structure from coverage. A candidate `cpiTrace` contains:

- `normalizationVersion: 1`;
- `status: UNAVAILABLE | PARTIAL | STRUCTURALLY_VALID`;
- `coverage: REPORTED_NODES_ONLY`, a fixed scope statement, not a provider completeness claim;
- `recordingRequested: boolean` and `responseFieldState: MISSING | NULL | ARRAY`, bound to the exact request and response;
- `topLevelInstructionCount` bound to the exact simulated message;
- ordered sparse groups `{ topLevelIndex, instructions[] }`;
- each instruction's validated `programId`, raw `stackHeight` (integer or null), validated source-format tag, canonical instruction-field digest, and parent reference when reconstructable;
- `traceHash` over the canonical normalized trace, including status, indexes, instruction order, heights, and parent references.

`STRUCTURALLY_VALID` means every returned node has the required fields and a deterministic parent under the versioned algorithm. It does **not** mean the provider returned every executed CPI or that a transaction fully executed. `PARTIAL` means the response is present but at least one node has an absent/null stack height, so the affected group's parent path is unresolved. `UNAVAILABLE` means recording was not bound to the request, or the requested response field is missing/null. Its canonical normalized form always has `groups: []`, `status: UNAVAILABLE`, and preserves `recordingRequested` and `responseFieldState`. These values are included in `traceHash`, so unrequested/missing, requested/missing, and requested/null are distinct. A present empty array is `STRUCTURALLY_VALID` only when recording was requested; it has `responseFieldState: ARRAY` and `groups: []`. If recording was unbound, even a present array is `UNAVAILABLE` with empty groups and `responseFieldState: ARRAY`. Malformed or contradictory values are rejected, not downgraded to a status.

If a group contains any unknown height, do not emit parent edges for that group; this prevents an unknown node from being skipped while a later node is incorrectly connected to an earlier ancestor. Known independent groups may retain their reconstructed edges while the aggregate status is `PARTIAL`.

The RPC simulation encoding has exactly two instruction shapes. Fully parsed form requires `{ parsed, program, programId }`; partially decoded form requires `{ accounts, data, programId }`. `stackHeight` may be omitted, null, or a valid integer and is normalized to null when omitted. The parsed form may not include `accounts` or `data`; the partially decoded form may not include `parsed` or `program`. No other keys are accepted in either variant. Simulation responses do not use compiled account indexes. Keep the separate Transaction-v1 decoder's compiled form behind its own adapter. Hash only a bounded, canonical, validated field set. An instruction digest is a commitment to those fields, not proof they are authentic or semantically understood.

## Exact trace canonicalization and hash domains

`normalizationVersion: 1` uses the following exact versioned encoding. All strings are UTF-8. SHA-256 digests are lowercase hexadecimal. `traceHash` is `SHA256(UTF8("SYLPH_CPI_TRACE\0v1\0") || UTF8(encode(tracePayloadWithoutTraceHash)))`. An instruction's `instructionHash` is `SHA256(UTF8("SYLPH_CPI_INSTRUCTION\0v1\0") || UTF8(encode(instructionSourceFields)))`.

The recursive `encode(value)` is defined only for null, booleans, finite numbers, strings, dense arrays, and plain objects with string keys:

- null → `null;`
- booleans → `boolean:true;` or `boolean:false;`
- finite numbers → `number:` followed by ECMAScript `JSON.stringify(number)` and `;`; negative zero therefore encodes as `0`; non-finite numbers reject;
- strings → `string:` followed by ECMAScript `JSON.stringify(string)` and `;`;
- arrays → `array:` + encoded elements in array order + `end-array;`;
- objects → `object:{` + entries sorted by JavaScript UTF-16 code-unit key order, each encoded key then encoded value + `}end-object;`.

Reject sparse arrays, symbol keys, accessors, proxies, cycles, and non-plain objects before encoding. The parsed variant hashes `{kind:"PARSED", parsed, program, programId}`; the partially decoded variant hashes `{kind:"PARTIALLY_DECODED", accounts, data, programId}`. Nested parsed object property order is therefore canonicalized recursively. `stackHeight` is excluded from `instructionHash` because it is separately present in the ordered trace preimage. The normalized node contains either `{kind:"TOP_LEVEL", topLevelIndex}` or `{kind:"INNER", topLevelIndex, innerIndex}` as `parent`; `innerIndex` is the zero-based position in that group's `instructions` array. This makes parent references unambiguous across groups.

`traceHash` preimage fields are exactly, in the logical schema: `normalizationVersion`, `status`, `coverage`, `recordingRequested`, `responseFieldState`, `topLevelInstructionCount`, `groups`; each group has exactly `topLevelIndex`, `instructions`; each normalized instruction has exactly `programId`, `stackHeight`, `sourceKind`, `instructionHash`, and `parent` only when reconstructed. Object field order does not affect the hash because `encode` sorts keys. The outer certificate `evidenceHash` remains under its existing domain and codec; changing that codec requires a separate schema migration.

Initial exact state vectors use `topLevelInstructionCount: 1` and `groups: []`; the following SHA-256 values were calculated with a standalone reference encoder implementing the recursive rules above, independently of the project certificate code:

| State | `recordingRequested` | `responseFieldState` | `status` | `traceHash` |
|---|---:|---|---|---|
| Unrequested, missing | `false` | `MISSING` | `UNAVAILABLE` | `bd2bb19867a010cbe324e4918193c1d27da0b01e114eaa99db573bfba8f0991d` |
| Requested, missing | `true` | `MISSING` | `UNAVAILABLE` | `86f1175c9f209037ad24464820c9e0d012a84eaaef60bdf29daf4198a2868e7a` |
| Requested, null | `true` | `NULL` | `UNAVAILABLE` | `c3facf6df6fb7e69e58ae2cccb52106bfdc001923aa3e676a5691d7b06b8cce1` |
| Unrequested, array | `false` | `ARRAY` | `UNAVAILABLE` | `82406e65d7de1615e7b63776dd5416925995d0815aab944c5c9c5cfd03b16ef2` |
| Requested, empty array | `true` | `ARRAY` | `STRUCTURALLY_VALID` | `595744ff14a2554c8c73d76b4d32a6851a79f81509d96c92e313ca2b52b9808f` |

## Group ordering and parent reconstruction

Solana defines a group `index` as the top-level transaction instruction that made the CPI. Current and v2.3.13 Agave extract CPI entries in invocation order, group them by top-level instruction, enumerate groups in increasing top-level index, and filter empty groups. Therefore:

- require unique, strictly increasing, in-range group indexes;
- allow sparse group indexes; missing indexes do not imply an incomplete trace;
- reject empty individual groups as noncanonical Agave output;
- treat an empty outer array as zero reported CPI nodes only when the requested recording option is explicitly bound and the response field is present as an array;
- treat missing or null as unavailable, since RPC documents null when CPI recording was not requested and a provider may ignore the option.

Within each group, validate partial-path satisfiability before reconstructing edges. Let `H = 32`, matching the current observer's explicit height safety cap; this is parser resource policy, not a Solana runtime limit. Initialize `reachableMax = 1` at the group's first node. For each node, compute `nextMax = min(H, reachableMax + 1)`. If the height is unknown, set `reachableMax = nextMax`. Otherwise validate a safe integer in `[2,H]`, reject it if greater than `nextMax`, and set `reachableMax` to that reported height. This tracks only the maximum feasible height; it never fills or persists unknown heights. A known decrease resets the bound because deeper frames have unwound; decreases are otherwise unrestricted. Reject an unsatisfiable partial trace even when other heights are unknown. Every PARTIAL group emits no parent edges. Reconstruct parent edges only when every height in the group is known, using this algorithm:

1. The first inner instruction must have height 2.
2. Every height is a safe integer in the inclusive range `[2,H]`, where `H = 32` is the parser's fixed resource ceiling.
3. A subsequent height may stay equal, increase by exactly one, or fall by any amount to at least 2. A jump upward by more than one is invalid.
4. Before resolving an instruction at height `h`, discard prior stack entries at heights `h` and above. For `h = 2`, parent it to the group's top-level instruction index. For `h > 2`, parent it to the nearest preceding instruction at height `h - 1`; if none exists, reject the path. Push the current node at height `h`.
5. Never create an edge to a future node. Repeated sibling heights and repeated program IDs are valid, including permitted same-program reentrancy patterns.

Examples: `[2,3,4,2,3]`, `[2,2,2]`, and `[2,3,2]` are structurally valid. `[3]`, `[2,4]`, and `[2,3,2,4]` are invalid complete-height paths. Partial paths `[2,null,4]`, `[null,3,4]`, `[2,3,4,null,2,null,4]`, and `[2,3,4,null,2]` are satisfiable, remain partial, and emit no group edges. `[null,4]`, `[2,null,5]`, and `[2,3,4,null,2,null,5]` are impossible and rejected. The top-level parent is an instruction-index reference, never a program ID; duplicate program IDs are valid.

## Runtime depth and failed simulations

Parser resource limits are not Solana runtime guarantees. Current Agave uses invocation stack depth 5, or 9 when SIMD-0268 is active, while `stackHeight` is a `u32`-backed optional value. Current `TransactionContext::push()` appends/configures the CPI trace before checking stack capacity; a failed `CallDepth` attempt can therefore appear one height above the successful-call limit. Do not reject a reported attempted depth solely because it exceeds the active successful-execution limit. Do not allocate memory proportional to untrusted height; use a bounded map/stack representation and keep the local height ceiling documented as parser safety policy.

The current observer accepts only `err === null`, so candidate certificate input covers successful simulations only unless separately reviewed. If future work admits failed-simulation traces, a structurally valid reported prefix still cannot claim completion of the intended transaction. Preserve outcome and trace structure as separate fields; never equate structural validity with successful execution or provider completeness.

## Compatibility and adversarial verification

- Preserve byte-for-byte verifier and hash semantics for existing `2.0.0` and `2.1.0`; reject `cpiTrace` and `cpiTraceStatus` claims that are not allowed by those versions.
- `2.2.0` must require its exact trace object and status enum; do not infer defaults.
- Recompute normalized parents, status, counts, instruction hashes, and `traceHash` from contents; bind the full normalized payload into the outer `evidenceHash`.
- Reject extra keys, accessors, proxies, sparse arrays, malformed primitives, invalid PublicKeys, unexpected compiled/hybrid inputs, duplicate/reversed/out-of-range groups, bad counts, broken stack paths, incorrect parents, inconsistent hashes/statuses, and configured node/byte/depth overruns.
- Unknown heights make the group partial and emit no group edges; null/missing/empty distinctions follow the explicit request and response contract above.
- Failed-before-execution, failed-after-CPI, and CallDepth-attempt traces must not claim full transaction coverage.
- Mutating trace content/status or its hash and recomputing only the outer hash must still fail when inner invariants do not hold.
- Keep legacy `cpiGraphHash` unchanged and describe it only as a deprecated flat-list commitment for schemas `2.0.0`/`2.1.0`.
- A future caller must bind the exact message, request and response digests, provider/configuration revisions, slot, and observer receipt. Private certificate construction must derive the normalized trace from the exact raw response held by that receipt authority, or obtain the normalized trace/hash from that authority and verify it against the receipt-bound response digest. The constructor must not accept a parallel caller-controlled `cpiTrace` or trace hash beside a valid receipt. Bind the resulting `traceHash` into the constructed certificate and receipt record. These commitments do not authenticate an RPC provider.
- The observer remains non-authorizing. No production integration, execution authority, settlement claim, or release decision follows from this schema.
- `verifySimulationCertificate(2.2.0)` proves self-consistency only; because hashes are unkeyed, anyone can construct and rehash a self-consistent certificate. It must never claim provider authenticity. Certificate construction that labels trace content as observed must accept only an opaque receipt issued by the private observer authority for the same message/request/response and process epoch. The private path must internally normalize the receipt authority's exact bound raw response, or verify equality with the exact normalized trace/hash supplied by that authority; no caller-controlled trace or hash may accompany the receipt. Serialized certificates verified in another process retain integrity consistency, not receipt authenticity, unless a separately reviewed signature authority is added.

Required vectors include valid nested/sibling/unwind paths, sparse groups, reversed/duplicate/out-of-range indexes, repeated program IDs, unknown heights at beginning/middle/end, satisfiability cases (`[null,4]`, `[2,null,5]`, `[2,3,4,null,2,null,5]` rejected; `[2,null,4]`, `[null,3,4]`, `[2,3,4,null,2,null,4]`, `[2,3,4,null,2]` partial with no edges), malformed known heights (`[1,null]`, `[3,null]`, `[2,4,null]`, `[2,null,-1]`, `[2,null,1.5]` rejected; `[2,null,3]` partial), null/missing/empty trace crossed with recording requested/unrequested, empty groups, both supported simulation instruction shapes and rejected compiled/hybrid forms, malformed primitive and resource-limit cases, exact height and byte/node ceilings and one-over values, failure-before-execution/after-CPI/CallDepth prefixes, schema/status/field-presence cross-products for 2.0/2.1/2.2, old-schema mutation tests, 2.2 canonicalization golden vectors with exact hashes for unrequested/missing, requested/missing, requested/null, unrequested/array, and requested/empty-array, inner tampering with outer rehash, and proof that no receipt authorizes signing.

Before implementation, preserve one exact valid 2.0.0 and one exact valid 2.1.0 certificate fixture plus `evidenceHash`, source provenance, and old-verifier result; run each against both the frozen pre-2.2 oracle and the candidate verifier. The local candidate vectors are frozen in `test/fixtures/simulation-certificate-local-v2.*.json` with manifest `test/fixtures/simulation-certificate-local-v2-manifest.json`; the focused regression passes 2/2 fixtures against the captured local candidate verifier and the current verifier. The 2.0 fixture is synthesized by rewriting local 2.1 output and is explicitly not historical provenance. Current GitHub `main` is schema `1.0.0`, local 2.0/2.1 support exists only in the dirty candidate tree, and no released historical fixtures were found. Therefore local byte-compatibility baseline is captured, but compatibility with actual released 2.0/2.1 producer outputs remains unverified. Freeze 2.2 trace hash input/output vectors from an independent implementation, not only from the production encoder.

## Primary sources

- [Solana `simulateTransaction`](https://solana.com/docs/rpc/http/simulatetransaction) exposes the `innerInstructions` request option and examples for parsed and partially decoded simulation results.
- [Solana RPC JSON structures](https://solana.com/docs/rpc/json-structures#simulation-results) specifies `innerInstructions` as null unless CPI recording was requested and documents simulation's parsed-or-partially-decoded shape.
- [Agave v2.3.13 trace extraction](https://github.com/anza-xyz/agave/blob/v2.3.13/svm/src/transaction_processor.rs#L920) and [current trace extraction](https://github.com/anza-xyz/agave/blob/master/svm/src/transaction_processor.rs#L1210) preserve CPI order.
- [Agave group construction/filtering](https://github.com/anza-xyz/agave/blob/master/transaction-status/src/lib.rs#L120) produces ordered top-level groups and filters empty groups.
- [Agave execution budget](https://github.com/anza-xyz/agave/blob/master/program-runtime/src/execution_budget.rs#L5) and [transaction-context push](https://github.com/anza-xyz/agave/blob/master/transaction-context/src/transaction.rs#L446) establish feature-dependent call depth and append-before-depth-check behavior.
- [Agave RPC simulation serialization](https://github.com/anza-xyz/agave/blob/master/rpc/src/rpc.rs#L3940) serializes transaction error and inner instructions separately.
- [Agave transaction status client types](https://docs.rs/solana-transaction-status-client-types/latest/src/solana_transaction_status_client_types/lib.rs.html) models `stack_height` as `Option<u32>`.

## Review state

Astra Protocol and Astra Verification accepted proposal design at SHA-256 `2BD62756754B397B17210D9220792039CBBAB8098B33BBBDB48A067828E32F85`. This is design acceptance only. Local candidate baseline fixtures now preserve current 2.0/2.1 verifier behavior and exact `evidenceHash` values; released historical compatibility remains unverified. `npm run build:engine` passes; the full platform suite passes 770/770; focused fixture and RuntimeRoot schema tests pass 8/8. These checks do not validate a 2.2 implementation or connect the observer to an authority.
