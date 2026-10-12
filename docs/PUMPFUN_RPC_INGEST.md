# Pump.fun historical RPC capture

This command captures bounded, finalized Solana RPC transaction responses for configured program addresses. It is research tooling: it does not decode Pump.fun events, establish a complete token census, estimate strategy returns, or authorize trading.

Create a local JSON configuration (keep provider credentials out of committed files):

```json
{
  "rpcUrl": "https://YOUR_ARCHIVAL_RPC",
  "programIds": ["VERIFIED_PROGRAM_ID"],
  "outputDir": "data/pumpfun-oct2025-oct2026",
  "start": "2025-10-01T00:00:00Z",
  "endExclusive": "2026-10-13T00:00:00Z",
  "pageSize": 1000,
  "maxPagesPerProgram": 1,
  "maxTransactions": 100,
  "requestDelayMs": 250
}
```

Run with `npm run research:pumpfun:ingest -- path/to/config.json`. The run writes raw transaction JSONL, SHA-256 record hashes, atomic per-program checkpoints, unresolved evidence for missing block times or unavailable transactions, and a manifest. Re-run with the same output directory to continue; saved transaction signatures are deduplicated if a process stops after writing evidence but before updating its checkpoint. Each run retries up to `min(maxTransactions, 100)` unresolved signatures before paging forward. Missing block times are retried through `getBlockTime`; unavailable transactions stay queued until they are fetched or the unresolved result is addressed. The unresolved snapshot is persisted before the pagination checkpoint advances, so a crash cannot silently skip a newly observed gap.

Check stored integrity independently with `npm run research:pumpfun:verify -- data/pumpfun-oct2025-oct2026`. The verifier checks each raw record hash, duplicate signatures, checkpoint structure, and unresolved-record count. `integrity: PASS` means stored files match their record hashes and expected shape; it does not prove the provider returned all chain events. The dataset remains unverified for completeness even when the cursor reaches the requested time window.

The manifest deliberately remains `PARTIAL_UNVERIFIED`, with decoding `NOT_DECODED` and live authority `BLOCKED`. `getSignaturesForAddress` is an address history query, not a global chain index. Full-period analysis still needs verified program IDs, provider archive coverage, slot-gap reconciliation, newer transaction-version support, version-pinned IDL decoding, and an independent completeness review. Unresolved records must be addressed before treating the dataset as complete. Do not infer executable fills or realized profitability from these raw records.
