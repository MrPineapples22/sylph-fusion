# Windows CI evidence output

The manually triggered, branch-scoped workflow writes sanitized host, token, service, SQLite and hard-link records here. Test account passwords are generated at runtime and are never written to this directory or uploaded. The CI run has no repository write permission and uses a disposable `windows-2022` GitHub-hosted VM.

The Node permission-model hard-link reproduction is a vulnerable positive control. It is not evidence of ACL denial. Protected-object denial is recorded separately and requires actual Windows access checks from the temporary standard-user token.
