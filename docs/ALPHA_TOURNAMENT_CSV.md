# Alpha Tournament CSV adapter

Run:
```bash
node --test test/alpha-tournament.test.mjs test/alpha-tournament-csv.test.mjs
node scripts/alpha-tournament-csv.mjs normalized-trades.csv report.json
```

Required CSV header (any order):
```
strategy,split,eventId,timestamp,entryValue,exitValue,networkFee,priorityFee,tip,priceImpact,otherCosts,baselinePnl
```

All financial fields are numeric amounts in a **single explicitly chosen currency**, not percentages. Entry and exit must use the same notional basis. Use UTC timestamps and train/holdout split assignments created before evaluating holdout. Accepted strategies: wallet_copy, launch_momentum, cross_dex_arbitrage, execution_optimization.

**This adapter does not ingest raw token peak CSVs directly.** Peak-only records do not establish executable entry/exit prices, timestamp-correct quotes, position sizes, failed transactions, fee/tip totals, or realizable slippage. Fabricating those would invalidate results. Before connecting the user's historical Solana token corpus, implement an event-sourced fill-reconstruction stage that emits this normalized format with independent evidence. The input SHA-256 is included in the output.

This research adapter is not a trading engine, certification system, or capital authorization path. It does not yet implement shared-capital allocation, cross-strategy deduplication, statistical significance, or independent fill verification. No trading keys or credentials are required.
