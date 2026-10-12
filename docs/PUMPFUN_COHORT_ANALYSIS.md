# Pump.fun cohort analysis (research only)

`scripts/analyze-pumpfun-cohorts.mjs` calculates monthly launch cohorts from normalized, source-attributed records. It is intentionally separate from raw RPC capture: the capture output contains provider JSON, not decoded token lifecycle events. No decoder currently converts that capture into this input format.

## Input contract

The JSON input has `schemaVersion: 1`, an ISO-8601 `range` with an exclusive end, `coverage.completeForRange` (a source assertion, not an independently verified fact), unique `launches`, and unique `events`.

Each launch requires `mint`, `createdAt`, and `source`. Each event requires `eventId`, `mint`, `observedAt`, `kind`, and `source`. Event kinds are:

- `TRADE`, optionally with a finite nonnegative `marketCapUsd` observation.
- `GRADUATION`.
- `SETTLED_EXECUTION`, with finite `realizedNetPnlUsd` explicitly measured after settlement.

Example:

```json
{
  "schemaVersion": 1,
  "range": { "start": "2026-01-01T00:00:00Z", "endExclusive": "2026-02-01T00:00:00Z" },
  "coverage": { "completeForRange": false, "notes": ["Provider gap review pending"] },
  "launches": [{ "mint": "TOKEN_MINT", "createdAt": "2026-01-05T12:00:00Z", "source": "decoder-version/provider" }],
  "events": [{ "eventId": "provider-record-id", "mint": "TOKEN_MINT", "observedAt": "2026-01-05T13:00:00Z", "kind": "TRADE", "marketCapUsd": 12000, "source": "decoder-version/provider" }]
}
```

Run `npm run research:pumpfun:cohorts -- input.json output.json`. The output is written with create-only semantics; choose a new path for each run.

## Interpretation limits

- The launch denominator is all normalized launch mints whose creation time is in the selected range. It is only as complete as the supplied launch records.
- `mature24h` excludes launches whose full 24-hour window extends beyond the requested end. The 24-hour graduation rate uses that mature denominator, while observed trade rate uses all launches.
- A token with no supplied trade event counts as no *observed* trade. Under partial coverage this does not mean it had no trade.
- `observedPeakMarketCapUsd` is the maximum supplied market-cap observation across that cohort. It is not an executable price, exit value, or profit.
- `settledRealizedNetPnlUsd` sums only explicit settled execution events. Peak market cap never substitutes for realized P&L.
- `coverage.completeForRange: true` is surfaced as `SOURCE_ASSERTED_COMPLETE`, not certified complete. Independent program discovery, archive-gap reconciliation, version-pinned decoding, and review are still required.
- The result is research output only and cannot authorize a trade, size capital, or claim strategy profitability.
