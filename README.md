# SYLPH Fusion

This repository contains a TypeScript implementation candidate assembled from two Python research designs. It includes source for market ingestion, entry filters, transaction building and submission adapters, confirmation recovery, position management, paper accounting, and tests. These components are not all composed into one production execution path. Start at `src/fusion.ts` and use the current-state and architecture documents below to distinguish connected runtime behavior from research components.

**Release status: tested implementation candidate, not a certified production deployment.** No real wallet was loaded and no transaction was broadcast during development. Live endpoint behavior, landed execution quality, profitability, and unattended operation have not been established. See `REVIEW.md` and `VALIDATION.md` for the evidence and remaining limitations.

## Architecture and evidence status

The repository contains many safety, intelligence, execution, and reconciliation modules, along with design and audit documents. Their presence and passing unit tests do not prove that every component is connected to the primary runtime or that the system is production-certified. The current release state remains blocked for live capital; see [`CURRENT_STATE.md`](CURRENT_STATE.md), [`CURRENT_SYSTEM_MAP.md`](CURRENT_SYSTEM_MAP.md), [`ARCHITECTURE_GAPS.md`](ARCHITECTURE_GAPS.md), and [`RELEASE_CERTIFICATION.md`](RELEASE_CERTIFICATION.md).

### Architecture & Governance Specifications

| Artifact | Purpose & Coverage |
| :--- | :--- |
| [`SYSTEM_MAP.md`](SYSTEM_MAP.md) | Intended component map for ingestion, memory, prediction, survival, capital, vault, and reconciliation |
| [`CONNECTIVITY_MATRIX.md`](CONNECTIVITY_MATRIX.md) | Proposed and observed connections across internal engines and external providers |
| [`STATE_OWNERSHIP.md`](STATE_OWNERSHIP.md) | State ownership requirements and the implementations reviewed for them |
| [`INVARIANT_REGISTRY.md`](INVARIANT_REGISTRY.md) | 20 formal system invariants across Capital, Execution, Signing, and Temporal boundaries |
| [`AUTHORITY_MODEL.md`](AUTHORITY_MODEL.md) | Capability-based hierarchical access control, cryptographic proof leases, and 5-epoch control model |
| [`RECOVERY_MODEL.md`](RECOVERY_MODEL.md) | Deterministic crash recovery, replay verification, WAL reconciliation, and Haven survival mode |
| [`EXECUTION_LIFECYCLE.md`](EXECUTION_LIFECYCLE.md) | 12-stage transaction lifecycle from Discovery to Settled/Finalized with rollback mechanics |
| [`SIGNING_SECURITY.md`](SIGNING_SECURITY.md) | Zone 0 custody isolation, AWS KMS hardware enclave binding, and 15 pre-sign assertion gates |
| [`RECONCILIATION_MODEL.md`](RECONCILIATION_MODEL.md) | JANUS multi-truth reconciliation, Consensus Mirroring, and ghost transaction resolution |
| [`LOGIC_AUDIT.md`](LOGIC_AUDIT.md) | Remediation audit of 10 structural failure modes (TOCTOU, phantom spikes, liquidity pollution) |
| [`RELEASE_GATES.md`](RELEASE_GATES.md) | 20 automated release-blocking governance gates with pass/fail criteria |
| [`CERTIFICATION_REPORT.md`](CERTIFICATION_REPORT.md) | Certification findings and evidence limits; it does not grant live-release approval |

### Local governance regression scenarios

