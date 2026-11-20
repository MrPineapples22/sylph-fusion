# Service identity evaluation

The Windows preflight will compare these configurations on a disposable runner:

1. `LocalService` with the service SID configured as restricted (`sc.exe sidtype <name> restricted`). Storage ACLs must authorize the service SID explicitly and deny the ordinary attacker SID.
2. The Windows virtual service account `NT SERVICE\<service-name>`.

The selected identity must be proven from the running service process token and must successfully perform an authorized SQLite operation. A service name, PID or process image alone is not proof of identity. The runner must record SID, integrity level, enabled privileges and service configuration. No configuration is selected before actual runtime evidence is collected.
