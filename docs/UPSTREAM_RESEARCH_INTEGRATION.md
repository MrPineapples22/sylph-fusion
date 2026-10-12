# Upstream Solana Research Integration

This note records five reusable ideas from every GitHub repository linked in the supplied research share and maps them to Sylph Fusion. These are design adaptations; upstream code has not been copied. The share could not be fetched by the browser during this pass, so this inventory uses the repository links and findings already extracted from it. It covers the six linked upstream repositories identified in that research.

## Data and evaluation path

```text
RPC / Geyser / WebSocket observations
  -> feed adapters and YellowstoneTruthBridge
  -> MultiSourceCrossValidator (freshness, disagreement, source independence)
  -> canonical SylphEvent / FusionEnvelope and append-only FusionJournal
  -> parser and market/route research
  -> resolved, paired transport landing observations
  -> SolanaTransportTournament (research candidate or abstain)
  -> MainnetRealityTournament / evidence and review
```

The upper ingestion and evidence stages exist in the target repository. The transport scorecard now accepts resolved observations through `recordResolvedAttempt`; no live collector currently feeds it automatically. A positive score is only a `RESEARCH_CANDIDATE`, has no promotion authority, and cannot authorize a transaction. A live landing benchmark, replay capture, and durable adapter remain separate integration work. No paid benchmark or on-chain transaction was run as part of this update.

## Repository concepts mapped to Sylph Fusion

| Upstream repository | Five ideas and target mapping |
|---|---|
| [lamports-dev/richat](https://github.com/lamports-dev/richat) | 1. Multiplex several source streams: feed/ingestion adapters. 2. Deduplicate events: `YellowstoneTruthBridge` and ingestion tests. 3. Filter before fan-out: provider and event adapter boundaries. 4. Track transport health/latency: feed and bridge metrics. 5. Route filtered subscriptions hierarchically: current provider adapters; a shared generalized subscription router remains a gap. |
| [0xfnzero/solana-streamer](https://github.com/0xfnzero/solana-streamer) | 1. Normalize events across transports: canonical event adapter. 2. Support RPC and Geyser input: feed and Yellowstone bridge. 3. Apply program/source filters: ingestion adapter boundary. 4. Update subscriptions without rebuilding consumers: partial adapter capability; unified dynamic subscription control remains a gap. 5. Bound queues and stop gracefully: feed lifecycle handling; explicit cross-adapter backpressure contract remains a gap. |
| [0xfnzero/sol-parser-sdk](https://github.com/0xfnzero/sol-parser-sdk) | 1. Typed protocol parsing: platform parser modules. 2. Parse RPC/stream/shred observations into shared event shapes: canonical event path; a single universal input parser is not present. 3. Attribute CPI/instruction context: CPI trace normalization. 4. Decode account state with versioned layouts: token/account parsers. 5. Fail closed on truncated or malformed bytes: parser validation and negative tests. |
| [Netticode-Oy/solana-landing-benchmark](https://github.com/Netticode-Oy/solana-landing-benchmark) | 1. Compare lanes on the same benchmark event: paired `benchmarkEventId` requirement. 2. Resolve actual land/failure/no-land outcomes: `recordResolvedAttempt`. 3. Separate landing from successful execution: distinct landing and execution rates. 4. Include fee and tip costs in net edge: integer lamport arithmetic. 5. Report evidence instead of claiming from ACKs: unresolved attempts are rejected and optimizer returns abstain below sample threshold. On-chain verification and slot-normalized latency collection are not wired to this scorecard yet. |
| [mangiapanejohn-dev/MOBIUS-Searcher](https://github.com/mangiapanejohn-dev/MOBIUS-Searcher) | 1. Paper/research-first operation: no execution API in the scorecard. 2. Preserve losing and failed observations: every resolved outcome is retained. 3. Account in integer lamports: bigint cost calculations. 4. Make decisions from event evidence: matched samples and minimum count. 5. Gate promotion explicitly: `promotionAuthority: NONE`; runtime execution is not connected to the research candidate. |
| [rpcpool/yellowstone-grpc](https://github.com/rpcpool/yellowstone-grpc) | 1. Track slot/bank identity: Yellowstone and canonical event metadata. 2. Deduplicate stream deliveries: bridge dedupe. 3. Handle reconnect and replay boundaries: feed reconnect logic; finalized-cursor resume is not universally wired. 4. Distinguish observed/deshred from executed/finalized: commitment and chain-truth boundaries. 5. Preserve replay/provenance evidence: canonical event checksums and FusionJournal. |

## Transport scorecard contract

`SolanaTransportTournament` starts with empty telemetry. Each attempt must include a unique ID, benchmark event, program, region, congestion bucket, input notional, resolved outcome, measured costs, and gross edge. A paired sample is eligible only when all four lanes attempted the same event under the same program, region, congestion bucket, and notional. `NO_LAND` cannot carry a landing latency; failed landed execution cannot claim realized gross edge. The optimizer requires at least 30 eligible paired events and a positive expected net edge after observed base fee, priority fee, and tip. Otherwise it abstains.

The 30-event threshold is a conservative research gate, not a claim of statistical sufficiency for production trading. The estimate is a simple empirical mean; it does not model confidence intervals, changing market regimes, selection bias, or correlated samples. Those need independent protocol/quant review and out-of-sample evaluation before any runtime use.

## Evidence limits

- Existing adapters and tests show component behavior; they do not establish that the six upstream systems are all running together against live mainnet data.
- A transport lane win is not evidence of profitability. Edge inputs, slippage, priority fees, tips, missed landings, and market movement must be measured from a reproducible paper or shadow capture.
- The project has no automatic path from this scorecard to a signer or broadcaster. Keep that boundary intact until an independently reviewed release decision.
