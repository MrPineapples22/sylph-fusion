import { createHash } from 'node:crypto';

export interface LiveSigningGrant {
  readonly grantId: string;
  readonly economicIntentId: string;
  readonly wallet: string;
  readonly messageSha256: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly controlEpoch: number;
}

export interface PreparedSigningIntent {
  readonly economicIntentId: string;
  readonly grantId: string;
  readonly wallet: string;
  readonly messageSha256: string;
  readonly controlEpoch: number;
  readonly preparedAtMs: number;
}

export interface DurableSigningJournal {
  /** Must durably commit or reject a duplicate before returning. */
  prepareSigningIntent(intent: PreparedSigningIntent): Promise<void>;
  markSigningIntentSigned(economicIntentId: string, messageSha256: string, signatureBase64: string): Promise<void>;
}

export interface IsolatedMessageSigner {
  readonly wallet: string;
  signAuthorizedMessage(message: Uint8Array): Promise<Uint8Array>;
}

export function signingMessageHash(message: Uint8Array): string {
  return createHash('sha256').update(message).digest('hex');
}

/**
 * Fail-closed bridge between a durable capital grant and an isolated signer.
 * The journal commit always precedes the first call across the signing boundary.
 */
export class DurableLiveSigner {
  constructor(
    private readonly signer: IsolatedMessageSigner,
    private readonly journal: DurableSigningJournal,
    private readonly currentControlEpoch: () => number,
    private readonly now: () => number = Date.now,
  ) {}

  async sign(grant: LiveSigningGrant, message: Uint8Array): Promise<Uint8Array> {
    if (!(message instanceof Uint8Array) || message.byteLength === 0) throw new Error('SIGNING_MESSAGE_INVALID');
    // TypeScript readonly does not prevent a caller from mutating inputs while
    // durability is pending. Own both the authorization and bytes before await.
    grant = Object.freeze({ ...grant });
    const authorizedMessage = Buffer.from(message);
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('SIGNING_CLOCK_INVALID');
    if (!grant.grantId || !grant.economicIntentId) throw new Error('SIGNING_GRANT_IDENTITY_INVALID');
    if (grant.wallet !== this.signer.wallet) throw new Error('SIGNING_GRANT_WALLET_MISMATCH');
    if (!Number.isSafeInteger(grant.issuedAtMs) || !Number.isSafeInteger(grant.expiresAtMs) ||
        grant.issuedAtMs > now || grant.expiresAtMs <= now) throw new Error('SIGNING_GRANT_STALE');
    if (!Number.isSafeInteger(grant.controlEpoch) || grant.controlEpoch < 0 ||
        grant.controlEpoch !== this.currentControlEpoch()) throw new Error('SIGNING_GRANT_EPOCH_STALE');

    const messageSha256 = signingMessageHash(authorizedMessage);
    if (grant.messageSha256 !== messageSha256) throw new Error('SIGNING_MESSAGE_ALTERED');

    await this.journal.prepareSigningIntent({
      economicIntentId: grant.economicIntentId,
      grantId: grant.grantId,
      wallet: grant.wallet,
      messageSha256,
      controlEpoch: grant.controlEpoch,
      preparedAtMs: now,
    });

    // Recheck authority after the durability boundary: a revocation may race the fsync.
    const signingTime = this.now();
    if (!Number.isSafeInteger(signingTime) || signingTime < now ||
        grant.expiresAtMs <= signingTime || grant.controlEpoch !== this.currentControlEpoch()) {
      throw new Error('SIGNING_GRANT_REVOKED_AFTER_PREPARE');
    }

    const signature = await this.signer.signAuthorizedMessage(authorizedMessage);
    if (!(signature instanceof Uint8Array) || signature.byteLength !== 64) throw new Error('SIGNER_RESPONSE_INVALID');
    const committedSignature = Uint8Array.from(signature);
    await this.journal.markSigningIntentSigned(grant.economicIntentId, messageSha256, Buffer.from(committedSignature).toString('base64'));
    return committedSignature;
  }
}