[`test/intelligence/release-blocking-governance.test.mjs`](test/intelligence/release-blocking-governance.test.mjs) contains regression scenarios for the properties below. Passing these tests verifies only the checked code paths in that checkout. It does not establish that the production runtime reaches each path, that the scenarios form an independently operated release gate, or that live-capital certification has passed.
1. **Position Capacity Ceiling:** Rejects next OPEN without permanently poisoning capital authority.
2. **Dynamic Capacity Recovery:** Closing a position immediately frees capacity.
3. **Zero Portfolio Exposure Leak:** Token evaluation alone never creates exposure.
4. **Scoped Revocation Isolation:** Revocation blocks only its target scope.
5. **Resolved Revocation Recovery:** Resolved incidents restore execution authority.
6. **Epoch Change Protection:** TOCTOU epoch advancement invalidates in-flight requests.
7. **Route Authorization Match:** Route authorized by risk/capital matches executed route exactly.
8. **Prerequisite Evidence Gate:** Capital authorization fails if reservation/commitment/lease is absent.
9. **Reduce-Only Recovery:** Exiting reduce-only mode requires verified recovery evidence.
10. **UI Authority Separation:** Dashboard strictly separates token safety from capital authority.
11. **Fail-Closed Unknowns:** Unknown market evidence cannot default to healthy.
12. **Asymmetric Survival:** REDUCE/CLOSE remain active under OPEN restrictions.
13. **Accurate Exposure Accounting:** Closed positions are excluded from open exposure counts.
14. **Idempotent Settlement:** Duplicate settlement calls never double-apply capital balance changes.
15. **Ambiguous Recovery:** Crashes during in-flight submission reconcile before retry.
16. **Intent Discrepancy Gate:** Signer rejects any transaction differing from authorized intent.
17. **Lease Expiry Rejection:** Expired proof leases cannot be signed.
18. **Revocation Pre-Sign Barrier:** Revoked authority fails closed before reaching signer.
19. **Settlement Attributions:** Learning records reference real settlement and outcomes.
20. **Unified Decision Supremacy:** Competing sub-engines cannot bypass Unified Decision Authority.

### Research and test components

* **Yellowstone ingestion adapter:** [`src/platform/ingestion/yellowstone-truth-bridge.ts`](src/platform/ingestion/yellowstone-truth-bridge.ts) implements a Geyser event bridge. A local implementation or latency metric is not evidence of production provider availability or measured end-to-end latency.
* **Signing foundations:** [`src/intelligence/vault/vault-signer.ts`](src/intelligence/vault/vault-signer.ts) and [`src/platform/signing/aws-kms-ed25519.ts`](src/platform/signing/aws-kms-ed25519.ts) contain signing-related code. This repository does not include a deployed isolated signer service, and the existence of these modules does not establish production signing authority.
* **Soak harness:** [`scripts/mainnet-soak-orchestrator.mjs`](scripts/mainnet-soak-orchestrator.mjs) creates timed telemetry sessions under a paper-only guard. Its current shadow-tick path uses a random price and fixed reserves, so those derived outcomes are synthetic scenarios, not empirical price, slippage, landing, or profitability evidence.

## What was retained

The modular separation and durable outbox concept come from `D:\pump\sylph`. The launch seasoning, buyer accumulation, staged exits, dev-sell response, and reconciliation invariants come from `D:\pump\SOL-SYLPH`. Integer SDK quotes replace floating-point valuation as the execution authority. The existing model artifacts were not loaded, retrained, or treated as proven profitable signals.

## Setup checklist

1. Install Node.js 24 or newer and pnpm 11.19.0. On a machine with npm, `npm install --global pnpm@11.19.0` installs the pinned package manager.
2. Open a terminal in this directory. Install the locked dependencies and run the checks:

   ```powershell
   pnpm install --frozen-lockfile
   pnpm build
   pnpm test
   Copy-Item .env.example .env
   ```

3. Edit `.env`. Supply HTTPS RPC and WSS endpoints, preferably from separate providers. Mainnet history access is needed for `getTransaction` at finalized commitment. The RPCs also need account queries, largest-token-account queries, priority-fee samples, simulation, and logs subscriptions. The example domains are intentionally unusable configuration values, not endpoints to trade against.
4. Optionally set a TLS Yellowstone endpoint and its token. It must support filtered transaction subscriptions with confirmed commitment. WebSocket feeds run alongside it and recover independently. Using Yellowstone is optional; its implemented adapter is exercised with a protocol-shaped test stream.
5. Confirm access to RugCheck. The graduated-token paper quote builder uses Jupiter Swap API V2 Router `/build` and requires `JUPITER_API_KEY`; configure `JUPITER_URL` to the V2 base endpoint. New entries are limited to native SOL bonding curves. Direct transaction submission remains quarantined.
6. Run the read-only preflight and start paper mode:

   ```powershell
   pnpm check
   pnpm start
   ```

