# SYLPH Operator Terminal

The default page is the Operator Terminal. It presents observations from configured market and risk adapters, JEV/Laya research controls, provider health, and a local paper ledger. Paper actions never sign or broadcast Solana transactions. Provider configuration and live observations are separate: without the required endpoints, market-dependent evidence remains unavailable.

The separate `/simulator` page is a browser-only strategy simulator. Its prices, liquidity, signals, confirmations, fees, and fills are synthetic. Results from that page are not live market evidence, engine outcomes, or profit evidence.

## Open the app

Double-click **Start SYLPH.lnk** or **Start-App.cmd** in the parent project. The launcher opens the built terminal at **http://127.0.0.1:8793/** and reuses an existing instance. PowerShell scripts are not required. Node.js 24+ must be installed; the launcher also recognizes the bundled Codex Node runtime on this machine.

The Engine (`src/fusion.ts`) and Operator Terminal (`terminal/server.mjs`) are separate processes. The Engine dashboard on port 8787 displays provider health from the same Engine process that owns the Yellowstone socket. The Operator Terminal can read a bounded allowlist of retained Engine audit events, but it does not share the Engine's in-memory provider tracker or Yellowstone socket. Its provider table reports the terminal process's own tracker; use the Engine dashboard for Engine stream health. The older legacy dashboard is accessible with **Start-Legacy-App.cmd**.

Market connectors start independently. DexScreener enables token search and pool discovery; DexScreener or PumpPortal can supply discovery observations; KOLScan adds wallet-flow enrichment; risk scans require both `MARKET_RPC_URL` and `RUGCHECK_URL`. A missing optional connector no longer prevents configured providers from starting, and unavailable capabilities remain explicit.

The Flight Recorder drawer shows two distinct evidence sources. **Engine Candidate Audit** reads a fixed allowlist of retained candidate, gate, order-build, and paper-fill events from the Engine's SQLite audit database using a read-only connection. It uses `SYLPH_ENGINE_DB_PATH`, then `DB_PATH`, then the project-root `.env` value, and finally the Engine default `fusion.sqlite`; relative paths resolve from the project root. It displays at most the newest 250 events, validates a minimal event-specific candidate/attempt identity shape, and reports unprojectable rows, database-wide known prune counts, and the persisted research-loss marker. Build and paper-fill rows expose requested/quoted raw amounts with explicit `LAMPORTS` or `TOKEN_RAW` units, market-snapshot age, and allowlisted modeled fee/slippage estimates. These fields are explicitly paper evidence, not observed chain costs or fills. “Projectable” means only that the row has the minimum identity fields and supported allowlisted field types; unknown payload fields are intentionally omitted. Completeness remains **UNKNOWN** because event-write failures, earlier pruning, and pre-discovery candidates may leave gaps. The projection omits raw observations and error strings.

**Economic Flight Recorder** is a separate legacy lifecycle database under `terminal/data`; production Engine events do not write into it. An empty legacy recorder therefore says nothing about whether Engine candidates or order attempts occurred. Engine paper fills remain simulation-only and do not establish submitted, landed, finalized, or settled Solana transactions. A standalone source-package copy without the Engine database shows audit status as unavailable.

For a standalone source package, extract the ZIP and double-click **Start-App.cmd**. Built assets are included, so no dependency installation is needed to run it.

The terminal's file-backed flight-recorder database uses SQLite WAL and checks its data directory before opening. Windows must provide a supported fixed local volume. Linux permits only the explicitly classified local filesystem types documented in the project README. Unknown types and non-Windows/non-Linux platforms fail by default; the `DATABASE_FILESYSTEM_OPERATOR_ATTESTATION=LOCAL_SINGLE_HOST_WAL_COMPATIBLE` override is accepted only when `SYLPH_RUNTIME_MODE` and `MODE` do not select live mode. Set it in the process environment after an operator verifies local, single-host WAL behavior. The terminal launcher does not load `.env`. An attestation is not proof of power-loss durability.

## Development

From this `terminal` directory:

```sh
pnpm --ignore-workspace install --frozen-lockfile
pnpm dev
pnpm build
pnpm test
pnpm start
```

Vite serves development on port 8793. Stop the production server before using the same port, or pass a different port to Vite. `TERMINAL_PORT` configures the production server and launcher.

