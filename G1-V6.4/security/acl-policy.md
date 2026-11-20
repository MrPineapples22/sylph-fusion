# Protected storage ACL requirements

The broker-owned scratch directory must be created as a new file-system object. Its owner, every ancestor, database, WAL/SHM, backup, temporary and recovery artifact must be inspected. The chosen service identity must have only required access; SYSTEM and administrators retain recovery access; ordinary and test users must not receive protected-file access. Existing aliases to a legacy file must retain the legacy object's security descriptor and must not identify the newly created authority object.

Tests use exact requested access under verified tokens and record Win32 error codes. `ERROR_SHARING_VIOLATION`, path-prefix checks, `realpath`, link counts, restored hashes, and process-name checks do not count as ACL denial proof. A retained writable handle is treated as still capable until its object identity and writes are independently accounted for.