`check` validates the currently configured mode, mainnet genesis, RPC agreement, and Jito tip-account access where the configured execution authority is available. It does not claim a full feed or trading acceptance test. Paper mode uses real market data but synthetic fills and an unfunded deterministic test identity. It does not call `sendBundle`.

## Local dashboard

When the bot starts, open **http://127.0.0.1:8787**. `UI_PORT` changes the port. The console shows positions, estimated liquidation values with freshness labels, ledger cash, realized PnL, exposure, feed health, pending orders, discovery candidates, and recent session activity. It refreshes automatically.

**Pause new entries** persists across restarts. Existing positions continue to be monitored and exited, and already prepared orders remain subject to confirmation/recovery. **Resume new entries** lifts only the operator pause; it never clears a reconciliation safety halt or other risk check. Wallet keys, endpoint credentials and signed transaction bytes are excluded from the dashboard API. The service binds only to loopback and rejects cross-origin actions.

To preview the interface without endpoints or keys:

```powershell
pnpm build
pnpm ui:demo
```

Then open http://127.0.0.1:8788. The preview uses a separate port (`UI_DEMO_PORT` can change it), is clearly labeled with sample data, and cannot trade. Stop the preview with Ctrl+C. The dashboard does not edit credentials or switch trading modes.

## Live operation details

Do not enable `MODE=live` from this local candidate. The former in-process keypair route is deliberately disabled: a production deployment requires a separately deployed isolated signer, durable signing journal, independent signing firewall, and a wallet pinned to that service. The AWS staging foundation documents the required separation, but it is not a deployed signer service. Keep this workspace in paper/observation mode until those controls, provider evidence, reconciliation drills, and the release gates in `VALIDATION.md` are complete.

Defaults are operational examples, not a recommended strategy or optimized position size. Small orders can lose a substantial percentage to account rent and transaction fees. `MAX_EXPOSURE_LAMPORTS` includes remaining cost basis; entry reservation additionally allows `RESERVE_LAMPORTS` for costs. The daily loss cap uses realized net PnL and failed-transaction fees, resets at UTC midnight, and prevents new entries; it is not an equity drawdown guarantee.

Each new candidate needs at least 10 seconds of observed history, five non-creator buyers, and observed buy volume greater than twice sell volume. The code does not impose a trade quota or silently loosen filters to produce activity. Authority, supported-extension, fee, concentration, reserve, and RugCheck failures prevent entry.

Exits use estimated net liquidation value and retain cost-basis accounting after partial fills. The ladder sells half the remaining amount at +20%, +60%, +150%, and +500%, then the remainder at +1500%. Trailing distances are 20%, 30%, and 40%, widening as peak gains reach +100% and +500%. These are trigger policies, not execution guarantees. A half sale at +20% recovers only 60% of the original capital before fees.

Creator sells, observed creator-balance decreases, a configured fall in real curve reserves, or curve graduation request an emergency exit. Graduation invokes Jupiter; a missing route leaves the position open and retries on subsequent scans. A bonding curve does not have a conventional removable LP position: reserve depletion is the implemented panic signal. The code does not promise to sell before a transaction already observed on chain.

## Recovery and shutdown

The bot writes signed transaction bytes and their signature to SQLite before sending them. A network timeout remains an unresolved order. Restart uses the saved signature and transaction metadata; retransmission sends the same signed bytes. Only finalized success changes inventory. A transaction absent on all configured RPCs becomes expired only after each RPC's finalized block height passes its validity height plus a margin.

