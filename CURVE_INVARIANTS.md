# Curve and Migration Invariants

1. Curve completion is not token death.
2. Zero curve liquidity during migration is not economic zero liquidity.
3. Missing destination data is unknown, never zero.
4. A stale/lower-slot callback cannot regress lifecycle.
5. A duplicate event cannot create a second transition.
6. DEX-active requires a mint-bound destination certificate.
7. Post-graduation rejection requires fresh post-graduation evidence.
8. Progress is fixed-point and only calculated from protocol-decoded same-unit inputs.
9. The same ordered journal and versions must reproduce the same lifecycle hash.

