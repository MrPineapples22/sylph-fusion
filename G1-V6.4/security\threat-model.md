# G1 v6.4 scratch threat model

## Protected assets

Synthetic authority keys, registry records, SQLite database and sidecars, service executable/configuration, ownership epoch, request receipts and pending external-operation ledger.

## Adversary

An ordinary Node client or other standard-user process that may share the client's user SID, create hardlink aliases where permitted, retain writable legacy handles, race pathnames, send malformed/replayed IPC, and crash or delay requests.

## Trust boundary under test

The SCM-created service process must have an independently observed service identity. Only that identity may access the new protected database and sidecars. The service, not Node, must own SQLite handles. ACL checks must be object-level and tested through original and alias paths while the service is stopped and running. A sharing violation is not access-control evidence.

## Current qualification state

The prior same-user hard-link exploit is reproducible on the vulnerable fixture. This v6.4 candidate is not yet qualified. The GitHub-hosted runner has not yet executed CI-P0/P1/P2. Broader IPC authorization, SQLite fault recovery, fencing, all P/Alpha requirements, and independent final certification remain separate requirements.
