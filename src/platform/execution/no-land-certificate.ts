/**
 * SYLPH FUSION — NO-LAND VERIFICATION AUTHORITY & FINALIZED SETTLEMENT CERTIFICATES
 * Specifications: Sections 37 (Execution Generations), 103 (Invariants 1, 2, 7).
 *
 * Legacy terminal-certificate data and checksum helpers. A digest establishes
 * field consistency, not chain truth or authorization. Both terminal issuers
 * are quarantined pending signature-bound chain-evidence verification.
 * Caller assertions and block height do not establish historical absence.
 *
 * Invariant: ZERO reservation release or generation advancement without terminal proof.
 */

import { createHash } from 'node:crypto';

export interface NoLandCertificate {
  readonly certificateType: 'NO_LAND_CERTIFICATE';
  readonly intentId: string;
  readonly generation: number;
  readonly signature: string;
  readonly lastValidBlockHeight: number;
  readonly observedBlockHeight: number;
  readonly finalizedSlot: number;
  readonly verifiedAt: number;
  readonly rpcEndpoint: string;
  readonly proofDigest: string;
}

export interface FinalizedSettlementCertificate {
  readonly certificateType: 'FINALIZED_SETTLEMENT_CERTIFICATE';
  readonly intentId: string;
  readonly generation: number;
  readonly signature: string;
  readonly slot: number;
  readonly blockTime?: number;
  readonly feeLamports: bigint;
  readonly status: 'SUCCESS' | 'INSTRUCTION_ERROR';
  readonly tokenDelta: bigint;
  readonly solDelta: bigint;
  readonly finalizedAt: number;
  readonly proofDigest: string;
}

export type TerminalExecutionCertificate = NoLandCertificate | FinalizedSettlementCertificate;

export class NoLandVerificationAuthority {
  /**
   * Computes deterministic SHA-256 digest for a NoLandCertificate
   */
  public static computeNoLandDigest(params: {
    intentId: string;
    generation: number;
    signature: string;
    lastValidBlockHeight: number;
    observedBlockHeight: number;
    finalizedSlot: number;
    rpcEndpoint: string;
  }): string {
    return createHash('sha256')
      .update('NO_LAND:')
      .update(params.intentId)
      .update(`:${params.generation}:`)
      .update(params.signature)
      .update(`:${params.lastValidBlockHeight}:`)
      .update(`${params.observedBlockHeight}:`)
      .update(`${params.finalizedSlot}:`)
      .update(params.rpcEndpoint)
      .digest('hex');
  }

  /**
   * Computes deterministic SHA-256 digest for a FinalizedSettlementCertificate
   */
  public static computeSettlementDigest(params: {
    intentId: string;
    generation: number;
    signature: string;
    slot: number;
    feeLamports: bigint;
    status: 'SUCCESS' | 'INSTRUCTION_ERROR';
    tokenDelta: bigint;
    solDelta: bigint;
  }): string {
    return createHash('sha256')
      .update('FINALIZED_SETTLEMENT:')
      .update(params.intentId)
      .update(`:${params.generation}:`)
      .update(params.signature)
      .update(`:${params.slot}:`)
      .update(`${params.feeLamports}:`)
      .update(`${params.status}:`)
      .update(`${params.tokenDelta}:`)
      .update(`${params.solDelta}`)
      .digest('hex');
  }

  /**
   * Checks field consistency only; this is not evidence verification.
   * A matching digest must never authorize a terminal transition.
   */
  public static validateCertificateDigest(cert: TerminalExecutionCertificate): boolean {
    if (cert.certificateType === 'NO_LAND_CERTIFICATE') {
      const expected = this.computeNoLandDigest({
        intentId: cert.intentId,
        generation: cert.generation,
        signature: cert.signature,
        lastValidBlockHeight: cert.lastValidBlockHeight,
        observedBlockHeight: cert.observedBlockHeight,
        finalizedSlot: cert.finalizedSlot,
        rpcEndpoint: cert.rpcEndpoint,
      });
      return cert.proofDigest === expected;
    }

    if (cert.certificateType === 'FINALIZED_SETTLEMENT_CERTIFICATE') {
      const expected = this.computeSettlementDigest({
        intentId: cert.intentId,
        generation: cert.generation,
        signature: cert.signature,
        slot: cert.slot,
        feeLamports: cert.feeLamports,
        status: cert.status,
        tokenDelta: cert.tokenDelta,
        solDelta: cert.solDelta,
      });
      return cert.proofDigest === expected;
    }

    return false;
  }

  /**
   * Legacy API retained to reject existing callers explicitly. No trusted
   * history-verification authority exists yet; booleans cannot substitute for it.
   */
  public static certifyNoLand(_params: {
    intentId: string;
    generation: number;
    signature: string;
    lastValidBlockHeight: number;
    observedBlockHeight: number;
    finalizedSlot: number;
    rpcEndpoint: string;
    searchHistoryConfirmedNotFound: boolean;
  }): NoLandCertificate {
    throw new Error('NO_LAND_CERTIFICATION_UNAVAILABLE: Verified historical absence authority is not implemented; retain UNKNOWN');
  }

  /**
   * Legacy API retained to reject callers. No trusted, signature-bound
   * settlement evidence authority exists; caller fields cannot substitute for it.
   */
  public static certifySettlement(_params: {
    intentId: string;
    generation: number;
    signature: string;
    slot: number;
    blockTime?: number;
    feeLamports: bigint;
    status: 'SUCCESS' | 'INSTRUCTION_ERROR';
    tokenDelta: bigint;
    solDelta: bigint;
  }): FinalizedSettlementCertificate {
    throw new Error('SETTLEMENT_CERTIFICATION_UNAVAILABLE: Verified settlement authority is not implemented; retain UNKNOWN');
  }
}
