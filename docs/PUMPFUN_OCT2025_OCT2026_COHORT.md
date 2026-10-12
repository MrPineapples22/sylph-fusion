# Pump.fun October-to-October cohort research scaffold

Period: 2025-10-01 00:00 UTC through 2026-10-13 00:00 UTC (end exclusive). Run:
```bash
node --test test/pumpfun-cohort-study.test.mjs
node scripts/pumpfun-cohort-study.mjs decoded-events.json cohort-report.json
```

Input: JSON array of decoded Pump/PumpSwap events, each with `type` (CREATE, TRADE, COMPLETE, MIGRATE), `mint`, `signature`, `eventIndex`, `slot`, and ISO `timestamp`. CREATE may include `creator`; TRADE requires `trader`, `side` (BUY/SELL), positive `quoteAmount` and `baseAmount` expressed in human-readable consistent units. Quote currency must be consistent across trades for meaningful price ratios. Raw RPC transaction JSON **cannot** be passed without an independent protocol-specific decoder.

Output: one row per observed mint; creation, trades, unique traders, completion, migration, first/peak observed trade price and time to peak. This is a **sample-coverage report**, not a complete Pump.fun population census. A mint lacking CREATE may be left-censored; a mint lacking MIGRATE may be right-censored. The observed graduation rate is not an unbiased cohort graduation rate unless complete source coverage and sufficient follow-up are independently established.

Do not treat first-trade-to-peak multiples as achievable trading returns: price impact, trade sizing, transaction inclusion, sell-side liquidity, fees and taxes are not modeled. The report is deliberately separate from the Alpha Tournament's executable-fill evidence.

## Required upstream data pipeline
1. Export historical transactions/logs for Pump bonding curve and PumpSwap program IDs for the entire period, including failed and inactive tokens, with provider pagination and checkpointing.
2. Decode versioned instructions and event variants (including v2/v3, synthetic migration, non-SOL quotes, Token-2022, and inner instructions) against version-pinned official IDLs.
3. Persist source signature, slot, transaction index, event index, commitment, decoder version and raw evidence SHA-256.
4. Resolve reorgs and missing slots; measure event coverage against independent providers.
5. Normalize quote currency and token decimals, verify migrations, reconstruct state and time-based executable quotes.
6. Feed independent observed fills to Alpha Tournament only after provenance and execution accounting verification.

Official references: https://github.com/pump-fun/pump-public-docs and https://pump.fun/docs/bonding-curve

This scaffold does not fetch millions of tokens, does not claim historical results, and cannot authorize live trades.
