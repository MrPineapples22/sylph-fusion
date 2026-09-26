# Migration Evidence and Safety

Migration is a lifecycle transition, not a death state. Required eventual proof: finalized completion evidence, destination program/account decode, mint-pair match, pool ownership, initialization relation, fresh reserve evidence, and a destination certificate.

Until proof exists, the appropriate state is `MIGRATION_VERIFYING` or `MIGRATION_UNVERIFIED`, not DEX-active, dead, or zero-liquidity. New entry should remain blocked; an exit requires independently validated route/reconciliation evidence.

The current runtime lacks PumpSwap discovery and a durable handoff journal. This is a production blocker.

