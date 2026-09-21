# Validation and release status

The source compiles with TypeScript strict checking on Node.js 24.19.0. The suite includes the dashboard, strategy gates, and rolling circuit breaker alongside the engine tests. `TEST_RESULTS.txt` contains the latest captured result. A frozen-lockfile installation completed successfully with pnpm 11.19.0.

The local dashboard adds HTTP tests for access tokens, cross-origin and forged Host rejection, action validation, and asset serving. Engine tests verify that dashboard state excludes credentials and signed bytes, resume preserves safety halts, and an operator pause arriving during buy construction prevents submission. The offline preview was opened and visually inspected in the browser. No live trading was enabled for UI verification.

The test runner uses `--test-isolation=none` because this desktop execution environment rejected child-process spawning. SQLite still ran in its actual worker thread during persistence tests. Tests mock external services and do not claim mainnet execution coverage.

## Verified behavior

- Configuration rejects missing live keys, insecure URLs, duplicate-only fallback URLs, invalid integers, NaN and contradictory limits.
- Thousands of partial-exit sequences conserve token quantities and allocate the full original cost basis exactly.
- Oversells and repeated settlement are rejected.
- Emergency exits precede profit-taking; gap stops and staged trailing behavior are exercised.
- SQLite restores a pending signed transaction after closing and reopening the worker/database.
- Confirmed accounting comes from finalized transaction metadata, including amounts beyond JavaScript floating-point integer precision for tokens.
- A provider timeout cannot prove expiry. All RPCs must report absence and a sufficiently advanced finalized height.
- A transaction found by the fallback RPC prevents a false expiry conclusion.
- Storage failure prevents broadcasting and escapes the execution actor.
- RPC failover preserves the request body, and Jito retries preserve signed bytes and explicit base64 encoding.
- A real Pump IDL event fixture decodes once across duplicate feeds; unrelated-program logs and stale slots do not create a candidate event.
- The Yellowstone adapter writes a real Subscribe request shape and consumes a protocol-shaped update through its stream loop.
- The live transaction builder produces a signed local Pump swap with its tip in the same transaction and a priority fee under the configured cap.
- Failed simulations and expired snapshots do not produce broadcastable orders.
- The rolling circuit breaker halts after three failures or a 5% rolling high-water drawdown, and the strategy gate keeps unconfigured liquidation/basis routes disabled.
- Paper auto mode is serialized against overlapping ticks, safety-scans resolved candidates, records automatic entries/exits, and writes a structured CSV analysis row for each fill.

The native Yellowstone 5.0.5 package initially failed to load its binding on Windows. Version 4.0.2, backed by grpc-js, imported successfully and passed the adapter test. This is a compatibility decision, not a claim that 4.0.2 is universally the fastest client.

## Dependency audit

`DEPENDENCY_AUDIT.json` is the final captured pnpm advisory report. The initial scan identified eight advisories. Direct and transitive BN.js and WebSocket dependencies were upgraded/overridden to patched versions and the full suite rerun.

Five advisories remain in transitive dependencies: three high and two moderate, with no critical advisories. They concern `bigint-buffer` native conversion, `toml` parsing, `uuid` non-v4 buffer operations, and `stream-json` filters. The supplied pnpm configuration disables optional native builds; the observed bigint path uses its JavaScript fallback. This application does not parse TOML, call UUID v3/v5/v6, or use stream-json filters. Those observations reduce apparent reachability but are not a security certification or a complete dependency audit.

Do not interpret a clean compile and passing strategy tests as resolution of those advisories. Production promotion requires either compatible patched upstream dependencies or a reviewed replacement/patch, plus rerunning the regression suite. Major-version overrides were not forced merely to hide advisory findings.

## Live acceptance still required

No dedicated live endpoints, funded keypair or live trading session were configured for this candidate during validation. Consequently these checks remain deployment work:

1. Run a sustained paper soak with the intended RPC/Yellowstone providers. Confirm actual event decoding, rate limits, memory stability, subscription replay, provider timestamp behavior and usable RugCheck coverage.
2. Disconnect each provider individually and then all providers. Verify new-entry suppression, recovery, preserved pending orders and the operational response to blind periods. All-provider gaps are not backfilled by this implementation.
3. Exercise a small funded buy, partial exit and final exit on the intended native SOL curve/token-program variants. Verify metadata, instruction-account compatibility, account rent, compute estimates and fee caps against the explorer and wallet ledger.
4. Exercise graduation/Jupiter fallback, unavailable routes, unsupported token extensions, and rejection/retry paths. A route can legitimately be unavailable during migration; panic is not a guarantee of liquidity.
5. Kill the process before send, immediately after send, and after chain finalization but before local settlement. Confirm exactly one economic fill and correct ledger recovery.
6. Test the history/indexing behavior of both RPCs before accepting their absence/expiry conclusions. Providers that prune history or incorrectly report null can invalidate recovery assumptions.
7. Validate strategy thresholds on chronological, unseen market data with actual fees, rent, failed fills and slippage. No PnL, win-rate, speed superiority or microsecond end-to-end claim has been demonstrated.

One outstanding transaction serializes the wallet until finalization or expiry, so emergency actions in other positions can wait. This is a documented throughput/safety tradeoff. A high-throughput production design would need per-position order lanes, wallet-level capital reservation and fork-aware accounting, all validated independently before enabling concurrent execution.

The artifact is therefore a concrete, executable and tested fusion candidate. It is not yet a production-certified trading system, and the remaining work is not concealed behind placeholder functions.

Live app validation: 39 tests pass (core execution, strategy gates, circuit breaker, dashboard access controls, market normalization, Kolscan buy/sell parsing, watchlist persistence, cumulative profit accounting, paper portfolio scale-out/persistence, staged paper exits, and automatic CSV collection). Browser verified live Solana slots, DEX quotes, PumpPortal connection/new launches, Kolscan public snapshot, exact-mint search, save/remove watchlist, paper account, automatic paper entries, and live RugCheck/RPC safety output. No funded execution or profitable live strategy has been validated. The original release-candidate limitations remain applicable.
