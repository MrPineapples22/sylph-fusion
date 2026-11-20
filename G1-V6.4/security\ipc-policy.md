# IPC policy status

The required production-like design is a local named pipe with an explicit DACL, remote-client rejection, first-instance protection, verified caller token, operation-level authorization, request-size limits, strict schemas and replay-resistant durable request IDs. Impersonation and revert failures must fail closed.

The initial preflight may test service identity and file isolation before an IPC adapter exists. Such results will not be described as IPC authorization qualification. Arbitrary SQL, arbitrary paths, direct key extraction, unrestricted database reads and client-supplied authority changes remain forbidden.
