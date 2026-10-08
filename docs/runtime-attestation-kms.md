# Runtime attestation KMS adapter

`AwsKmsRuntimeAttestationSigner` in `src/platform/ingress/aws-kms-runtime-attestation.ts` implements the `RuntimeAttestationSigner` interface accepted by canonical ingress and the opt-in runtime exporter. It supplies a reviewed cryptographic boundary for a host-provided attestation service. It does not configure or start that service.

## Key and message contract

The host supplies an isolated `KmsEd25519Transport`, a concrete runtime-attestation key ARN, and an independently trusted Ed25519 SPKI PEM public-key pin to `AwsKmsRuntimeAttestationSigner.connect`. The adapter accepts standard UUID key ARNs in the `aws`, `aws-us-gov`, and `aws-cn` partitions; aliases and `mrk-` key identifiers are outside this implementation's accepted configuration. `GetPublicKey` must return the exact ARN, `ECC_NIST_EDWARDS25519`, `SIGN_VERIFY`, support for `ED25519_SHA_512`, and canonical DER/SPKI public bytes matching the pin. Invalid, private-key, and non-Ed25519 PEM inputs fail before a transport call.

`signRuntimeTelemetryRoot` accepts exactly 64 lowercase hexadecimal characters. It signs the corresponding **32 bytes** using `MessageType: RAW` and `SigningAlgorithm: ED25519_SHA_512`. The root is the protocol's entire message; the adapter does not encode the hex string as text or hash the root again. It verifies the exact response key and algorithm, copies and checks the 64-byte signature locally against the original root, and returns canonical base64. Request and response buffers cannot mutate the retained verification bytes.

AWS documents the required RAW/pure-Ed25519 pairing in its [Sign API](https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html), and describes public-key format and metadata for external verification in [GetPublicKey](https://docs.aws.amazon.com/kms/latest/APIReference/API_GetPublicKey.html).

## Host integration and operational limits

The connected adapter can be supplied as the `signer` in `RuntimeTelemetryExportOptions`, with the same independently trusted PEM as `trustedPublicKeyPem`. The host must also supply verified `sourceCommitSha` / `sourceTreeSha`, publication configuration, and the configured SQLite store. The producer and independent evidence verifier continue to check the signature, durable record, lineage, and source binding. The default CLI does not construct this adapter or enable telemetry.

This change includes no AWS SDK adapter, credentials, environment-variable loading, KMS permissions, key creation, trust-pin provisioning, or deployment. The host must supply an isolated transport and a **separate attestation key ARN and pin**. The transaction wallet, `AwsKmsEd25519` instance, wallet configuration, and transaction-signing permissions must not be reused. The sole shared dependency is the transport's TypeScript type; the compiled adapter has no runtime import of transaction signing code and exposes no wallet or `signAuthorizedMessage` API.

An adapter cannot establish that its key is operationally separate from a wallet key: that requires reviewed deployment policy and evidence. It also cannot authenticate the origin or truth of an arbitrary root submitted by a caller. A trusted service must authorize who can request an attestation and bind claimed runtime/build identity to independently verified inputs. An in-process caller holding unrestricted KMS permissions would retain those permissions regardless of this wrapper. Hosts must enforce transport isolation, bounded timeouts, access policy, audit retention, and key/pin rotation. The current exporter bounds its own operations; it cannot cancel an already issued transport request.

All adapter tests use ephemeral mock keys and transport responses. They demonstrate local contract compatibility and rejection behavior, not access to AWS, real IAM isolation, a valid release identity, or a production runtime artifact. C5–C10 and live capital remain blocked. Previously generated source-bound receipts become stale when these source/test files change; regenerate them after independent review.
