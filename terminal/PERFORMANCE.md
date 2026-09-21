# SYLPH performance review

## What happened to the websites?
The new React simulator replaced the older market dashboard, but its research dock was omitted. Restored Rugcheck, Solsniffer, Bubblemaps, DEX Screener, Pump.fun, GMGN, Axiom, Photon, BullX, and Jupiter under Research & Forensics. These open external sites; they are not API integrations or automatic safety checks. Synthetic assets have no verified mint, so links open the service rather than an invented token report. The previous dashboard remains available through Start-Legacy-App.cmd.

## Implemented changes

| Bottleneck | Refactor | Benefit |
| --- | --- | --- |
| Chart setData on every 250ms tick | update latest point; full reset only on selection or every 60 seconds | Avoids repeatedly replacing up to 300 chart points; periodic reset bounds retained chart data |
| Delete/recreate five price lines per tick | Reuse line objects; depend on entry/stop values | Fewer chart allocations and layout invalidations |
| New Intl.NumberFormat per money value | Cache formatters by precision | Reuses ICU formatting setup across rows and ticks |
| All audit rows rendered on every price tick | React.memo AuditTape and stable log identity | Audit rendering runs only when events or filtering change |
| Clone all histories and logs on every action | Clone histories only for market ticks; logs only on append | Settings, orders and settlement no longer copy all market history |
| Indicator slice/map/reduce chains | Single bounded 20-sample pass | Removes temporary arrays and redundant passes |
| Two nested position/asset scans | Build price index and aggregate once | O(A + P) metrics instead of O(A × P) |
| Synchronous full-session persistence every 2 seconds | 5-second checkpoint plus pagehide | 60% fewer scheduled synchronous writes |

Inline comments in src/engine.js and src/main.jsx explain the performance-sensitive changes. Full refactored source and built assets are included in SYLPH-Paper-Terminal.zip.

## Measurements and validation

A deterministic, paused-bot workload of 20,000 market ticks was warmed up and measured seven times for each implementation. Median elapsed time on this host: **190.03 ms before, 139.39 ms after**, approximately **26.6% less reducer time**. This benchmark does not measure browser FPS, active-bot throughput, storage latency, or whole-application speed. No claim of a measured memory reduction is made.

Production build passed. All **19 engine tests** passed, including a new reference-sharing test. Browser checks confirmed all ten research links, successful manual paper fill, and an empty error log immediately afterward.

## Remaining constraints and trade-offs

- Small position/pending scans remain in automation and settlement. Worst-case nested scans grow with assets and positions, but this app caps both at five. Maintaining mutable indexes for these tiny collections would add synchronization risk with little demonstrated benefit.
- The root view still rerenders at 4 Hz to display live prices. Audit and research components now skip unchanged renders. A worker or external store could help hundreds of assets, but adds message-copying, ordering, and recovery complexity that this workload does not justify.
- Market history arrays remain immutable copies on each tick (five arrays, up to 300 entries). A ring buffer could reduce allocation, but would complicate reducer purity, persistence, and chart adapters.
- sessionStorage remains synchronous, including JSON serialization. Five-second checkpoints can lose up to five seconds if the browser crashes; pagehide is a best effort, not crash durability. IndexedDB is an option if durable, larger sessions become necessary.
- Chart data is reset every 60 seconds to remove expired points. This introduces a small periodic refresh in exchange for bounded chart memory.
- No obvious unbounded timer, chart, event-listener, or object-URL leak was found in the reviewed terminal. Timers/listeners/chart resources have cleanup; audit history and model history are capped. This is a code review, not a long-duration heap-profiler certification.
- Static HTTP reads are asynchronous. Launcher file operations are synchronous but run only at startup, outside the trading UI; rewriting them offers little runtime benefit.
- Audit append still copies at most 300 references. That is intentional: immutable identity changes drive reliable rendering and limit memory.
- Research links do not add background requests, iframe renderers, subscriptions, or third-party scripts.

## Scope
Review and edits focused on the new React simulator, its reducer, chart, persistence and local launcher/server. The legacy on-chain engine and third-party services were not performance-audited or changed.
