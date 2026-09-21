# Comparative forensic review

Reviewed September 13–14, 2026, from the accessible local directories `D:\pump\sylph` and `D:\pump\SOL-SYLPH`.

The cleaner architecture is sylph; the richer trading-policy implementation is SOL-SYLPH. Neither supplied execution path should be considered production-safe unchanged. The most serious findings concern transport authenticity, submission/fill identity, and recovery, rather than a missing speed optimization.

The structural inventory covers 304 first-party Python files and 48,104 lines. All parsed successfully; no repeated top-level class/function definitions were found by the structural scan. The focused manual review examined ingestion, execution, Jito, wallet signing, exit policies, persistence, and reconciliation. This is not a claim that every branch of those 48,104 lines was manually audited. Secrets, runtime databases, and serialized models were not loaded. Original files were not edited. `SOURCE_INVENTORY.json` records file hashes so the reviewed versions can be identified.

## Core strengths

| Area | sylph | SOL-SYLPH | Selection |
|---|---|---|---|
| Architecture | Ports, domain objects, adapters, injected transports and clocks | Operational functionality concentrated in a large application with auxiliary managers | Preserve sylph's separation in a smaller executable |
| Ingestion | Pure PumpPortal normalization; explicit SOL/token units; bounded subscription window | Trade binary layout knowledge, live trade history, buyer accumulation and anti-sniper gates | Real Yellowstone subscription plus direct RPC logs; verified IDL parsing |
| Execution | Quote/execution abstractions and a durable outbox design | Local signing, PumpPortal/Jupiter routing, tip transactions | Local official SDK builders, single-transaction tips, durable signed-byte recovery |
| Exit policy | Domain policies and measurable distress-based tips | Staged partial exits, hard-stop trigger, developer-sell and flash-crash response | Deterministic integer ladder and staged trailing policy |
| Accounting | Separate position/outbox stores | Explicit quantity-conservation and startup reconciliation invariants | Signature-specific finalized fills and persisted cost basis |
| Reliability | Circuit/rate abstractions and testable adapters | Operational experience encoded in guards and reconciliation rules | Redundant transports, finite deadlines and a single state writer |

No benchmark establishes either repository as the fastest overall. Comments claiming sub-20-ms or zero-allocation behavior are not measurements.

## Findings

Severity describes the consequence if the identified path is used. Static findings do not establish that a particular path was active in a running bot.

| Severity | Evidence | Finding and effect | Fusion treatment |
|---|---|---|---|
| Critical | `SOL-SYLPH/SOS.py:7437`, `:7549` | Transaction-builder TLS validation is disabled; RPC uses `verify=False`. Returned transactions are then signed. A network attacker can potentially substitute the transaction message. | Verified TLS; locally generated pump instructions; bounded Jupiter exit adapter |
| Critical | `SOL-SYLPH/SOS.py:7396` vicinity | A wallet-specific branch fabricates a 999-SOL balance and blocks that wallet's sells. This bypasses funding checks and can trap a position. | No wallet-specific policies or fabricated balances |
| High | `sylph/sylph/application/execution.py:38`, `:56` | Check-then-await-then-store allows two concurrent calls with the same intent to both submit. `_fills` exists only in process memory. | One economic writer and persisted pending signed transaction |
| High | `sylph/sylph/application/outbox.py:65` | `recover_in_flight` resets an uncertain order to pending without reconciling its chain signature. Retrying can create another economic trade if the first landed. | Signature reconciliation before replacement; identical-byte retries |
| High | `sylph/sylph/adapters/jupiter.py`, `submit` | A sender's returned signature immediately becomes a `Fill` using quote amounts and zero fees. Acceptance is not confirmation; quote output is not an actual fill. | Finalized transaction token/SOL deltas, actual wallet costs |
| High | `SOL-SYLPH/SOS.py:7562` | Any wallet token-balance change is used as fill evidence. An unrelated transfer, concurrent trade, or delayed prior transaction can be misattributed. | Read only the submitted signature's metadata |
| High | `SOL-SYLPH/SOS.py:7529` | The path explicitly bypasses `require_jito` for debugging and broadcasts publicly. | Jito-only submission; no implicit public-send fallback |
| High | `SOL-SYLPH/lib/yellowstone_geyser.py:104–110` | Metadata is allocated but unused. The connected channel loops over `sleep(0.01)` without a Subscribe RPC or incoming message iteration. | Implemented subscription, ping response, stream iteration, watchdog and channel closure |
| High | `sylph/sylph/adapters/yellowstone.py:171–178` | Token is stored but never passed to the assumed client. A particular optional client's methods are assumed; normalization only concerns migrations. | Pinned, tested client API; actual transaction filters and events |
| High | `sylph/sylph/adapters/rugcheck.py:16–27` | Empty/unrecognized successful responses return zero risk. A numeric score is returned before danger-level risks are considered. | Require valid score and risks array; danger always rejects |
| Medium | `sylph/sylph/adapters/pumpportal_ws.py`, `messages` | Trade subscriptions are not replayed when an existing stream object reconnects. Its remembered window can suppress re-subscription for the same mint. | Program-level subscriptions are rebuilt on every connection |
| Medium | `sylph/sylph/adapters/jito.py`, `execute_exit_bundle` | Tip amount is computed after receiving an already signed transaction; this method cannot insert the calculated tip into that transaction. A reported tip does not prove payment. | Insert the selected tip before signing |
| Medium | `SOL-SYLPH/SOS.py:6779` vicinity | `getTipPercentiles` is sent to the bundle endpoint. This is not the documented public tip-floor API. | Documented tip-floor HTTP feed, bounded fallback |
| Medium | `SOL-SYLPH/SOS.py:7514–7522` | An emergency tip is hardcoded to 7.5 million lamports and sent as a separate transaction. This is an expensive uncapped policy at that call site; separate tips also have rebroadcast/uncle exposure. | Capped dynamic tip in the swap transaction |
| Medium | `SOL-SYLPH/SOS.py:7431` vicinity; binary parser | Floating-point balances, whole-token amounts and base-unit values coexist, including hardcoded decimal/supply assumptions. Native Python integers decoded from reserves are converted back to floats. | BigInt/BN base units and SDK fee schedules |
| Medium | `SOL-SYLPH/lib/yellowstone_geyser.py`, decoder | The declared zero-allocation parser slices bytes, creates strings/dicts and supplies artificial reserve defaults for short payloads. | Official typed decoding; unsupported payloads are rejected |
| Medium | `sylph/sylph/adapters/sqlite_outbox.py`, `put`; `infra/events.py`, `publish` | SQLite commits and synchronous subscribers can run on the event-loop path. `_fills` also has no retention bound. These are latency/growth risks, not proven leaks. | DB worker, bounded discovery/deduplication, short synchronous feed processing |
| Medium | `SOL-SYLPH/SOS.py` task creation and repeated `ClientSession` construction | Many detached tasks and per-attempt clients complicate error supervision and repeatedly pay connection setup costs. | Managed feed lifetime and persistent HTTP transport pools |
| Policy | `SOL-SYLPH/exit_engine.py` introductory claims | Half of a position sold at +20% does not recover the full original investment; a stop trigger cannot guarantee its fill price. | Correct accounting and explicit trigger semantics |

