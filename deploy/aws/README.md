# AWS staging integration status

Prepared locally; not deployed or production-certified.

## Delivered

- `staging-foundation.json`: CloudFormation foundation for one retained Ed25519 KMS key and separate ECS signer/trading task roles. Only the signer role receives `kms:Sign`, scoped to the concrete key and RAW Ed25519. The trading role explicitly denies direct custody operations and role assumption/passing.
- `src/platform/signing/aws-kms-ed25519.ts`: cryptographic backend contract with concrete key ARN and wallet pinning, public-key metadata checks, RAW signing, and independent verification of every returned signature. Tests use locally generated ephemeral keys; no AWS request or chain transaction occurred.

AWS supports `ECC_NIST_EDWARDS25519` with `ED25519_SHA_512` / `MessageType: RAW`. Do not substitute Ed25519ph or prehash the Solana message. See [AWS key specifications](https://docs.aws.amazon.com/kms/latest/developerguide/symm-asymm-choose-key-spec.html), [Sign](https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html), and [CloudFormation KMS keys](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-kms-key.html).

## Required before deployment

Identify the staging AWS account, region, authenticated deployment profile, VPC and private subnets. No AWS CLI, Terraform or AWS connector was available in the audit session. CloudFormation service validation and IAM policy simulation have not run. The template is a foundation, not a complete ECS application stack.

1. Validate the foundation template and review its change set in the named staging account. Deploy with an identity allowed to create KMS keys and IAM roles. Retained keys incur cost until explicitly retired.
2. Build a separate signer service/container. Supply the backend transport using the pinned AWS SDK KMS client's `GetPublicKeyCommand` and `SignCommand`; use ECS task credentials, never static keys. The SDK adapter is not implemented yet.
3. Keep the trading role and signer role on separate tasks. Deny public signer ingress; use authenticated private service-to-service requests and a KMS VPC endpoint. Restrict outbound access and enable CloudTrail without logging unsigned transaction contents or secrets unnecessarily.
4. Implement the independent signing firewall before exposing a signing endpoint. It must parse the actual message and lookup-table accounts; validate fee payer, programs, mints, destinations, amounts, fee/tip bounds, current grant, expiry and fencing generation; atomically consume durable grants. An application-supplied `authorized: true` is insufficient. `signAuthorizedMessage` is only a cryptographic primitive and cannot enforce these policies by itself.
5. Pin the created key ARN and derived Solana public key. Perform an AWS known-message signature check and verify locally. Test KMS denial, wrong key, disabled key, timeouts, stale generations and crash recovery. Do not fund a wallet as part of the connectivity test.
6. Integrate the remote signer with the builder, removing application Keypair ownership. Preserve signed transaction persistence before every initial or retry broadcast. Reconcile uncertain outcomes before permitting another economic attempt.
7. Supply durable financial storage, independent provider identities, V1-compatible decoders and fixtures, staging secrets, private RPC, release provenance, backups, recovery drills and 24-hour soak evidence. Begin in observation/paper mode. Existing local `MODE=live` is not protected by this new KMS foundation; production authorization remains blocked.

## Rollback

Stop new authorization, retain the signer journal and confirmation/reconciliation workers, roll back to the previously verified image, and reconcile pending signatures. Never delete the KMS key as a routine rollback. No production key or wallet is shared with staging.
