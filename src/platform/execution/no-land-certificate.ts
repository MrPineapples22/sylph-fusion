/**
 * SYLPH FUSION — NO-LAND VERIFICATION AUTHORITY & FINALIZED SETTLEMENT CERTIFICATES
 * Specifications: Sections 37 (Execution Generations), 103 (Invariants 1, 2, 7).
 *
 * Implements cryptographic terminal certificates:
 * 1. FinalizedSettlementCertificate: Proof that an execution generation landed and settled on chain.
 * 2. NoLandCertificate: Irrefutable proof that a transaction generation DID NOT land and cannot land
 *    (block height exceeded AND verified absent from finalized ledger history).
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
  private static readonly SAFETY_CONFIRMATION_SLOTS = 32;

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
   * Validates cryptographic digest on a certificate
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
   * Constructs and certifies a NoLandCertificate with fail-closed invariant checks
   */
  public static certifyNoLand(params: {
    intentId: string;
    generation: number;
    signature: string;
    lastValidBlockHeight: number;
    observedBlockHeight: number;
    finalizedSlot: number;
    rpcEndpoint: string;
    searchHistoryConfirmedNotFound: boolean;
  }): NoLandCertificate {
    if (!params.searchHistoryConfirmedNotFound) {
      throw new Error(
        `TRANSACTION_STATUS_UNCERTAIN: Cannot certify no-land for ${params.signature} without positive RPC confirmation of absence from finalized history`
      );
    }

    if (params.observedBlockHeight <= params.lastValidBlockHeight) {
      throw new Error(
        `PREMATURE_EXPIRY_ASSERTION: Observed block height ${params.observedBlockHeight} <= lastValidBlockHeight ${params.lastValidBlockHeight}`
      );
    }

    const proofDigest = this.computeNoLandDigest(params);

    return {
      certificateType: 'NO_LAND_CERTIFICATE',
      intentId: params.intentId,
      generation: params.generation,
      signature: params.signature,
      lastValidBlockHeight: params.lastValidBlockHeight,
      observedBlockHeight: params.observedBlockHeight,
      finalizedSlot: params.finalizedSlot,
      verifiedAt: Date.now(),
      rpcEndpoint: params.rpcEndpoint,
      proofDigest,
    };
  }

  /**
   * Constructs and certifies a FinalizedSettlementCertificate
   */
  public static certifySettlement(params: {
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
    if (params.slot <= 0) {
      throw new Error(`INVALID_SETTLEMENT_SLOT: Slot must be positive (got ${params.slot})`);
    }

    const proofDigest = this.computeSettlementDigest(params);

    return {
      certificateType: 'FINALIZED_SETTLEMENT_CERTIFICATE',
      intentId: params.intentId,
      generation: params.generation,
      signature: params.signature,
      slot: params.slot,
      blockTime: params.blockTime,
      feeLamports: params.feeLamports,
      status: params.status,
      tokenDelta: params.tokenDelta,
      solDelta: params.solDelta,
      finalizedAt: Date.now(),
      proofDigest,
    };
  }
}
