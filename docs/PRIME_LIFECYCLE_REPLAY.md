# PRIME Lifecycle Replay — SYLPH Fusion (read-only research)

## Status and boundaries

This is a stand-alone, dependency-free Node ESM replay tool that can be copied into
`scripts/prime-lifecycle-replay.mjs` and tested with
`node --test test/prime-lifecycle-replay.test.mjs`. It does not
connect to exchange providers, submit transactions, change strategy rules,
write to any wallet, or grant live trading authority.

It does **not** parse old snapshots or the repository's `data/paper_trades.csv`
into certified PRIME history. Those records do not supply a unique PRIME signal
ID, exact route-size quotes at available-at time, or transaction finality.

## Run

```bash
node scripts/prime-lifecycle-replay.mjs examples/prime-replay.synthetic.json artifacts/prime-replay-report.json
node --test test/prime-lifecycle-replay.test.mjs
```

The optional output path is create-only (will not overwrite a previous report).
Omit it to emit JSON to stdout. Report includes SHA-256 of exact input bytes.

## Input JSON (`sylph-prime-lifecycle-v1`)

```json
{
  "schema": "sylph-prime-lifecycle-v1",
  "opportunities": [{
    "id": "signal-unique-id", "mint": "actual-token-mint", "symbol": "EXAMPLE",
    "signal": {"atMs":100000,"receivedAtMs":100100,"referencePriceUsd":1.0},
    "budgetUsd":100, "horizonEndMs":150000,
    "quotes": [{
      "id":"buy-1", "side":"BUY", "quotedAtMs":100200,
      "availableAtMs":100300,"expiresAtMs":101800,
      "provider":"provider-identity","routeId":"quote-route-identity",
      "simulatedOk":true,"feeUsd":0.5,
      "inputUsd":100,"outputTokenQty":99.5
    },{
      "id":"sell-1", "side":"SELL", "quotedAtMs":119900,
      "availableAtMs":120000,"expiresAtMs":121500,
      "provider":"provider-identity","routeId":"exit-route-identity",
      "simulatedOk":true,"feeUsd":0.5,
      "inputTokenQty":99.5,"outputUsd":160
    }],
    "fills": [{
      "id":"buy-fill-1","side":"BUY","atMs":101000,
      "observedAtMs":101100,"kind":"CHAIN_FINALIZED",
      "signature":"verified-transaction-signature", "tokenQty":99.5,
      "grossUsd":100,"feeUsd":0.5
    }]
  }]
}
```

Quote amounts must correspond to the **whole exact** input budget or exact
sell quantity; the replay never scales larger or smaller exit quotes, as
that could erase market impact. It excludes quotes with failed simulation,
expired validity, or information available after the hypothetical decision.
The default assumed quote-to-order delay is 500 ms and **does not model chain
landing**; a route quote is only a modeled candidate, not a realized fill.

Amounts are USD-equivalent at the event time. Fees include all applicable costs
and must be normalized by a trusted upstream adapter (base fee, priority fee,
tip, rent where nonrecoverable, swap fee, transfer taxes). Token quantities must
be in human units with correct mint decimals. No RPC conversion is embedded.

`CHAIN_FINALIZED` is a claim made by the input data. The replay checks structural
validity and requires a signature but does not independently query a chain to
verify confirmation or token balance deltas. `PAPER` must remain labeled as
paper. Inputs should additionally carry trusted provenance externally.

## Outputs, diagnostic hierarchy

| Field | Meaning |
|---|---|
| `signal.receptionDelayMs` | Difference between issuance and engine receipt |
| `entryOpportunity` | Earliest quote for the budget known after receipt and valid past assumed delay |
| `actualEntry` | Observed buy-fill quantity and USD cost basis (including fees) |
| `bestObservedExit` | Hindsight best available simulated SELL quote for exact full entry size |
| `actualExit.realizedPnlUsd` | Sold-quantity proceeds minus pro-rata entry cost |
| `actualExit.finalNetPnlUsd` | Fully exited PnL or marked complete outcome (null if open and unpriced) |
| `decomposition.entryVsEarliestAvailableQuotePct` | Cost-per-token deterioration, not necessarily network latency |
| `decomposition.firstFillVsContemporaneousQuotePct` | Quote-to-fill difference, potential execution drag |
| `decomposition.grossRetentionOpportunityUsd` | Best observed whole-position quote net PnL minus actual final/marked PnL |
| `decomposition.exitCoverageComplete` | Whether sampled exit quote gaps meet a configured maximum |

Tags are hypotheses, not causality assertions:

* `TOKEN_SELECTION_CANDIDATE`: even best recorded size-matched exit is not profitable, with dense quote coverage.
* `SIGNAL_OR_ORDER_LATENCY_CANDIDATE`: actual entry later and more expensive than earliest available buy quote.
* `ENTRY_EXECUTION_DRAG_CANDIDATE`: actual fill was more expensive than contemporaneously available quote.
* `PROFIT_RETENTION_CANDIDATE`: sizeable net gap between best quoted exit and final outcome, with dense quote coverage.
* `NOT_ATTRIBUTABLE_WITH_AVAILABLE_EVIDENCE`: no justified candidate tag.

The tag ranking has **not** been statistically calibrated on a representative
PRIME dataset. The best quote is a post-hoc *sampled opportunity*, not a promise
that an order could land at that price. The full-horizon lookahead must never
be used as a live trading feature or model input. Quote density does not prove
market continuity, and missing/delisted tokens should remain in cohorts.

## Required upstream collection to analyze real PRIME signals

At emission: immutable signal ID, mint, creation/receipt timestamps, strategy,
feature versions, reference price, and rejected/suppressed candidates.
At quote request/response: request time, availability time, expiry, source,
route ID, exact input/output size, fee breakdown, simulation status, market
slot, pool state hash, liquidity, and provider identity. Keep rejected routes.
At order: request/send times, policy decision, intended quantity, quote ID,
transaction signature, blockhash horizon, simulation outcome and failures.
At fill/reconciliation: finalized balance deltas, execution fees, paid tax,
partial fills, terminal state, signature and independent verification.
At observation window: periodic sell quotes (even when no sale occurs), failure
gaps, provider outages, and a stated horizon (e.g. 3h); avoid last-known-price
carry-forward through missing intervals.

**No change to live trading rules** should be made from this replay alone. First
reconstruct the actual six PRIME mints with these fields, run the replay, compare
results by latency and entry/exit route quality, and validate on an unseen
forward-paper cohort before considering a policy change.