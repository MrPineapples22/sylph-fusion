# Ecosystem source review — batch 014

This batch reviews analytical storage, columnar formats, feature stores, backtesting and ML frameworks, and property-based testing libraries. Source-specific findings are recorded in `research/registry/source-review-batch-014-2026-10-14.json`.

## Findings

- ClickHouse and Arrow/DataFusion are candidates for historical analytics and typed data interchange. Keep analytical projections separate from capital/position state, and retain exact decimal, large-integer, timestamp and missing-value semantics.
- Feast's point-in-time feature retrieval pattern directly addresses training leakage, but only if event time, availability time, and source provenance are trustworthy.
- NautilusTrader, vectorbt and Qlib offer research/backtesting workflow patterns. They do not model Solana slot ordering, nonfills, priority/tip costs, or MEV automatically; do not create a second trading engine.
- LightGBM, XGBoost, CatBoost, MAPIE and River are offline modeling candidates. The next SYLPH priority remains clean labels, future-period validation, calibration, and realized net outcomes.
- fast-check and Hypothesis can generate boundary/adversarial cases; preserve random seeds and minimized counterexamples, and pair properties with official protocol fixtures.

## Verification

Official repository pages were reviewed. No datasets or third-party libraries were installed or run. No runtime code or model authority changed.
