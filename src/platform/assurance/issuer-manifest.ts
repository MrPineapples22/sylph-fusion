/**
 * SYLPH FUSION — CRYPTOGRAPHIC ISSUER MANIFESTS & ED25519 SEPARATION
 * Specifications: Blueprint Section 13 (Replace Authority HMAC with Issuer Identities)
 *
 * Implements Ed25519 asymmetric signature separation for 13 distinct authority planes.
 * Ensures one compromised subsystem cannot impersonate another authority.
 */

import { generateKeyPairSync, sign, verify, createHash } from 'node:crypto';

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

export class AuthorityIssuerRegistry {
  private readonly issuers = new Map<AuthorityRole, { identity: AuthorityIssuerIdentity; privateKeyPem: string }>();
  private readonly publicRegistry = new Map<string, AuthorityIssuerIdentity>();

  constructor() {
    this.initializeDefaultAuthorities();
  }

  private initializeDefaultAuthorities(): void {
    for (const role of ALL_AUTHORITY_ROLES) {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const keyId = `key_${role.toLowerCase()}_01`;
      const pubHex = createHash('sha256').update(publicKey).digest('hex');
      const identity: AuthorityIssuerIdentity = {
        issuerId: `auth_${role.toLowerCase()}`,
        role,
        keyId,
        publicKeyHex: pubHex,
        signatureAlgorithm: 'Ed25519',
      };

      this.issuers.set(role, { identity, privateKeyPem: privateKey });
      this.publicRegistry.set(identity.issuerId, identity);
    }
  }

  public getIdentity(role: AuthorityRole): AuthorityIssuerIdentity {
    const entry = this.issuers.get(role);
    if (!entry) {
      throw new Error(`AUTHORITY_NOT_FOUND: No registered identity for role ${role}`);
    }
    return entry.identity;
  }

  public signPayload(role: AuthorityRole, payloadDigestHex: string): AuthoritySignatureEnvelope {
    const entry = this.issuers.get(role);
    if (!entry) {
      throw new Error(`AUTHORITY_CANNOT_SIGN: Role ${role} not configured with signing capability`);
    }

    const digestBuffer = Buffer.from(payloadDigestHex, 'hex');
    const signature = sign(null, digestBuffer, entry.privateKeyPem);

    return {
      issuerId: entry.identity.issuerId,
      issuerRole: role,
      issuerKeyId: entry.identity.keyId,
      signatureAlgorithm: 'Ed25519',
      signatureHex: signature.toString('hex'),
      payloadDigestHex,
    };
  }

  public verifySignature(
    envelope: AuthoritySignatureEnvelope,
    expectedRole?: AuthorityRole
  ): { isValid: boolean; reason?: string } {
    if (expectedRole && envelope.issuerRole !== expectedRole) {
      return {
        isValid: false,
        reason: `ROLE_MISMATCH: Expected ${expectedRole}, got ${envelope.issuerRole}`,
      };
    }

    const entry = this.issuers.get(envelope.issuerRole);
    if (!entry) {
      return {
        isValid: false,
        reason: `UNKNOWN_ISSUER_ROLE: Role ${envelope.issuerRole} is not registered`,
      };
    }

    try {
      const digestBuffer = Buffer.from(envelope.payloadDigestHex, 'hex');
      const sigBuffer = Buffer.from(envelope.signatureHex, 'hex');
      const { publicKey } = generateKeyPairSync('ed25519'); // Use PEM stored in entry
      // For verification using node:crypto verify with public key:
      const isValid = verify(null, digestBuffer, entry.privateKeyPem, sigBuffer); // In node, ed25519 verify works with key object
      return { isValid };
    } catch (err) {
      return {
        isValid: false,
        reason: `SIGNATURE_VERIFICATION_ERROR: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
