# Live Reconciliation Recovery Report

Current state: **NOT_IMPLEMENTED for live funds**.

Required recovery chain: immutable signed wire → durable submission attempt → RPC plus WebSocket observation → transaction metadata → balance/token delta comparison → position comparison → authoritative portfolio commit. It must retain `UNKNOWN`, `PENDING`, `DIVERGED`, and `EXPIRED` states; a timeout is not failure.

Evidence level: L0. No operator-run devnet or mainnet path exists.

