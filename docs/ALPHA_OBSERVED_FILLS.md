# Observed-fill reconstruction adapter (research only)

`node --test test/alpha-observed-fills.test.mjs`
`node scripts/alpha-observed-fills.mjs observed-fills.json report.json`

Input is a JSON array of observed two-legged SOL-denominated execution records. Required fields:
- strategy: wallet_copy, launch_momentum, cross_dex_arbitrage, execution_optimization
- split: train or holdout; eventId; mint; source: OBSERVED_EXECUTION
- entrySignature, exitSignature: distinct nonempty provenance references
- sourceSha256: lowercase SHA-256 of the upstream evidence bundle
- entryTimestamp, exitTimestamp: UTC ISO-8601; exit must not precede entry
- currency: SOL
- entryDebitSol, exitCreditSol: gross executed values in SOL, **excluding all separately reported fees and impact**
- networkFeeSol, priorityFeeSol, tipSol, priceImpactSol, otherCostsSol: separate nonnegative cost buckets, never double counted
- feesIncludedInEntryExit: false (explicit accounting convention)
- fillStatus: FILLED_BOTH_LEGS
- baselinePnlSol, baselineEvidenceSha256: paired baseline and its provenance

Example:
```json
[{"strategy":"wallet_copy","split":"train","eventId":"example-1","mint":"EXAMPLE_MINT","source":"OBSERVED_EXECUTION","entrySignature":"ENTRY_SIGNATURE","exitSignature":"EXIT_SIGNATURE","sourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","entryTimestamp":"2026-01-01T00:00:00Z","exitTimestamp":"2026-01-01T00:00:30Z","currency":"SOL","entryDebitSol":1,"exitCreditSol":1.1,"networkFeeSol":0.001,"priorityFeeSol":0.001,"tipSol":0.001,"priceImpactSol":0.01,"otherCostsSol":0,"feesIncludedInEntryExit":false,"fillStatus":"FILLED_BOTH_LEGS","baselinePnlSol":0,"baselineEvidenceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]
```

This adapter only transforms **provided** execution evidence and applies arithmetic/format checks. It does not fetch Solana RPC data, independently verify signatures or account balances, reconstruct fills from raw peak CSVs, or simulate partial/failed fills. Labels and hashes are self-attested until independently validated. Values in the example are synthetic and must not be represented as realized performance.

Critical remaining work: load archived transaction/meta data with slot-aware account state, token balance deltas and actual costs; independently verify provenance and timestamp availability; model failed/partial fills and sell-side liquidity; compare against matched baseline and run paired statistical tests. Never connect to live capital authority.
