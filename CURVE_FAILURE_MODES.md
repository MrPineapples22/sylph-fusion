# Curve Failure Modes

| Failure | Safe state |
|---|---|
| completion evidence incomplete | `MIGRATION_VERIFYING` / unknown liquidity |
| destination missing after bounded discovery | `MIGRATION_UNVERIFIED` |
| provider DEX listing conflicts with chain proof | preserve conflict; do not activate DEX |
| stale/duplicate callback | reject without regression |
| unverified or wrong pool | reject destination certificate |
| completed curve with no executable post-curve quote | unpriced/unknown; do not value as confirmed zero |

Current executable position path still assigns completed curve value zero, so this final safety rule is not yet enforced in runtime.