On Windows, **Build.cmd** is the verified alternative build path: it invokes the installed esbuild executable directly, compiles Tailwind through its Node API, and runs the engine tests. It works without PowerShell or Vite's child-process bundling. `pnpm build` is the standard Vite path; it was not executable in the restricted build host because child-process creation was denied. The shipped bundle was produced and tested with Build.cmd.

## Operator Terminal research

- Select a pair in Markets to update its chart, indicators, and order ticket.
- In Astra, **Check Jupiter round trip** requests buy and sell quotes for the selected observed mint at `BUY_LAMPORTS`. It uses quote-only Swap V2 `/order` calls without a taker, reports the signed quote-implied return in basis points and route labels, and never requests, signs, or submits a transaction. The two quotes are sequential; network/landing costs and intervening state changes are excluded, so the value is a research observation rather than a fill or profit forecast. Without `JUPITER_API_KEY`, the action uses Jupiter's keyless limit and spaces provider requests accordingly.
- In Astra, **Cross-check Birdeye** requests `GET /defi/token_overview` for a selected observed Solana mint. It displays only normalized provider price, liquidity, and market-cap fields when present. The action is manual, requires `BIRDEYE_API_KEY`, caches briefly, and paces calls at one request per second to fit Birdeye's documented Standard-tier limit. It does not change candidate ranking or authorize entries.
- In Astra, **Check Streamflow vesting** uses the pinned Streamflow Solana SDK to search on-chain schedule accounts filtered by the selected mint. It shows active Streamflow schedule count, remaining raw token units, the amount scheduled to unlock over the next seven days, and whether a sender can cancel. It uses `STREAMFLOW_RPC_URL` or the configured market/Solana RPC, has request timeouts and a short cache, and does not include other vesting protocols or affect candidate eligibility.
- In Astra, **Quote Mayan bridge routes** requests a Mayan quote for the configured `BUY_LAMPORTS` amount of WSOL from Solana to USDC on Base. It shows normalized expected/minimum output, route type, quoted slippage and provider ETA. It calls only Mayan's quote endpoint; the panel never builds, signs, or submits the bridge transaction. Route completion, received amount, and profit are not guaranteed.
- Optional Discord webhook notifications send fixed-template, output-only alerts when a provider enters or clears a `CRITICAL` health condition. Configure `DISCORD_WEBHOOK_URL` in the local server environment. The service validates an official HTTPS webhook URL, disables mention parsing, deduplicates incidents, and never reads Discord messages or accepts commands. Its status is shown in the System workspace; the webhook URL and provider error text are never exposed there.

## Strategy simulator controls (`/simulator`)
- Manual size presets select 0.5, 1, 2, or 5 SOL; **Buy** submits an order. One position per asset prevents accidental stacking. The global position cap includes pending entries.
- Slippage, priority fee, and Jito tip are shared between manual and automatic orders. Settings are copied into each order at submission; changes do not rewrite pending orders.
- **Start automation** evaluates every simulated pair at the chosen interval.
- Breakout entry requires velocity above the selected percentage **and** volume above the multiplier. Dip entry requires RSI to cross upward through the selected threshold **and** MA5 above MA20.
- There is a 15-second per-asset entry cooldown. An asset can have only one pending order, preventing repeated entries and exits during confirmation.
- Take-profit tiers default to +25%, +50%, +100%. They sell 25%, 25%, then all remaining original units. A tier advances only after a successful fill.
- Stops execute only while automation is armed. Stop levels ratchet upward using the higher of the original stop and the peak-price trailing stop. They never loosen when settings or prices fall.
- **Halt automation** and **Panic close all** both stop the bot, cancel pending orders, and immediately close all positions. Emergency closes bypass latency and slippage limits but still use the executable pool quote and charge modeled fees. Ordinary closes may be rejected by the slippage cap.
- Audit export downloads the latest 300 events, including order origin, timestamps, execution price, quantity, slippage, fees, PnL, and configured latency. The newest event appears first; logs and chart history are bounded to avoid unbounded memory growth.

The controls below belong to the isolated browser simulator. They do not route orders through Jupiter, the Engine, or a Solana signer.

## Strategy simulator accounting and execution math

The ledger starts with **7,500 virtual USDC**, equivalent to **50 SOL at the $150 seed price**. Seeded chart history means the first displayed SOL mark can already differ from $150. The wallet displays its current SOL equivalent; all ledger balances, equity, cost basis, realized PnL, and cumulative returns use USDC.

