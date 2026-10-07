/**
 * SYLPH FUSION — PINNED ED25519 ISSUER MANIFESTS
 * Specifications: Blueprint Section 13 (Replace Authority HMAC with Issuer Identities)
 *
 * This registry does not create default identities or private keys. Callers
 * must supply pinned public keys, and signing is available only through an
 * explicitly injected external signer capability.
 */

import { createHash, createPublicKey, sign, verify, KeyObject } from 'node:crypto';
import { types as utilTypes } from 'node:util';

export type AuthorityRole =
  | 'TruthAuthority'
  | 'SemanticAuthority'
  | 'MarketAuthenticityAuthority'
  | 'ResearchAuthority'
  | 'RiskAuthority'
  | 'SimulationAuthority'
  | 'ExitabilityAuthority'
  | 'CapitalAuthority'
  | 'ExecutionAuthority'
  | 'SignerAuthority'
  | 'TerminalityAuthority'
  | 'SettlementAuthority'
  | 'ReleaseAuthority';

export const ALL_AUTHORITY_ROLES: readonly AuthorityRole[] = Object.freeze([
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

export interface AuthorityIssuerIdentity {
  readonly issuerId: string;
  readonly role: AuthorityRole;
  readonly keyId: string;
  /** Lowercase SHA-256 fingerprint of the DER-encoded SPKI public key. */
  readonly publicKeyHex: string;
  readonly signatureAlgorithm: 'Ed25519';
}

export interface AuthoritySignatureEnvelope {
  readonly issuerId: string;
  readonly issuerRole: AuthorityRole;
  readonly issuerKeyId: string;
  readonly signatureAlgorithm: 'Ed25519';
  readonly signatureHex: string;
  readonly payloadDigestHex: string;
}

export interface AuthorityIssuerConfig {
  readonly identity: AuthorityIssuerIdentity;
  readonly publicKey: KeyObject | string;
  /** External signing capability. Private key material stays outside this registry. */
  readonly signDigest?: (digest: Uint8Array) => Uint8Array;
}

interface RegisteredIssuer {
  readonly identity: AuthorityIssuerIdentity;
  readonly publicKey: KeyObject;
  readonly signDigest?: (digest: Uint8Array) => Uint8Array;
}

function keyFingerprint(publicKey: KeyObject): string {
  return createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

function isDigestHex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isSignatureHex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{128}$/.test(value);
}

function snapshotExactRecord(
  value: unknown,
  keys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    const allowedKeys = new Set<string>([...keys, ...optionalKeys]);
    if (ownKeys.length < keys.length || ownKeys.length > allowedKeys.size ||
        ownKeys.some(key => typeof key !== 'string' || !allowedKeys.has(key))) return null;
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of allowedKeys) {
      if (!Object.hasOwn(value, key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

export class AuthorityIssuerRegistry {
  private readonly issuers = new Map<AuthorityRole, RegisteredIssuer>();

  constructor(configurations: readonly AuthorityIssuerConfig[] = []) {
    if (!Array.isArray(configurations)) throw new Error('ISSUER_CONFIG_INVALID: expected an array');
    for (const config of configurations) this.register(config);
  }

  private register(config: AuthorityIssuerConfig): void {
    const configSnapshot = snapshotExactRecord(config, ['identity', 'publicKey'], ['signDigest']);
    if (!configSnapshot) {
      throw new Error('ISSUER_CONFIG_INVALID: identity and public key are required');
    }
    const identitySnapshot = snapshotExactRecord(configSnapshot.identity, [
      'issuerId', 'role', 'keyId', 'publicKeyHex', 'signatureAlgorithm',
    ] as const);
    if (!identitySnapshot) throw new Error('ISSUER_IDENTITY_INVALID');
    const identity = identitySnapshot as unknown as AuthorityIssuerIdentity;
    if (!ALL_AUTHORITY_ROLES.includes(identity.role) ||
        typeof identity.issuerId !== 'string' || identity.issuerId.length === 0 ||
        typeof identity.keyId !== 'string' || identity.keyId.length === 0 ||
        identity.signatureAlgorithm !== 'Ed25519' || !isDigestHex(identity.publicKeyHex)) {
      throw new Error('ISSUER_IDENTITY_INVALID');
    }
    if (this.issuers.has(identity.role)) throw new Error(`ISSUER_ROLE_DUPLICATE: ${identity.role}`);

    let publicKey: KeyObject;
    try {
      if (configSnapshot.publicKey instanceof KeyObject) {
        if (configSnapshot.publicKey.type !== 'public') throw new Error('PUBLIC_KEY_REQUIRED');
        publicKey = configSnapshot.publicKey;
      } else {
        if (typeof configSnapshot.publicKey !== 'string' ||
            !configSnapshot.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('PUBLIC_KEY_REQUIRED');
        publicKey = createPublicKey(configSnapshot.publicKey);
      }
    } catch {
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
      signDigest: configSnapshot.signDigest as ((digest: Uint8Array) => Uint8Array) | undefined,
    }));
  }

  public getIdentity(role: AuthorityRole): AuthorityIssuerIdentity {
    const entry = this.issuers.get(role);
    if (!entry) throw new Error(`AUTHORITY_NOT_FOUND: No pinned identity for role ${role}`);
    return entry.identity;
  }

  public signPayload(role: AuthorityRole, payloadDigestHex: string): AuthoritySignatureEnvelope {
    const entry = this.issuers.get(role);
    if (!entry) throw new Error(`AUTHORITY_NOT_FOUND: No pinned identity for role ${role}`);
    if (!entry.signDigest) throw new Error(`AUTHORITY_CANNOT_SIGN: External signer is not configured for ${role}`);
    if (!isDigestHex(payloadDigestHex)) throw new Error('PAYLOAD_DIGEST_INVALID');

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

  public verifySignature(
    envelope: AuthoritySignatureEnvelope,
    expectedRole?: AuthorityRole
  ): { isValid: boolean; reason?: string } {
    const envelopeSnapshot = snapshotExactRecord(envelope, [
      'issuerId', 'issuerRole', 'issuerKeyId', 'signatureAlgorithm', 'signatureHex', 'payloadDigestHex',
    ] as const);
    if (!envelopeSnapshot) return { isValid: false, reason: 'ENVELOPE_INVALID' };
    if (!ALL_AUTHORITY_ROLES.includes(envelopeSnapshot.issuerRole as AuthorityRole)) {
      return { isValid: false, reason: 'UNKNOWN_ISSUER_ROLE' };
    }
    const issuerRole = envelopeSnapshot.issuerRole as AuthorityRole;
    const entry = this.issuers.get(issuerRole);
    if (!entry) return { isValid: false, reason: `UNKNOWN_ISSUER_ROLE: Role ${issuerRole} is not registered` };
    if (expectedRole && issuerRole !== expectedRole) {
      return { isValid: false, reason: `ROLE_MISMATCH: Expected ${expectedRole}, got ${issuerRole}` };
    }
    if (envelopeSnapshot.issuerId !== entry.identity.issuerId || envelopeSnapshot.issuerKeyId !== entry.identity.keyId ||
        envelopeSnapshot.signatureAlgorithm !== 'Ed25519') {
      return { isValid: false, reason: 'ISSUER_IDENTITY_MISMATCH' };
    }
    if (!isDigestHex(envelopeSnapshot.payloadDigestHex)) return { isValid: false, reason: 'PAYLOAD_DIGEST_INVALID' };
    if (!isSignatureHex(envelopeSnapshot.signatureHex)) return { isValid: false, reason: 'SIGNATURE_FORMAT_INVALID' };

    try {
      const isValid = verify(
        null,
        Buffer.from(envelopeSnapshot.payloadDigestHex, 'hex'),
        entry.publicKey,
        Buffer.from(envelopeSnapshot.signatureHex, 'hex'),
      );
      return isValid ? { isValid: true } : { isValid: false, reason: 'SIGNATURE_INVALID' };
    } catch {
      return { isValid: false, reason: 'SIGNATURE_VERIFICATION_ERROR' };
    }
  }
}
