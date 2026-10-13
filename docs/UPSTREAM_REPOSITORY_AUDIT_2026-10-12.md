# Upstream Repository Audit Coverage

Source list extracted from the supplied ChatGPT share on 2026-10-12. The share contained 108 unique GitHub repository roots after excluding one `github/topics` page. This inventory is a work ledger, not evidence that each entry received a source-level review. The integration document contains five-pattern notes for all 108 roots; 55 are explicitly README-only, and other rows identify limited or targeted source scope.

## Inventory

| Repository | Status |
|---|---|
| [0xChainDuck/barter-rs-solana](https://github.com/0xChainDuck/barter-rs-solana) | 5-pattern note recorded in integration map |
| [0xfnzero/pumpfun-sdk](https://github.com/0xfnzero/pumpfun-sdk) | 5-pattern note recorded in integration map |
| [0xfnzero/sol-parser-sdk](https://github.com/0xfnzero/sol-parser-sdk) | 5-pattern note recorded in integration map |
| [0xfnzero/sol-trade-sdk](https://github.com/0xfnzero/sol-trade-sdk) | 5-pattern note recorded in integration map |
| [0xfnzero/solana-program-idls](https://github.com/0xfnzero/solana-program-idls) | 5-pattern note recorded in integration map |
| [0xfnzero/solana-streamer](https://github.com/0xfnzero/solana-streamer) | 5-pattern note recorded in integration map |
| [0xNineteen/solana-arbitrage-bot](https://github.com/0xNineteen/solana-arbitrage-bot) | 5-pattern note recorded in integration map |
| [0xsupersimon/raydium-launchpad-bonkfun-transaction-parser-go](https://github.com/0xsupersimon/raydium-launchpad-bonkfun-transaction-parser-go) | 5-pattern note recorded in integration map |
| [aao056/solana-arbitrage-simulator](https://github.com/aao056/solana-arbitrage-simulator) | 5-pattern note recorded in integration map |
| [ACNoonan/solana-dlmm-meteora](https://github.com/ACNoonan/solana-dlmm-meteora) | 5-pattern note recorded in integration map |
| [AFKmoney/pumpfun-agent](https://github.com/AFKmoney/pumpfun-agent) | 5-pattern note recorded in integration map |
| [Akagi201/solana-workshop](https://github.com/Akagi201/solana-workshop) | Pinned implementation/examples audited; five patterns and hardcoded-key hazard recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [amirpraaven/solana-backtest](https://github.com/amirpraaven/solana-backtest) | 5-pattern note recorded in integration map |
| [andrewmiller92/solana-txn-parser](https://github.com/andrewmiller92/solana-txn-parser) | 5-pattern note recorded in integration map |
| [anza-xyz/mollusk](https://github.com/anza-xyz/mollusk) | 5-pattern note recorded in integration map |
| [api-evangelist/jito](https://github.com/api-evangelist/jito) | Third-party API catalog schema audited; five contract patterns and source-authority limitation recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [bimawa/ArbitrageBot](https://github.com/bimawa/ArbitrageBot) | Pinned source modules audited; five structural patterns and risk/math/send defects recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [Blockdaemon/solana-accountsdb-plugin-kafka](https://github.com/Blockdaemon/solana-accountsdb-plugin-kafka) | Pinned Geyser plugin, schema, filter, and publisher sources audited; five patterns and derived-field/filter hazards recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [BlockRazorinc/solana-e2e-benchmark](https://github.com/BlockRazorinc/solana-e2e-benchmark) | Pinned source and README audited; five timing/observation patterns and live-send/no-summary limitations recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [blockworks-foundation/quic_geyser_plugin](https://github.com/blockworks-foundation/quic_geyser_plugin) | Pinned plugin/server sources audited; five transport patterns and delivery/version caveats recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [bxlkm/jito-api](https://github.com/bxlkm/jito-api) | Third-party Jito API schemas audited; five contract patterns and non-authoritative-source caveat recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [coffellas-cto/pump-fun-raydium-launchpad-meteora-bonding-curve-copy-sniper-bot](https://github.com/coffellas-cto/pump-fun-raydium-launchpad-meteora-bonding-curve-copy-sniper-bot) | Pinned live bot source audited; five modular/observation patterns and reliability/performance caveats recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`; never executed. |
| [cxcx-ai/solana-dex-parser](https://github.com/cxcx-ai/solana-dex-parser) | Pinned adapter, classifier, and fixtures audited; five parsing patterns and unknown/live-fixture limitations recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [cxcx-ai/solana-parser-go](https://github.com/cxcx-ai/solana-parser-go) | Pinned adapter/context/ALT cache sources audited; five reusable parsing patterns and freshness limits recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [debridge-finance/solana-tx-parser-public](https://github.com/debridge-finance/solana-tx-parser-public) | Pinned IDL/custom parser and CPI helper sources audited; five parsing patterns and unknown/version limitations recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [Dolphins-Lab/searcher-examples-jito](https://github.com/Dolphins-Lab/searcher-examples-jito) | Pinned auth and subscription loops audited; five patterns and live credentials/execution limitations recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`; no service used. |
| [etcherfx/sol-trade](https://github.com/etcherfx/sol-trade) | Pinned research/promotion modules and parity tests reviewed; five candidate governance patterns and statistical limitations recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`; never run. |
| [franco-bianco/solanaswap-go](https://github.com/franco-bianco/solanaswap-go) | Pinned parser modules and README audited; five decode/output patterns and timestamp/attribution limitations recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [github/docs](https://github.com/github/docs) | Pinned README and contributing guide audited; five documentation UX patterns recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. Windows checkout was partial due path-length errors; application code/workflows were not reviewed. |
| [helius-labs/atlas-priority-fee-estimator](https://github.com/helius-labs/atlas-priority-fee-estimator) | Pinned fee ingestion, percentile, and RPC sources audited; five patterns and model/data limitations recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`; no service run. |
| [Hweippy/prism-client-sdk](https://github.com/Hweippy/prism-client-sdk) | Pinned SDK contract audited; five typed builder/layout patterns and omitted network-cost caveat recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`; no instruction built or sent. |
| [jenish-25/solana-Jupiter-Arb-bot](https://github.com/jenish-25/solana-Jupiter-Arb-bot) | Pinned 2-commit source modules audited; five architectural patterns and quote/fee calculation defects recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`; no execution. |
| [Jethrolopwus/oddsForge](https://github.com/Jethrolopwus/oddsForge) | Pinned signal, strategy, and Jito adapter sources audited; five state/UX patterns and in-memory, heuristic, duplicate-send limitations recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`; no feed or execution. |
| [jito-foundation/geyser-grpc-plugin](https://github.com/jito-foundation/geyser-grpc-plugin) | Pinned plugin, config, stream, and client auth sources audited; five stream patterns and backpressure/no-replay limitations recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [jito-foundation/jito-solana](https://github.com/jito-foundation/jito-solana) | Pinned bundle locking, storage, tip manager, and cost adjustment sources audited; five validator design patterns and no searcher profitability claim recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [jito-foundation/priority-fee-sharing](https://github.com/jito-foundation/priority-fee-sharing) | Pinned RocksDB fee record/index source and lifecycle audited; five persistence patterns and payment-authority boundary recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [jito-labs/jito-ts](https://github.com/jito-labs/jito-ts) | Pinned TypeScript bundle/Geyser clients and examples audited; five transport patterns and unsafe timeout-as-processed caveat recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [jito-labs/mev-protos](https://github.com/jito-labs/mev-protos) | Pinned protobuf schemas audited; five RPC, event lifecycle, auth, and expiry patterns recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [jito-labs/searcher-examples](https://github.com/jito-labs/searcher-examples) | Pinned auth and client examples audited; five modularity and subscription patterns plus no-live-execution limitation recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [jito-labs/jito-docs](https://github.com/jito-labs/jito-docs) | 5-pattern note recorded in integration map |
| [jito-labs/shredstream-proxy](https://github.com/jito-labs/shredstream-proxy) | Pinned shred reconstruction, forwarder, heartbeat, and auth sources audited; five feed patterns and no-canonical-replay limitation recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [jup-ag/docs](https://github.com/jup-ag/docs) | 5-pattern note recorded in integration map |
| [justFiveDev/Solana-Copy-Trading-Bot](https://github.com/justFiveDev/Solana-Copy-Trading-Bot) | Pinned observation/parser/venue and utility sources audited; five modularity patterns and floating-point/processed-signal caveats recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [katlogic/solana-arbitrage-bot](https://github.com/katlogic/solana-arbitrage-bot) | Pinned main worker/config source and README audited; five architecture patterns and beta/static-tip/no-profit-evidence limits recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [kevinheavey/anchor-bankrun](https://github.com/kevinheavey/anchor-bankrun) | Pinned provider source and README audited; five local bank testing patterns and missing RPC-connection boundary recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [kevinheavey/anchorpy](https://github.com/kevinheavey/anchorpy) | Pinned README and Python package metadata audited; five client/test packaging patterns and version coupling recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [kevinheavey/solana-bankrun](https://github.com/kevinheavey/solana-bankrun) | Pinned README and deprecation guidance audited; five deterministic bank testing patterns recorded. Deprecated upstream directs new users to LiteSVM. |
| [kevinheavey/solders](https://github.com/kevinheavey/solders) | Pinned README and changelog audited; five typed SDK/serialization/testing patterns and version compatibility caveat recorded. |
| [khayreali/WalkForwardBacktester](https://github.com/khayreali/WalkForwardBacktester) | README-only: five documented walk-forward/cost accounting patterns; no implementation or dataset review. |
| [Kric123/walk-forward-eval](https://github.com/Kric123/walk-forward-eval) | README-only: five documented leakage/selection-bias checks; no implementation or dataset review. |
| [LaChance-Lab/jito-shredstream-proxy-rust](https://github.com/LaChance-Lab/jito-shredstream-proxy-rust) | README-only: five deployment/configuration patterns; no source review or feed connection. |
| [lamports-dev/richat](https://github.com/lamports-dev/richat) | 5-pattern note recorded in integration map |
| [LiteSVM/litesvm](https://github.com/LiteSVM/litesvm) | Pinned README and quickstart audited; five in-process VM testing patterns and cluster-parity boundary recorded in `docs/UPSTREAM_RESEARCH_INTEGRATION.md`. |
| [LiteSVM/litesvm-go](https://github.com/LiteSVM/litesvm-go) | README-only: five test-harness/deployment patterns recorded; local dependency publication caveat retained. |
| [mangiapanejohn-dev/MOBIUS-Searcher](https://github.com/mangiapanejohn-dev/MOBIUS-Searcher) | 5-pattern note recorded in integration map |
| [mayor01234/solana-smart-transaction-stack](https://github.com/mayor01234/solana-smart-transaction-stack) | README architecture and flow audited; five integration/fault-injection patterns recorded with live-performance claims marked unverified. |
| [metaplex-foundation/blockbuster](https://github.com/metaplex-foundation/blockbuster) | README-only: five parser boundary/scope patterns recorded; no parser implementation or fixtures reviewed. |
| [MeteoraAg/dlmm-sdk](https://github.com/MeteoraAg/dlmm-sdk) | README-only: five project/test boundary patterns recorded; protocol math and parser behavior were not reviewed. |
| [MeteoraAg/docs](https://github.com/MeteoraAg/docs) | README-only: five documentation workflow/authority patterns; protocol documentation was not inspected. |
| [mooncitydev/solana-copytrading-bot](https://github.com/mooncitydev/solana-copytrading-bot) | README-only: five advertised architecture/safety patterns; no source or live behavior reviewed. |
| [MrPineapples22/sylph-fusion](https://github.com/MrPineapples22/sylph-fusion) | README-only: five current-state/evidence documentation patterns; no historical code paths or claims were independently audited. |
| [mrthomasbigproblem/meteora-dlmm-bot](https://github.com/mrthomasbigproblem/meteora-dlmm-bot) | README-only: five advertised modularity and UI/configuration patterns; no execution or profitability verified. |
| [Netticode-Oy/solana-landing-benchmark](https://github.com/Netticode-Oy/solana-landing-benchmark) | 5-pattern note, README-only; code not present at pinned revision |
| [nhuxhr/pumpfun-rs](https://github.com/nhuxhr/pumpfun-rs) | README-only: five package boundary/local development patterns; SDK source and protocol behavior were not reviewed. |
| [nirholas/pump-fun-sdk](https://github.com/nirholas/pump-fun-sdk) | README-only: five offline-builder/interface patterns; no implementation/protocol validation. |
| [nirholas/three.ws](https://github.com/nirholas/three.ws) | README-only and unrelated to Solana trading; only transferable UI/developer workflow ideas noted. |
| [orca-so/typescript-sdk](https://github.com/orca-so/typescript-sdk) | README-only: five surface/deprecation patterns; legacy pool SDK is explicitly deprecated. |
| [orca-so/whirlpool-sdk](https://github.com/orca-so/whirlpool-sdk) | README-only: five migration/scope patterns; SDK is deprecated. |
| [orca-so/whirlpools](https://github.com/orca-so/whirlpools) | README-only: five package/deployment/verifiability patterns; no math or program source audited. |
| [orca-so/whirlpools-cpi-examples](https://github.com/orca-so/whirlpools-cpi-examples) | README-only: five versioning/client/use-case patterns; no CPI code or audits reviewed. |
| [otter-sec/anchor](https://github.com/otter-sec/anchor) | README-only: five workspace/IDL/version management patterns; no framework source reviewed. |
| [PatrickSylvestre/solana-trading-cli](https://github.com/PatrickSylvestre/solana-trading-cli) | README-only: five connector/docs patterns; advertised live trading performance is unverified. |
| [piotrostr/shreds](https://github.com/piotrostr/shreds) | README-only: five gap/metric patterns; upstream itself documents loss and overflow risks. |
| [PTHAICAP/backtest-engine](https://github.com/PTHAICAP/backtest-engine) | README-only: five anti-leakage/cost-selection patterns; no implementation or results audited. |
| [pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs) | Official documentation audited on 2026-10-12: instruction generations/account layouts, token-program variants, synthetic migration, fee accounting, and signed PumpSwap reserves. See `docs/UPSTREAM_RESEARCH_INTEGRATION.md`; no local protocol support claimed. |
| [raydium-io/raydium-cp-swap](https://github.com/raydium-io/raydium-cp-swap) | README-only: five CPMM/token program/toolchain/audit scope patterns; no program code or quote logic audited. |
| [raydium-io/raydium-docs-v1](https://github.com/raydium-io/raydium-docs-v1) | README-only: five documentation organization/version-pin patterns; page claims were not audited. |
| [raydium-io/raydium-sdk-V2](https://github.com/raydium-io/raydium-sdk-V2) | README-only: five SDK usage/test organization patterns; no code or transaction behavior reviewed. |
| [raydium-io/raydium-sdk-V2-demo](https://github.com/raydium-io/raydium-sdk-V2-demo) | README-only: five sample/config/execution-boundary patterns; no demo executed. |
| [replicolabs/copilot](https://github.com/replicolabs/copilot) | README-only: five architecture/evidence patterns; live operation and autonomous retry claims not verified. |
| [rpcpool/yellowstone-grpc](https://github.com/rpcpool/yellowstone-grpc) | 5-pattern note recorded in integration map |
| [rpcpool/yellowstone-grpc-mango](https://github.com/rpcpool/yellowstone-grpc-mango) | README-only: five stream/reconstruction patterns with known block reconstruction and validator-version issues recorded. |
| [SalahMessaoud/mako](https://github.com/SalahMessaoud/mako) | README-only: five advertised discovery/UI/risk patterns; implementation and safety claims unverified. |
| [Sam-Jeston/litesvm-jup-swap-example](https://github.com/Sam-Jeston/litesvm-jup-swap-example) | README-only: five fixture-based local integration-testing patterns; no fixtures or swap flow reviewed. |
| [sohan-shingade/mev-kit](https://github.com/sohan-shingade/mev-kit) | README-only: five paper/backtest/UI architecture patterns; alpha/no-mainnet-validation status retained. |
| [solana-developers/solana-tools](https://github.com/solana-developers/solana-tools) | README-only: five ecosystem catalog/discovery patterns; no listed tool is endorsed by this entry. |
| [solana-foundation/anchor](https://github.com/solana-foundation/anchor) | README-only duplicate of the inspected `otter-sec/anchor` revision/content; not counted as independent implementation evidence. |
| [solana-foundation/developer-content](https://github.com/solana-foundation/developer-content) | README-only: five content/UI ownership patterns; README directs new contributions to `solana-com`. |
| [solana-foundation/program-examples](https://github.com/solana-foundation/program-examples) | README-only: five example/framework/test organization patterns; no example source audited. |
| [solana-foundation/solana-com](https://github.com/solana-foundation/solana-com) | README-only: five monorepo/docs/UI package patterns; no application source audited. |
| [solana-foundation/solana-dev-skill](https://github.com/solana-foundation/solana-dev-skill) | README-only: five skill scope patterns; version guidance is fast-moving and skill contents were not reviewed. |
| [solana-foundation/solana-mcp](https://github.com/solana-foundation/solana-mcp) | README-only: five ingestion/retrieval/tool boundary patterns; source freshness and tool execution were not checked. |
| [solana-labs/solana-program-library](https://github.com/solana-labs/solana-program-library) | README-only: five package migration/lineage patterns; repo states implementations have moved. |
| [solana-program/token](https://github.com/solana-program/token) | README-only: five canonical ID/client separation patterns; no instruction or account code audited. |
| [solana-program/token-2022](https://github.com/solana-program/token-2022) | README-only: five program/extension/package patterns; no extension behavior audited. |
| [solsonar/solana-multi-dex-decoder](https://github.com/solsonar/solana-multi-dex-decoder) | README-only: five owner-ID/zero-RPC/normalization patterns; no parser implementation or fixtures reviewed. |
| [solsonar/yellowstone-grpc-client](https://github.com/solsonar/yellowstone-grpc-client) | README-only: five stream/auth/health patterns; delivery completeness unverified. |
| [Tee-py/solana-txn-parser](https://github.com/Tee-py/solana-txn-parser) | README-only: five parser/API patterns; Jupiter is marked unsupported/incomplete. |
| [tradingstrategy-ai/getting-started](https://github.com/tradingstrategy-ai/getting-started) | README-only: five strategy education/research workflow patterns; no notebook results checked. |
| [TreeCityWes/Pump-Fun-Trading-Bot-Solana](https://github.com/TreeCityWes/Pump-Fun-Trading-Bot-Solana) | README-only: five staged-exit/UI-dependency patterns; fixed thresholds are unvalidated. |
| [Umiiii/solparser](https://github.com/Umiiii/solparser) | README-only: five RPC/parser contract patterns; attribution accuracy not evaluated. |
| [Vo1ganin/solana-rpc-skill](https://github.com/Vo1ganin/solana-rpc-skill) | README-only: five provider/source-provenance patterns; this is a generated mirror whose canonical source is elsewhere. |
| [web3cryptosolutions/open-alpha-ai-trading-solana-agent](https://github.com/web3cryptosolutions/open-alpha-ai-trading-solana-agent) | README-only: five modularity/mock-mode/explainability patterns; no runtime claims verified. |
| [WSOL12/Solana-Arbitrage-Bot](https://github.com/WSOL12/Solana-Arbitrage-Bot) | README-only: five route/outcome tracking patterns; sample wallet/transaction were not independently reconciled. |
| [yashab-cyber/pumpfun](https://github.com/yashab-cyber/pumpfun) | README-only: five UI/memory/modularity patterns; promotional capability claims unverified. |
| [Yashit2005/statvalid-backtester](https://github.com/Yashit2005/statvalid-backtester) | README-only: five statistical validation patterns; no implementation or reported result independently verified. |
| [yuno-research/solana_copy_trading](https://github.com/yuno-research/solana_copy_trading) | README-only: five lifecycle/pipeline patterns; execution/settlement claims unverified. |
| [Ze-yane/Solana-smart-stacks](https://github.com/Ze-yane/Solana-smart-stacks) | README-only: five fallback/evidence patterns; reported live behavior and AI tip quality unverified. |

## Review standard

- For implementation repositories, inspect a pinned source revision, relevant implementation files, and tests where available. Record five transferable patterns with a concrete Sylph connection, plus material limits or unsafe assumptions.
- For documentation or schema-only repositories, say so and review five contract properties or documented operational ideas; do not imply code behavior was run.
- For stale, incomplete, or unsafe repositories, record useful negative lessons and do not adapt unsupported behavior.
- Review is research only. No copied implementation, production execution, or profit claim follows from an upstream pattern.
