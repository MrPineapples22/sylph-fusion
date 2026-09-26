# Signing and Mainnet Execution Release Gate

Current state: **BLOCKED**.

Missing mandatory evidence includes: deployed isolated signer identity with KMS-only access; actual compiled-message/ALT decoder; durable hash-chained attempt journal; signed-wire/broadcast/confirmation reconciliation; crash/retry/unknown-submission recovery; config-backed provider role activation and divergence gates; independent firewall/security review; and an explicitly authorized operator-run mainnet evidence bundle at L6.

Passing unit tests, simulation, a message hash, or a returned submission signature cannot satisfy this gate.