One economic order is in flight per wallet. This avoids overlapping mutations and ambiguous balance accounting, but another exit can wait for finalization or expiry. Feed ingestion continues during that wait. This conservative choice limits execution throughput and is not suitable for a microsecond end-to-end latency claim.

Ctrl+C stops ingestion and finishes the current actor iteration, preserving open positions and any pending order. It does not liquidate the wallet. Restart with the same wallet, mode, and database. Do not delete the database to clear a pending order. A wallet/ledger balance discrepancy halts entries; correcting that discrepancy requires operator reconciliation. Existing positions still receive exit attempts. The bot cannot account correctly for unrelated manual trades in its dedicated wallet.

An exclusive loopback socket prevents another instance using the same wallet on this host. It does not coordinate different hosts. Use a single host for each wallet/database. SQLite must reside on a local filesystem. Windows resolves the database directory's actual volume and allows only fixed drives; UNC/device-network paths, mapped remote drives, removable drives, and unknown drive types are rejected. Linux allows only ext2/3/4, XFS, Btrfs, F2FS, and NILFS2 filesystem identifiers, and rejects recognized NFS, SMB/CIFS, AFS, Ceph, Coda, NCP, 9P, OCFS2, generic FUSE, hostfs, and OverlayFS types before opening SQLite. Unknown Linux types and unclassified platforms fail startup by default. Paper/observation runs may explicitly set `DATABASE_FILESYSTEM_OPERATOR_ATTESTATION=LOCAL_SINGLE_HOST_WAL_COMPATIBLE` after an operator verifies the mount; startup logs that this is an unverified attestation, and live mode rejects it. This is not proof of persistent media, mount-option safety, directory-entry durability, or honest storage-device caches. Verify deployment storage independently. The audit table grows with trading activity and should be archived during maintenance, with a verified backup.

The supplied Docker Compose configuration stores the engine database at `/app/data/fusion.sqlite` under its `./data:/app/data` mount. Keep that host-side `./data` directory on verified local persistent storage; the container's writable OverlayFS layer is not an approved database location. Docker Desktop bind mounts that appear as FUSE, 9P, OverlayFS, or an unknown type may be refused; do not set the paper-only attestation until the actual host-backed mount and SQLite locking behavior have been verified.

Compose publishes the operator terminal only on host loopback (`127.0.0.1:8793`). Its explicit `SYLPH_DOCKER_LOOPBACK_PUBLISHED=true` setting lets the paper-mode process bind inside a Docker container so Docker's forwarding path can reach it; startup also requires Docker's `/.dockerenv` marker. The request guard still requires a loopback Host/Origin, and non-container launches remain bound to `127.0.0.1`. Do not change the published host address to `0.0.0.0` or enable this setting in another deployment without a separately reviewed authentication and network-boundary design.

Logs are newline-delimited JSON. Monitor `health`, `feed_decode_rejected`, `position_snapshot_unavailable`, `order_build_rejected`, `bundle_submission_uncertain`, `fill_finalized`, and `balance_reconciliation_mismatch`. `transaction_prepared` includes measured build time, compute units, tip, and priority cost. Endpoint URLs, provider tokens, and private keys are not intentionally logged.

## Files

| File | Purpose |
|---|---|
| `src/fusion.ts` | Executable entry point, strategy actor, risk limits, startup and shutdown |
| `src/feed.ts` | Yellowstone and redundant WebSocket subscriptions, parsing and deduplication |
| `src/market.ts` | Consistent account snapshots, official SDK quotes, safety checks |
| `src/execution.ts` | Local swap builders, simulation, dynamic CU/fees, Jito and recovery |
| `src/core.ts` | Integer accounting, state types and exit policy |
| `src/strategy.ts` | Atomic-arbitrage preflight, curve-scalp policy, and explicit capability gates |
| `src/config.ts` | Central environment schema |
| `src/store.ts`, `src/db-worker.ts` | Off-thread SQLite persistence |
| `test/core.test.mjs` | Offline regression and fault-injection tests |
| `REVIEW.md` | Comparative findings and fusion matrix |
| `VALIDATION.md` | Validation results and release gates |
| `SOURCE_INVENTORY.json` | Original source hashes and structural inventory |

