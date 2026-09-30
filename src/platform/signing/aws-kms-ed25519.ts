import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import type { IsolatedMessageSigner } from './durable-live-signer.js';

// Cryptographic backend for the isolated signer service, NOT an authorization
// boundary. The trading workload must not receive this object or kms:Sign IAM.
// Adapt these methods to AWS SDK GetPublicKeyCommand / SignCommand in the signer.
export interface KmsEd25519Transport {
  getPublicKey(input: { KeyId: string }): Promise<{
    KeyId?: string; KeySpec?: string; KeyUsage?: string;
    SigningAlgorithms?: string[]; PublicKey?: Uint8Array;
  }>;
  sign(input: { KeyId: string; Message: Uint8Array; MessageType: 'RAW'; SigningAlgorithm: 'ED25519_SHA_512' }): Promise<{
    KeyId?: string; SigningAlgorithm?: string; Signature?: Uint8Array;
  }>;
}

export class AwsKmsEd25519 implements IsolatedMessageSigner {
  private constructor(
    private readonly transport: KmsEd25519Transport,
    private readonly keyArn: string,
    private readonly verificationKey: KeyObject,
    readonly publicKey: PublicKey,
  ) {}

  get wallet(): string {
    return this.publicKey.toBase58();
  }

  static async connect(transport: KmsEd25519Transport, keyArn: string, expectedWallet: string): Promise<AwsKmsEd25519> {
    // Pin a concrete key, never an alias that can silently redirect signing.
    if (!/^arn:aws(?:-us-gov|-cn)?:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9-]{36}$/.test(keyArn)) {
      throw new Error('A concrete AWS KMS key ARN is required');
    }
    const response = await transport.getPublicKey({ KeyId: keyArn });
    if (response.KeyId !== keyArn || response.KeySpec !== 'ECC_NIST_EDWARDS25519' ||
        response.KeyUsage !== 'SIGN_VERIFY' || !response.SigningAlgorithms?.includes('ED25519_SHA_512') || !response.PublicKey) {
      throw new Error('KMS key metadata does not satisfy the Solana Ed25519 contract');
    }
    const key = createPublicKey({ key: Buffer.from(response.PublicKey), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('KMS public key is not Ed25519');
    const jwk = key.export({ format: 'jwk' });
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) throw new Error('Invalid Ed25519 public key');
    const bytes = Buffer.from(jwk.x, 'base64url');
    if (bytes.length !== 32) throw new Error('Invalid Ed25519 public key length');
    const publicKey = new PublicKey(bytes);
    if (publicKey.toBase58() !== expectedWallet) throw new Error('KMS public key does not match the pinned staging wallet');
    return new AwsKmsEd25519(transport, keyArn, key, publicKey);
  }

  async signAuthorizedMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!(message instanceof Uint8Array) || message.byteLength === 0 || message.byteLength > 4096) {
      throw new Error('Invalid message length for KMS RAW signing');
    }
    // Never prehash Solana messages: Ed25519ph is not Solana Ed25519.
    // Keep an independent verification copy across the asynchronous transport.
    const original = Buffer.from(message);
    const response = await this.transport.sign({ KeyId: this.keyArn, Message: Buffer.from(original),
      MessageType: 'RAW', SigningAlgorithm: 'ED25519_SHA_512' });
    if (response.KeyId !== this.keyArn || response.SigningAlgorithm !== 'ED25519_SHA_512' ||
        !response.Signature || response.Signature.byteLength !== 64 ||
        !verify(null, original, this.verificationKey, response.Signature)) {
      throw new Error('KMS returned an invalid or mismatched signature');
    }
    return Uint8Array.from(response.Signature);
  }
}
