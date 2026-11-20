# IPC policy status

The required production-like design is a local named pipe with an explicit DACL, remote-client rejection, first-instance protection, verified caller token, operation-level authorization, request-size limits, strict schemas and replay-resistant durable request IDs. Impersonation and revert failures must fail closed.

The client authenticates the pipe server by obtaining the server PID, opening its process with only `PROCESS_QUERY_LIMITED_INFORMATION`, and checking the process token's user and restricted service SID. The broker therefore replaces its own process-object DACL with explicit full access for SYSTEM, Administrators and its restricted service SID, plus only `PROCESS_QUERY_LIMITED_INFORMATION` for the configured client SID. This grants no process-memory, terminate, duplicate-handle, or DACL-write rights to the client. Runtime enforcement remains unqualified until the hosted Windows test proves both permitted process-token inspection and denial of stronger process access.

The initial preflight may test service identity and file isolation before an IPC adapter exists. Such results will not be described as IPC authorization qualification. Arbitrary SQL, arbitrary paths, direct key extraction, unrestricted database reads and client-supplied authority changes remain forbidden.
