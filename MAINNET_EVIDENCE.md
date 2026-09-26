# Mainnet Evidence Policy

Current evidence level: **L0 — unit verified only**. `PRODUCTION_EXECUTION_CERTIFIED` is false.

`scripts/mainnet-evidence.mjs` is an explicit operator-only preflight. It cannot sign, submit, or build a transaction. It requires a deliberate acknowledgement environment value and reports L0 because no isolated signer, broadcaster, reconciler, or evidence-bundle composition is configured.

An eventual operator ceremony must be authorized immediately before it runs and use the exact isolated signer, firewall, journal, broadcast, confirmation, and reconciliation path under review. It must generate a redacted evidence bundle and never run from tests, CI, startup, deployment, or scheduled work.

