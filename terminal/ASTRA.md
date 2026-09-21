# Astra public-data operating mode

Astra is configured as a paper-only copilot. The current public discovery feed does not establish the chain-wide top five, so all new manual and automatic entries are blocked. Existing simulator positions can still be closed. Reload open terminal tabs to activate this mode; already-loaded older tabs retain their old JavaScript until refreshed.

## Implemented
- Public DEX Screener pool enrichment for up to 30 currently discovered token mints.
- Raydium, Meteora and Orca venue filter; deduplicated pool-address ranking by supplied trailing one-hour USD volume, with up to five observations.
- Five-minute cache/recalculation on demand while the terminal is open; concurrent requests share one fetch.
- Carousel: rank, ticker, one-hour volume, price, five-minute change, volume/liquidity, and clearly labeled trade-count imbalance proxy.
- Contract/security, social confirmation, true volume OFI, and global coverage remain unknown. They are not assigned invented scores or treated as passed checks.
- Default 7% trailing stop, TP ladder +15%, +35%, +75%; modeled 2% equity-loss check includes slippage allowance and round-trip network fees. Gap risk means this is not a guaranteed maximum realized loss.
- Reducer-level entry and automation gates, enforced after session restoration as well as on new sessions. There is no production UI switch that bypasses verification.
- Three-line watch summary: blocked trigger, unscored risk, and 7% reference invalidation. These are watch observations, not recommendations.

## Not connected
Global volume-ranked pool index; X and Telegram call feeds; authenticated whale performance history; Moonshot launch stream; Raydium new-pool stream; independent LP-lock and authority verification for the ranked basket; token-tax-change history; liquidity-pull time series.

Existing PumpPortal launch and public Kolscan snapshots are preserved in the fused dashboard. Their presence does not verify smart-money conviction or early accumulation. No bullish badge is inferred from a buy record alone.

Existing virtual balances are preserved rather than silently reset. A fresh/reset session starts with 7,500 virtual USDC, equivalent to 50 SOL at the $150 model seed. The wallet displays current SOL-equivalent value; this remains a USDC-accounted simulator, not a native SOL ledger. Full SOL-denominated accounting and verified live-basket execution remain future work.

Validation: production build and 22 tests passed. Public endpoint returned 3 qualifying observed pools during verification, coverage=observed-pools-only, verified=false, entryAllowed=false. Fewer than five observations are displayed honestly rather than padded with synthetic pairs.
