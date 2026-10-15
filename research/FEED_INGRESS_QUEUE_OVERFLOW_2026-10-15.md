# Feed ingress queue overflow: evidence and bounded mitigation

## Scope

This note records the user-supplied incident analysis and a local database-write optimization. The recorded production metrics below were provided by the user and have not been independently queried or reproduced from the affected live process. No live process was started, stopped, or reconfigured during this work.

## Reported measurements

The user reports a serial projection lane slowing from roughly 34 ms per commit shortly after startup to about 99 ms p50 / 317 ms p99 after the rolling equity history reached about 3,496 samples. The reported finalized replay rate is 37–39 accepted transactions/s, while later projection throughput is about 9–10 commits/s. The user also reports approximately 147 KB of state JSON duplicated in two persisted locations, an additional approximately 30 KB projection JSON, and identical state hashes in about 90% of recent commits.

The user further reports 185 WebSocket sessions with 164 ending between 28 and 31.5 seconds, and that endpoint 0 (Helius) never connected. A new local controlled test confirms that while a `ws` client socket is paused, an inbound WebSocket ping does not produce an automatic pong until the socket resumes. This supports the mechanism behind the user's 30-second watchdog hypothesis, but it does not reproduce the affected provider session or prove which observations were lost in production.

## Source facts confirmed in this worktree

- `src/feed.ts` has a bounded serial ingress drain, a 256-item queue cap, 16 MiB byte cap, and WebSocket pause/resume thresholds. The current branch already contains the 256-item cap and signature coalescing.
- `test/platform/feed-paused-websocket-control.test.mjs` uses a local WebSocket server to prove that pause suspends processing of inbound control frames; the automatic pong arrives only after resume.
- The feed calls `registerSlot(slot, 1, false)` for observations that do not carry contiguous coverage. That path does not itself certify slot continuity; it must not be treated as a recovery certificate.
- `src/db-worker.ts` commits the Engine projection, persisted state, ingress ACK, and delivery history in one SQLite transaction. Before this change, the conflict update rewrote `state_json`/`state_hash` in the projection row and `body` in the state row for every accepted observation.
- `src/core.ts` appends every equity sample and recomputes the rolling high-water mark over the retained window. This changes the risk-state representation and is deliberately not modified here.

## Implemented bounded optimization

The projection transaction now leaves the state payload columns out of the normal projection-row update. It conditionally updates the projection copy only when the SHA-256 state hash changes, and conditionally updates the separate state row only when its serialized body differs. Both operations remain inside the same `BEGIN IMMEDIATE` transaction as projection history and ingress acknowledgement.

This avoids rewriting two large identical state payloads while preserving the state bytes and hash, projection sequence, row identity, commit ordering, and ACK boundary. It still serializes and hashes state on every observation, so it does not validate a claim that overall throughput is sufficient. It is only one bounded write reduction.

## Verification

- TypeScript project compilation passed using the locked `@pump-fun/pump-swap-sdk@1.20.0` installed under ignored `work/pump-sdk-deps` and a temporary `.audit/tsconfig-pump.json`. The shared `node_modules` junction was not modified.
- `test/platform/canonical-ingress-crash-recovery.test.mjs`: 14/14 passed with the isolated package-resolution loader and test temp directory on D:. The new regression uses SQLite update triggers to prove identical state does not rewrite either stored state payload, the projection row still advances, and a changed state updates both payloads.
- `test/platform/canonical-ingress-durability.test.mjs`, `test/platform/feed-ingress-backpressure.test.mjs`, and `test/platform/feed-processing-intent-health.test.mjs`: 21/21 passed with the same isolated setup.
- `test/platform/feed-paused-websocket-control.test.mjs`: 1/1 passed; the local server observed no pong while paused and received it after resume.
- Running the crash-recovery suite with the default C: temp directory initially failed with SQLite `SQLITE_FULL` (code 13). Re-running with a D: temp directory passed. The shared dependency directory still lacks the locked Pump swap SDK; no default build claim is made.

## Not changed / requires separate review

- No queue cap, backpressure, socket watchdog, transport reconnect, feed-health, or gap-certificate semantics were changed. The local paused-socket mechanism is confirmed; whether this caused the reported production losses still requires incident-level evidence. Any fail-closed lifecycle change must follow the safety review route in `AGENTS.md`.
- Equity run-length encoding changes risk-state semantics and must receive Astra Risk review and mathematical regression coverage before implementation.
- Group commit changes durability/ACK boundaries and requires Astra Verification and Architecture review. It is not implemented.
- The existing incident latch and `PAPER_ACCOUNT_RECOVERY_UNAVAILABLE` are not cleared by this optimization.
