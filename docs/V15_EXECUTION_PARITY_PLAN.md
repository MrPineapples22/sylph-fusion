# V15 execution parity — evidence-first scaffold

Status: **NOT CERTIFIED**. This branch adds a provenance fixture validator and integer reconciliation tests. It does **not** execute LiteSVM/Mollusk, load historical accounts, or prove program parity.

## Next implementation gates
1. Capture slot-specific executable binary and verify SHA-256. A current mainnet program dump must not be used as proof of historical binary identity.
2. Capture complete pre-transaction account snapshots, executable dependencies, program-data accounts, feature set, sysvars, instructions, signer requirements, and relevant runtime version. Hash the canonical snapshot.
3. Execute the exact instruction/transaction in LiteSVM. For isolated instructions, independently execute Mollusk with the same accounts/configuration.
4. Compare all writable account lamport and token data changes, program errors, CU use (where comparable), and fees. The current validator only compares lamport deltas and is intentionally incomplete.
5. Compare observed mainnet transaction poststate with local SVM results, explain differences due to surrounding transactions, fees, and runtime configuration.
6. Feed only fully validated receipts to V13 replay. No synthetic fills or invented profits.
7. Run reproducible CI tests and preserve logs, hashes, and evidence manifests before changing any certification gate.

## Fixture JSON contract
```json
{
  "fixtureId": "example",
  "slot": 123,
  "signature": "real-mainnet-signature",
  "programId": "real-program-id",
  "programBinarySha256": "64-char-lowercase-sha256",
  "accountSnapshotSha256": "64-char-lowercase-sha256",
  "runtimeVersion": "exact-version-and-feature-set",
  "instruction": { "accountKeys": ["pubkey"], "dataBase64": "AA==" },
  "observed": { "accountDeltas": [{ "address": "pubkey", "lamportsDelta": "0" }] }
}
```
No fixture containing placeholders is evidence of parity. The validator emits SCHEMA_VALID_ONLY, never PASSED.