The lockfile is part of the deliverable. Keep it with the source and use pnpm so that its overrides and disabled optional native build scripts remain effective.

## Live market app (new)

Double-click **Start-App.cmd** to open SYLPH as an app window. It is already installed on this computer. The app runs at http://127.0.0.1:8788 and remains running when its window closes. On another computer: install Node.js 24+ and pnpm, run `pnpm install --frozen-lockfile`, then `pnpm build` and `pnpm app`. No wallet or paid data subscription is needed for browsing.

- **Markets:** public DEX Screener prices, liquidity, 24-hour changes and volume; refreshed about every 30 seconds. Search by name or exact Solana mint. Names are unverified; inspect the mint. Listings do not pass the bot's safety filters automatically.
- **New on Pump.fun:** free token-creation stream via PumpPortal, with reconnects. Prices can be unavailable until indexed.
- **Kolscan activity:** public website transaction snapshot, refreshed every 60 seconds. This is not an official Kolscan API; page changes can make it unavailable. These are other traders' transactions, not your profit.
- **Watchlist:** up to 30 locally saved token addresses in data/watchlist.json. Saving does not buy a token.
- **My profit:** automatically connects to the configured engine's local dashboard on port 8787. Start that engine separately using the existing configuration instructions. The app never enables trading on startup. Paper outcomes are marked simulated; live outcomes use finalized settlement. No engine/no fills means no profit is reported.

Cumulative realized profit starts with the first outcome recorded by this version, includes allocated entry cost and recorded failed-transaction fees, and persists in the engine database. It does not reconstruct older trade history. The latest 300 outcomes are retained; cumulative totals survive journal truncation. Unrealized and combined estimates require fresh engine liquidation quotes for every open position. They are not guaranteed proceeds or full-wallet historical returns.

Optional process environment: `APP_PORT=8788`, `ENGINE_UI_PORT=8787`. The double-click launcher uses defaults. Keep the engine at its default `UI_PORT=8787`, or start the app manually with matching settings. Market requests send public token searches/addresses to their providers; private keys never enter the app.