The multiple gigabyte-scale logs/databases and very large rejection logs observed in the source directory are operational growth evidence, not proof of a memory leak. No blanket claim of a leak or unhandled rejection is made without a concrete path.

## Feature fusion matrix

| Requested feature | Implemented behavior | Important boundary |
|---|---|---|
| Fast stream ingestion | Real Yellowstone filtered transaction subscription; concurrent WSS logs feeds; signature deduplication | Confirmed commitment deliberately avoids trading on processed-only forks |
| Failover | Independent stream reconnection; HTTPS RPC rotation; monotonic account context | All-provider outages still stop fresh data; missed launches are not backfilled |
| Curve and fees | Pinned official pump SDK quotes and V2 builders with account snapshots | Native SOL quote curves only; unsupported Token-2022 extensions and special modes are rejected |
| Slippage | Integer output floor on sells; reduced target tokens with fixed maximum input on buys | Market moves may cause rejection instead of a fill |
| Safety | Authority checks, extension allowlist, creator SOL/token balances, developer sells, reserve depth, RugCheck, holder concentration | Largest-20 accounts are aggregated by owner; the entire unobserved supply tail counts against the cap. This can reject safe distributions and cannot identify colluding wallets |
| Priority | Jito tip-floor sample, fee-market sample, simulated CU consumption plus margin, explicit cost caps | No guarantee of inclusion; no public routing fallback |
| Execution | Tip and swap signed together; signatures/bytes persisted before network I/O | One in-flight order per wallet; finalization can delay other exits |
| Adaptive exits | Partial ladder, staged trail, stop, developer/reserve panic, graduation routing | The implementation responds to observed state and cannot front-run already confirmed events |
| Configuration | Central typed schema with range and cross-field checks | Provider credentials and strategy calibration remain deployment inputs |
| Recovery | Finalized signature metadata; conservative expiry across all RPCs; durable quantities/cost basis | RPC historical indexing is trusted; production acceptance must test provider consistency |

## Why these upgrades matter

The main correctness improvement is making a transaction signature the identity of an economic attempt. A bundle acknowledgement never closes the accounting loop. Unknown submission state remains unknown until the chain resolves it; retrying the same message retains the same signature.

The main latency improvements are removing external PumpPortal construction for curve trades, avoiding per-trade HTTP sessions, keeping disk commits off the feed thread, avoiding task-per-packet work, and issuing independent account reads concurrently. PDA/instruction compilation remains local. The implementation does not claim literal zero-copy parsing: protobuf, base64, Anchor and transaction serialization still allocate.

Pre-signing an unknown future swap is inappropriate because its reserves, amounts, fee recipients, recent blockhash and expiry can change. This version signs only after current construction and simulation. It favors bounded, observable execution over an unmeasured microsecond target.

Machine-learning artifacts, online retraining, GUI rendering, mutable global valuation caches, forced trade quotas, and wallet-specific bypasses were discarded from the live execution path. They need separate chronological validation and a stable signal contract before they can improve a production decision process.

## Verified interface references

- Pump's current V2 buy documentation defines base-unit amounts and a fee-inclusive maximum quote cost. The local implementation uses the official SDK to build those accounts and instructions. [Pump buy V2](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/BUY.md).
- Pump fee configuration changes with the protocol; the implementation reads live account state instead of relying on a fixed percentage. [Pump fee program](https://github.com/pump-fun/pump-public-docs/blob/main/docs/FEE_PROGRAM_README.md).
- Jito documents bundle submission, tip accounts, minimum tips and the separate tip-floor service. Its bundle acceptance response is not treated as a landed fill. [Jito transaction sending](https://docs.jito.wtf/lowlatencytxnsend/).
- Solana prioritization cost depends on requested compute units and unit price, which is why the code bounds their product after simulation. [Solana fees](https://solana.com/docs/core/fees).
- Yellowstone provides actual streaming subscriptions; opening a gRPC channel alone is insufficient. [Official Yellowstone project](https://github.com/rpcpool/yellowstone-grpc).
- Jupiter supports instruction responses that can be composed with local compute-budget and tip instructions. Its route builder remains an external trust dependency for graduated exits. [Jupiter instruction building](https://developers.jup.ag/docs/swap/v1/build-swap-transaction).