For the virtual constant-product pool, quote reserve `R = liquidityUSD / 2`. With gross order value `V` and DEX fee `f = 0.003`:

```text
buyAveragePrice = markPrice * (1 + V*(1-f)/R) / (1-f)
sellAveragePrice = markPrice * (1-f) / (1 + V*(1-f)/R)

priorityLamports = ceil(microLamportsPerCU * 200000 / 1000000)
networkFeeSOL = (priorityLamports + 5000) / 1000000000 + jitoTipSOL
```

Order fees use the SOL quote at submission, which keeps pending reservations exact. Buys reserve notional plus network fees; sells reserve network fees. DEX fees are included in the executable price, not debited twice. Cost basis includes buy network fees; proportional basis is released on partial exits. Realized PnL includes sell fees and network fees charged for rejected orders. Equity uses mark value and is not an estimate of post-liquidation proceeds.

Slippage protection measures adverse executable price movement from the submission mark, including DEX fees and pool impact. A rejected fill charges the reserved network fee, opens no position, and records why it failed. Favorable slippage is retained and shown as a negative slippage percentage.

Prices follow geometric Brownian motion with zero drift, configurable per-asset model volatility, and temporary 3× volatility regimes. A deterministic PRNG lives in reducer state so identical inputs produce identical output. Micro-cap volatility is accelerated for testing; this is not a calibrated forecast of Solana returns. Volume multipliers and virtual depth are model inputs, not on-chain observations.

## Strategy simulator architecture

| File | Responsibility |
| --- | --- |
| `src/engine.js` | Pure reducer, market simulation, indicators, pending orders, fills, accounting, automation, restoration |
| `src/main.jsx` | React state ownership, timers, chart lifecycle, controls, tables, export, persistence |
| `src/style.css` | Solana tokens, Tailwind import and utilities, dense responsive component styling |
| `server.mjs` | Loopback-only static serving, content types, host validation, security headers |
| `engine-research-audit.mjs` | Read-only, bounded projection of retained Engine audit events |
| `src/components/EngineResearchAuditPanel.jsx` | Candidate/attempt event view with explicit completeness and evidence labels |
| `jupiter-research.mjs`, `src/Astra.jsx` | Explicit quote-only Jupiter round-trip research action and evidence display |
| `test/engine.test.mjs` | Deterministic accounting and strategy regression tests |
| `Build.cmd`, `build-assets.mjs` | Verified Windows production build |

React owns one reducer. A 250ms timer emits ticks; a separate timeout settles the earliest pending confirmation in the 100–400ms range. No network or sleep occurs inside a reducer or render. Chart resources and timers are cleaned up on unmount. No render relies on random values outside reducer state.

Session storage is isolated per browser tab and saved every five seconds and on page hide. A reload restores the ledger but cancels pending work and disarms automation. Invalid snapshots fall back to a new session. Browser background throttling can delay ticks and fills; this client-side app cannot promise timing while the tab or operating system is asleep. It deliberately caps elapsed simulation steps instead of replaying a burst of missed trades.

## Strategy simulator validation

- 19 deterministic engine tests passed, covering reservations, duplicate orders, audit identity, pool impact, fee rounding, adverse moves, rejection, PnL reconciliation, TP quantities, trailing stops, priority of stops, emergency cancellation, session recovery, and both entry strategies.
- Production JavaScript and Tailwind CSS built successfully using Build.cmd.
- Browser-tested manual fill, position display, automated breakout entries/exits, panic liquidation, and halt liquidation.
- Checked 1440px desktop and 390px mobile layouts. Mobile content did not overflow the viewport; the token strip and positions table scroll within their containers.
- Browser error log was empty in the isolated test session.

These checks validate the simulator only. The Operator Terminal's configured provider behavior, engine-process integration, and live execution path require separate evidence. Browser timing, session storage, fixed virtual depth, and simplified market mechanics remain simulator limitations.

## Chart attribution and documentation

Charts use [TradingView Lightweight Charts](https://www.tradingview.com/) with its attribution logo retained. The implementation follows the [v5 series and marker API](https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5). Tailwind integration follows the [official Vite installation guide](https://tailwindcss.com/docs/installation/using-vite).