Provider references: [DEX Screener API](https://docs.dexscreener.com/api/reference), [PumpPortal streams](https://pumpportal.fun/data-api/real-time/), [Kolscan public site](https://kolscan.io/).

## Paper trading and token safety

The app now includes a persisted paper account with a 10 SOL starting balance. `Paper buy` only uses a live indexed quote, runs the safety scan first, and never signs or sends a transaction. Open positions, simulated cash, marks, fills, and realized P&L are stored in `data/paper.json`. `Exit all` closes a simulated position at the latest quote. The paper loop applies the useful, testable rules extracted from SOL-SYLPH: three-position cap, one trade per mint, 50% scale-out at 2x, a 12% stop, breakeven protection after a scale-out, and staged trailing stops. These are simulation rules, not evidence of profitability.

Market rows also expose `Test buy`. This is an explicit simulator-only override for exercising fills, P&L, position limits, and automatic exits when every live candidate is rejected by rug checks. It uses the current indexed quote, records `simulator-test-unsafe-override`, and cannot sign, tip, or broadcast a transaction. Use ordinary `Paper buy` when you want the safety gate included in the simulation.

`Start auto paper` runs the smart research collector every five seconds. It requires a fresh quote, at least $50k liquidity, at least $100k 24-hour volume, a moderate change range, and a confirmed safe scan before entering. It ranks candidates by volume/liquidity and momentum, skips missing or unknown safety results, and never touches the live engine. Every paper fill is appended to `data/paper_trades.csv`; columns include UTC time, side, mint, symbol, strategy, USD/SOL prices, liquidity, 24-hour volume and change, market cap, pair, DEX, cost, proceeds, P&L, exit reason, and safety status. The CSV is backfilled from the existing paper ledger on first start when possible.

The app UI is a three-column Cyber-Obsidian terminal: scanner/signals, token analysis, and paper execution/live tape. Click a scanner row to populate the analysis and order panels. The research dock opens token-specific DEX Screener, Pump.fun, Solsniffer, Bubblemaps, GMGN, Axiom, Photon, BullX, and Jupiter pages in separate tabs. They are research links only; the local app does not embed their terminals, connect a wallet, send them private data, or route a trade through them. `DESIGN_SYSTEM.md` contains the palette and component specification. `REACT_TAILWIND_SHELL.tsx` is a standalone React + Tailwind implementation reference using `lucide-react`; the running app remains dependency-free vanilla JavaScript.

Safety checks combine on-chain mint decoding with the public RugCheck report. They show mint/freeze authority, Token-2022 transfer fee, permanent delegate, default account state, transfer hook, LP burn/lock/removability, top-holder concentration, rugged status, and reported bundler/insider flags. Missing provider data is shown as unknown; it is never converted into a clean result. A paper buy is blocked only on a confirmed unsafe report, so an unavailable third-party scanner does not make a paper backtest look like a verified clean token.

The supplied `kol_wallets.txt` is copied into `data/kol_wallets.txt` and loaded as a 577-line tracked-address set. Kolscan rows identify activity from those addresses and report token convergence. The list is treated as an unverified watchlist: it does not establish that a wallet is profitable, independent, or safe to copy.

The supplied `tradeing_data.txt` is a strategy memo, not a structured trade history. Its measurable rules were used only where they can be evaluated from live data. Narrative claims about win rate, “best days,” social scraping, and future returns are not used as signals or presented as facts.

The strategy capability report is explicit in the engine snapshot: curve scalping is enabled; atomic cross-DEX arbitrage, lending liquidations, and delta-neutral basis are gated until their verified venue/account adapters and single-transaction routes are configured. The generic arbitrage preflight still validates same-mint, same-slot, fresh two-leg quotes and prices a 60% of net-edge Jito tip before a route could be handed to an executor. It never submits one leg by itself. Speculative entry risk is capped at `MAX_SPECULATIVE_RISK_BPS` of available cash (default 1%). A rolling 60-minute circuit breaker halts after three failed transactions or a 5% high-water drawdown; the halt reason is visible in the engine snapshot and cannot be cleared by the operator resume action.

Optional environment variables for the app are `MARKET_RPC_URL`, `RUGCHECK_URL`, and `SOLANA_TRACKER_API_KEY`. The Solana Tracker key is optional; when absent, its provider is displayed as unavailable. The app also links to [RugCheck](https://rugcheck.xyz/), [Solana Tracker Rugcheck](https://www.solanatracker.io/rugcheck), and Solscan for manual verification.

## Opportunity-capture research and prototypes

The repository includes research designs and prototype components for token semantics, runtime and program identity, exit capacity, multiplier estimates, capital constraints, execution permits, evidence records, synthetic market scenarios, strategy selection, and dashboard projections.

These components are not a demonstrated, connected live production execution path. Their outputs do not establish calibrated probabilities, executable exit capacity, authenticated runtime or program identity, profitable execution, or release certification.

The paper runtime uses the existing `CapitalBarrierKernel` policy, with explicitly labeled assumptions and heuristic inputs. Passing that check does not issue an execution permit. `UltimateExecutionPermitAuthority` remains a research prototype: its unkeyed SHA-256 digest is not an authenticated signature, and its validator does not establish the authenticity of roots or certificates.

`UltimateExecutionRecordLedger` contains research record-linking code. The runtime does not create a verified execution evidence chain from placeholder hashes. Ordinary paper fills are simulated accounting outcomes. A recovered paper order without durable fill evidence remains unresolved.

`MarketWindTunnel` produces synthetic scenarios; it does not establish measured mainnet performance or authorize canary promotion. Strategy and dashboard components require separate integration and evidence review. The release and architecture status described above remains applicable.
