/**
 * SYLPH FUSION — PINNED ED25519 ISSUER MANIFESTS
 * Specifications: Blueprint Section 13 (Replace Authority HMAC with Issuer Identities)
 *
 * This registry does not create default identities or private keys. Callers
 * must supply pinned public keys, and signing is available only through an
 * explicitly injected external signer capability.
 */
import { createHash, createPublicKey, verify, KeyObject } from 'node:crypto';
import { types as utilTypes } from 'node:util';
export const ALL_AUTHORITY_ROLES = Object.freeze([
    'TruthAuthority',
    'SemanticAuthority',
    'MarketAuthenticityAuthority',
    'ResearchAuthority',
    'RiskAuthority',
    'SimulationAuthority',
    'ExitabilityAuthority',
    'CapitalAuthority',
    'ExecutionAuthority',
    'SignerAuthority',
    'TerminalityAuthority',
    'SettlementAuthority',
    'ReleaseAuthority',
]);
function keyFingerprint(publicKey) {
    return createHash('sha256')
        .update(publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex');
}
function isDigestHex(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function isSignatureHex(value) {
    return typeof value === 'string' && /^[a-f0-9]{128}$/.test(value);
}
function snapshotExactRecord(value, keys, optionalKeys = []) {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value))
            return null;
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null)
            return null;
        const ownKeys = Reflect.ownKeys(value);
        const allowedKeys = new Set([...keys, ...optionalKeys]);
        if (ownKeys.length < keys.length || ownKeys.length > allowedKeys.size ||
            ownKeys.some(key => typeof key !== 'string' || !allowedKeys.has(key)))
            return null;
        const result = Object.create(null);
        for (const key of allowedKeys) {
            if (!Object.hasOwn(value, key))
                continue;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
                return null;
            result[key] = descriptor.value;
        }
        return result;
    }
    catch {
        return null;
    }
}
export class AuthorityIssuerRegistry {
    issuers = new Map();
    constructor(configurations = []) {
        if (!Array.isArray(configurations))
            throw new Error('ISSUER_CONFIG_INVALID: expected an array');
        for (const config of configurations)
            this.register(config);
    }
    register(config) {
        const configSnapshot = snapshotExactRecord(config, ['identity', 'publicKey'], ['signDigest']);
        if (!configSnapshot) {
            throw new Error('ISSUER_CONFIG_INVALID: identity and public key are required');
        }
        const identitySnapshot = snapshotExactRecord(configSnapshot.identity, [
            'issuerId', 'role', 'keyId', 'publicKeyHex', 'signatureAlgorithm',
        ]);
        if (!identitySnapshot)
            throw new Error('ISSUER_IDENTITY_INVALID');
        const identity = identitySnapshot;
        if (!ALL_AUTHORITY_ROLES.includes(identity.role) ||
            typeof identity.issuerId !== 'string' || identity.issuerId.length === 0 ||
            typeof identity.keyId !== 'string' || identity.keyId.length === 0 ||
            identity.signatureAlgorithm !== 'Ed25519' || !isDigestHex(identity.publicKeyHex)) {
            throw new Error('ISSUER_IDENTITY_INVALID');
        }
        if (this.issuers.has(identity.role))
            throw new Error(`ISSUER_ROLE_DUPLICATE: ${identity.role}`);
        let publicKey;
        try {
            if (configSnapshot.publicKey instanceof KeyObject) {
                if (configSnapshot.publicKey.type !== 'public')
                    throw new Error('PUBLIC_KEY_REQUIRED');
                publicKey = configSnapshot.publicKey;
            }
            else {
                if (typeof configSnapshot.publicKey !== 'string' ||
                    !configSnapshot.publicKey.startsWith('-----BEGIN PUBLIC KEY-----'))
                    throw new Error('PUBLIC_KEY_REQUIRED');
                publicKey = createPublicKey(configSnapshot.publicKey);
            }
        }
        catch {
            throw new Error('ISSUER_PUBLIC_KEY_INVALID');
        }
        if (publicKey.asymmetricKeyType !== 'ed25519' || keyFingerprint(publicKey) !== identity.publicKeyHex) {
            throw new Error('ISSUER_PUBLIC_KEY_FINGERPRINT_MISMATCH');
        }
        for (const existing of this.issuers.values()) {
            if (existing.identity.issuerId === identity.issuerId ||
                existing.identity.keyId === identity.keyId ||
                existing.identity.publicKeyHex === identity.publicKeyHex) {
                throw new Error('ISSUER_IDENTITY_REUSED_ACROSS_ROLES');
            }
        }
        if (configSnapshot.signDigest !== undefined && typeof configSnapshot.signDigest !== 'function') {
            throw new Error('ISSUER_SIGNER_INVALID');
        }
        this.issuers.set(identity.role, Object.freeze({
            identity: Object.freeze({ ...identity }),
            publicKey,
            signDigest: configSnapshot.signDigest,
        }));
    }
    getIdentity(role) {
        const entry = this.issuers.get(role);
        if (!entry)
            throw new Error(`AUTHORITY_NOT_FOUND: No pinned identity for role ${role}`);
        return entry.identity;
    }
    signPayload(role, payloadDigestHex) {
        const entry = this.issuers.get(role);
        if (!entry)
            throw new Error(`AUTHORITY_NOT_FOUND: No pinned identity for role ${role}`);
        if (!entry.signDigest)
            throw new Error(`AUTHORITY_CANNOT_SIGN: External signer is not configured for ${role}`);
        if (!isDigestHex(payloadDigestHex))
            throw new Error('PAYLOAD_DIGEST_INVALID');
        const signature = entry.signDigest(Buffer.from(payloadDigestHex, 'hex'));
        if (!(signature instanceof Uint8Array) || signature.byteLength !== 64) {
            throw new Error('ISSUER_SIGNATURE_INVALID');
        }
        if (!verify(null, Buffer.from(payloadDigestHex, 'hex'), entry.publicKey, signature)) {
            throw new Error('ISSUER_SIGNATURE_SELF_CHECK_FAILED');
        }
        return Object.freeze({
            issuerId: entry.identity.issuerId,
            issuerRole: role,
            issuerKeyId: entry.identity.keyId,
            signatureAlgorithm: 'Ed25519',
            signatureHex: Buffer.from(signature).toString('hex'),
            payloadDigestHex,
        });
    }
    verifySignature(envelope, expectedRole) {
        const envelopeSnapshot = snapshotExactRecord(envelope, [
            'issuerId', 'issuerRole', 'issuerKeyId', 'signatureAlgorithm', 'signatureHex', 'payloadDigestHex',
        ]);
        if (!envelopeSnapshot)
            return { isValid: false, reason: 'ENVELOPE_INVALID' };
        if (!ALL_AUTHORITY_ROLES.includes(envelopeSnapshot.issuerRole)) {
            return { isValid: false, reason: 'UNKNOWN_ISSUER_ROLE' };
        }
        const issuerRole = envelopeSnapshot.issuerRole;
        const entry = this.issuers.get(issuerRole);
        if (!entry)
            return { isValid: false, reason: `UNKNOWN_ISSUER_ROLE: Role ${issuerRole} is not registered` };
        if (expectedRole && issuerRole !== expectedRole) {
            return { isValid: false, reason: `ROLE_MISMATCH: Expected ${expectedRole}, got ${issuerRole}` };
        }
        if (envelopeSnapshot.issuerId !== entry.identity.issuerId || envelopeSnapshot.issuerKeyId !== entry.identity.keyId ||
            envelopeSnapshot.signatureAlgorithm !== 'Ed25519') {
            return { isValid: false, reason: 'ISSUER_IDENTITY_MISMATCH' };
        }
        if (!isDigestHex(envelopeSnapshot.payloadDigestHex))
            return { isValid: false, reason: 'PAYLOAD_DIGEST_INVALID' };
        if (!isSignatureHex(envelopeSnapshot.signatureHex))
            return { isValid: false, reason: 'SIGNATURE_FORMAT_INVALID' };
        try {
            const isValid = verify(null, Buffer.from(envelopeSnapshot.payloadDigestHex, 'hex'), entry.publicKey, Buffer.from(envelopeSnapshot.signatureHex, 'hex'));
            return isValid ? { isValid: true } : { isValid: false, reason: 'SIGNATURE_INVALID' };
        }
        catch {
            return { isValid: false, reason: 'SIGNATURE_VERIFICATION_ERROR' };
        }
    }
}
//# sourceMappingURL=issuer-manifest.js.map