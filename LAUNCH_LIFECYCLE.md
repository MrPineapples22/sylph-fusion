# Launch Lifecycle Contract

The lifecycle reducer separates market lifecycle from health and liquidity. It supports discovered, curve-active, near-complete, curve-complete, migration verification, destination verification, DEX-active and post-graduation states.

Transitions carry an event ID, provider, slot, event and observed time, raw payload hash, and decoder version. Duplicate event IDs and lower-slot callbacks are rejected. DEX activation requires a mint-bound destination certificate with evidence IDs.

During migration states, missing destination liquidity is `UNKNOWN`; zero curve liquidity cannot itself cause a death or low-liquidity conclusion. This contract has unit coverage but no durable journal, reorg mechanism, or runtime adoption yet.

