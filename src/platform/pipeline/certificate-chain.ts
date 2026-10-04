/**
 * SYLPH FUSION — CERTIFICATE CHAIN
 * Specifications: Prompt 10, Prompt 52
 *
 * Cryptographic certificate binding for every major pipeline transition.
 * Certificate chain is append-only and independently verifiable.
 *
 * Certificate binds:
 *   certificateId
 *   kind
 *   authority
 *   envelopeId
 *   economicFactId
 *   fromState
 *   toState
 *   predecessorCertificateHash
 *   envelopeRoot
 *   previousStateRoot
 *   nextStateRoot
 *   evidenceRoot
 *   issuedAt
 *   payloadRoot?
 *   certificateHash = H(canonical(fields_without_certificateHash))
 */

import { hashCanonical } from './canonical-hashing.js';
import type { FusionPipelineState, PipelineAuthority } from './pipeline-state.js';

export const GENESIS_PREDECESSOR_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export interface FusionCertificate {
  readonly certificateId: string;
  readonly kind: string;
  readonly authority: PipelineAuthority;
  readonly envelopeId: string;
  readonly economicFactId: string;
  readonly fromState: FusionPipelineState;
  readonly toState: FusionPipelineState;
  readonly predecessorCertificateHash: string;
  readonly envelopeRoot: string;
  readonly previousStateRoot: string;
  readonly nextStateRoot: string;
  readonly evidenceRoot: string;
  readonly issuedAt: string;
  readonly payloadRoot?: string;
  readonly certificateHash: string;
}

export type FusionCertificateInput = Omit<FusionCertificate, 'certificateHash'>;

/**
 * Computes deterministic SHA-256 certificate hash over all fields excluding certificateHash.
 */
export function computeCertificateHash(input: FusionCertificateInput): string {
  return hashCanonical({
    certificateId: input.certificateId,
    kind: input.kind,
    authority: input.authority,
    envelopeId: input.envelopeId,
    economicFactId: input.economicFactId,
    fromState: input.fromState,
    toState: input.toState,
    predecessorCertificateHash: input.predecessorCertificateHash,
    envelopeRoot: input.envelopeRoot,
    previousStateRoot: input.previousStateRoot,
    nextStateRoot: input.nextStateRoot,
    evidenceRoot: input.evidenceRoot,
    issuedAt: input.issuedAt,
    payloadRoot: input.payloadRoot,
  });
}

/**
 * Creates a verified immutable FusionCertificate.
 */
export function createCertificate(input: FusionCertificateInput): FusionCertificate {
  const certificateHash = computeCertificateHash(input);
  return Object.freeze({
    ...input,
    certificateHash,
  });
}

export class CertificateChain {
  private readonly certificates: FusionCertificate[] = [];
  private lastCertificateHash: string = GENESIS_PREDECESSOR_HASH;

  /**
   * Returns current latest certificate hash in chain (or genesis hash if empty).
   */
  public root(): string {
    return this.lastCertificateHash;
  }

  /**
   * Appends a new certificate to the chain, validating predecessor continuity.
   */
  public append(input: Omit<FusionCertificateInput, 'predecessorCertificateHash'>): FusionCertificate {
    const certInput: FusionCertificateInput = {
      ...input,
      predecessorCertificateHash: this.lastCertificateHash,
    };
    const cert = createCertificate(certInput);
    this.certificates.push(cert);
    this.lastCertificateHash = cert.certificateHash;
    return cert;
  }

  /**
   * Returns an immutable copy of all certificates.
   */
  public all(): readonly FusionCertificate[] {
    return Object.freeze([...this.certificates]);
  }

  /**
   * Count of certificates in chain.
   */
  public count(): number {
    return this.certificates.length;
  }

  /**
   * Verifies cryptographic chain integrity and predecessor links.
   */
  public verify(): { valid: boolean; error?: string } {
    let expectedPredecessor = GENESIS_PREDECESSOR_HASH;

    for (let i = 0; i < this.certificates.length; i++) {
      const cert = this.certificates[i];

      // 1. Predecessor linkage check
      if (cert.predecessorCertificateHash !== expectedPredecessor) {
        return {
          valid: false,
          error: `BROKEN_CHAIN: Certificate index ${i} has predecessor ${cert.predecessorCertificateHash} != expected ${expectedPredecessor}`,
        };
      }

      // 2. Hash integrity check
      const expectedHash = computeCertificateHash(cert);
      if (cert.certificateHash !== expectedHash) {
        return {
          valid: false,
          error: `TAMPER_DETECTED: Certificate index ${i} (${cert.certificateId}) has invalid hash ${cert.certificateHash} != computed ${expectedHash}`,
        };
      }

      expectedPredecessor = cert.certificateHash;
    }

    return { valid: true };
  }
}
