import { createPublicKey, verify } from 'node:crypto';
const KEY_ARN = /^arn:aws(?:-us-gov|-cn)?:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ALGORITHM = 'ED25519_SHA_512';
const CONSTRUCTION_SEAL = Symbol('runtime-attestation-validated-connection');
/** Cryptographic adapter for a dedicated runtime-attestation service.
 * The host supplies a separately provisioned evidence key, public pin, and
 * isolated transport. This adapter supplies no credentials or authorization
 * policy and intentionally has no wallet or transaction-signing interface. */
export class AwsKmsRuntimeAttestationSigner {
    #transport;
    #keyArn;
    #verificationKey;
    constructor(transport, keyArn, verificationKey, seal) {
        // TypeScript's private constructor is erased in JavaScript. Only connect,
        // after validating the remote key against the public pin, owns this seal.
        if (seal !== CONSTRUCTION_SEAL)
            throw new Error('C5_KMS_VALIDATED_CONNECTION_REQUIRED');
        this.#transport = transport;
        this.#keyArn = keyArn;
        this.#verificationKey = verificationKey;
    }
    static async connect(transport, keyArn, trustedPublicKeyPem) {
        if (typeof keyArn !== 'string' || !KEY_ARN.test(keyArn))
            throw new Error('C5_KMS_CONCRETE_KEY_ARN_REQUIRED');
        // createPublicKey also accepts private keys; this public-only boundary must not.
        if (typeof trustedPublicKeyPem !== 'string' || !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PUBLIC KEY-----\s*$/.test(trustedPublicKeyPem)) {
            throw new Error('C5_KMS_PUBLIC_PIN_INVALID');
        }
        let pin;
        try {
            pin = createPublicKey(trustedPublicKeyPem);
        }
        catch {
            throw new Error('C5_KMS_PUBLIC_PIN_INVALID');
        }
        if (pin.asymmetricKeyType !== 'ed25519')
            throw new Error('C5_KMS_PUBLIC_PIN_INVALID');
        const expectedDer = pin.export({ format: 'der', type: 'spki' });
        const response = await transport.getPublicKey({ KeyId: keyArn });
        if (!response || response.KeyId !== keyArn || response.KeySpec !== 'ECC_NIST_EDWARDS25519' ||
            response.KeyUsage !== 'SIGN_VERIFY' || !Array.isArray(response.SigningAlgorithms) ||
            !response.SigningAlgorithms.includes(ALGORITHM) || !(response.PublicKey instanceof Uint8Array)) {
            throw new Error('C5_KMS_KEY_METADATA_INVALID');
        }
        const publicDer = Buffer.from(response.PublicKey);
        let publicKey;
        try {
            publicKey = createPublicKey({ key: publicDer, format: 'der', type: 'spki' });
        }
        catch {
            throw new Error('C5_KMS_PUBLIC_KEY_INVALID');
        }
        if (publicKey.asymmetricKeyType !== 'ed25519' || !publicDer.equals(publicKey.export({ format: 'der', type: 'spki' }))) {
            throw new Error('C5_KMS_PUBLIC_KEY_INVALID');
        }
        if (!expectedDer.equals(publicDer))
            throw new Error('C5_KMS_PUBLIC_PIN_MISMATCH');
        return new AwsKmsRuntimeAttestationSigner(transport, keyArn, pin, CONSTRUCTION_SEAL);
    }
    async signRuntimeTelemetryRoot(rootSha256) {
        if (typeof rootSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(rootSha256))
            throw new Error('C5_KMS_ROOT_INVALID');
        // The protocol's message is exactly the 32 root bytes. RAW pure Ed25519
        // signs those bytes; UTF-8 hex, another digest, and Ed25519ph are incompatible.
        const original = Buffer.from(rootSha256, 'hex');
        const response = await this.#transport.sign({ KeyId: this.#keyArn, Message: Buffer.from(original),
            MessageType: 'RAW', SigningAlgorithm: ALGORITHM });
        if (!response || response.KeyId !== this.#keyArn || response.SigningAlgorithm !== ALGORITHM ||
            !(response.Signature instanceof Uint8Array))
            throw new Error('C5_KMS_SIGNATURE_INVALID');
        // Verify and encode the same independent snapshot, never a mutable transport view.
        const signature = Buffer.from(response.Signature);
        if (signature.byteLength !== 64 || !verify(null, original, this.#verificationKey, signature)) {
            throw new Error('C5_KMS_SIGNATURE_INVALID');
        }
        return signature.toString('base64');
    }
}
//# sourceMappingURL=aws-kms-runtime-attestation.js.map