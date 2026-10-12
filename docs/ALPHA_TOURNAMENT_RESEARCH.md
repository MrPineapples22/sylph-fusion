# SYLPH Fusion Alpha Tournament — research prototype

Four strategy labels: wallet_copy, launch_momentum, cross_dex_arbitrage, execution_optimization.

Run `node --test test/alpha-tournament.test.mjs` and `node scripts/alpha-tournament.mjs input.json report.json`.

Input is a JSON array of completed hypothetical trade records with fields: strategy, split (train/holdout), eventId, timestamp (ISO-8601), entryValue, exitValue, networkFee, priorityFee, tip, priceImpact, otherCosts, baselinePnl. All amounts must use the same currency and comparable capital basis. Holdout must occur strictly after training within each strategy. Duplicate event IDs are rejected within a strategy. Missing costs fail closed.

This is an **evaluation scaffold**, not a fill simulator, and no strategies or Solana feeds are wired in. It cannot prove profit. It does not prevent cross-strategy leakage, shared-capital double-counting, lookahead inside signals, incorrect baseline attribution, or manipulation of submitted records. These must be fixed before any certification use. RESEARCH_CANDIDATE is deliberately not deployment approval.

Future work: immutable event provenance; shared event/time leakage guard; executable fills from historical account states; paired comparison under identical capital, opportunity sets and timestamps; purged walk-forward splits; block-bootstrap confidence intervals and multiple-comparison correction; portfolio-level constraints and drawdown; actual paper-forward results; independent replay certificates. Never unlock capital authority based on this report.
