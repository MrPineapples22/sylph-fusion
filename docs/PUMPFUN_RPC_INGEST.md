# Pump.fun historical RPC ingestion (research only)
Run `node --test test/pumpfun-rpc-ingest.test.mjs`.
Create a local JSON config:
```json
{"rpcUrl":"https://YOUR_ARCHIVAL_RPC","programIds":["YOUR_VERIFIED_PUMP_PROGRAM_ID","YOUR_VERIFIED_PUMPSWAP_PROGRAM_ID"],"outputDir":"data/pumpfun-oct2025-oct2026","start":"2025-10-01T00:00:00Z","endExclusive":"2026-10-13T00:00:00Z","pageSize":1000,"maxPagesPerProgram":1,"maxTransactions":100,"requestDelayMs":250}
```
Run `node scripts/pumpfun-rpc-ingest.mjs config.json`. Use verified program IDs from official Pump documentation. Never commit API keys. Output contains raw RPC transaction metadata, JSONL evidence and checkpoints. This is not a decoded token census, nor verified completeness. The script uses getSignaturesForAddress pagination and getTransaction, not a global chain index. For a full-year census, provider archival coverage, checkpoint consistency, slot-gap verification, v0+ transaction support, version-pinned IDL decoding, and independent completeness audits remain necessary. Crash between evidence append and checkpoint can duplicate a record; downstream deduplication is required. A program address may not be present in all desired events. Unknown blockTime is skipped and must be repaired separately. No capital authority or signing.
Official IDLs: https://github.com/pump-fun/pump-public-docs/tree/main/idl
