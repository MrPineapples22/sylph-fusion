/**
 * SYLPH FUSION — EXACT BYTES AUTHORITY & ONE-SHOT EXECUTION PERMIT (Sections 38 & 39)
 *
 * Core Principle:
 * The exact serialized Solana transaction bytes must be the economic object being authorized.
 * No approving an abstract strategy and constructing an arbitrary transaction later.
 *
 * Enforces strict 5-stage cryptographic equality:
 * Built Bytes Hash === Simulation Bytes Hash === Authorization Bytes Hash === Signed Bytes Hash === Submission Bytes Hash
 * Any 1-bit mutation throws EXACT_BYTES_MUTATION_DETECTED and invalidates authority.
 */

import { createHash, randomBytes } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

export interface OneShotExecutionPermit {
  readonly permitId: string;
  readonly nonce: string;
  readonly mint: string;
  readonly side: 'BUY' | 'SELL';
  readonly maxInputLamportsOrTokens: bigint;
  readonly minOutputLamportsOrTokens: bigint;
  readonly maxSlippageBps: number;
  readonly route: string;
  readonly allowedProgramIds: readonly string[];
  readonly writableAccounts: readonly string[];
  readonly blockhash: string;
  readonly validFromSlot: bigint;
  readonly validUntilSlot: bigint;
  readonly policyRoot: string;
  readonly stateRoot: string;
  readonly releaseRoot: string;
  readonly capitalReservationId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly isConsumed: boolean;
}

export interface ExactBytesPipelineDigest {
  readonly permitId: string;
  readonly builtHash: string;
  readonly simulationHash: string;
  readonly authorizationHash: string;
  readonly signedHash: string;
  readonly submissionHash: string;
  readonly allStagesIdentical: boolean;
  readonly exactWireBytesLength: number;
}

export class ExactBytesAuthority {
  private static readonly consumedPermits = new Set<string>();

  public static computeBytesHash(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  /**
   * Generates an immutable, single-use, short-lived Execution Permit.
   */
  public static issueOneShotPermit(params: {
    mint: string;
    side: 'BUY' | 'SELL';
    maxInputLamportsOrTokens: bigint;
    minOutputLamportsOrTokens: bigint;
    maxSlippageBps: number;
    route: string;
    allowedProgramIds: readonly string[];
    writableAccounts: readonly string[];
    blockhash: string;
    currentSlot: bigint;
    slotValidityWindow: bigint; // e.g. 150 slots (~60s)
    policyRoot: string;
    stateRoot: string;
    releaseRoot: string;
    capitalReservationId: string;
  }): OneShotExecutionPermit {
    const nonce = randomBytes(16).toString('hex');
    const permitId = `permit_${params.mint.slice(0, 8)}_${Date.now()}_${nonce.slice(0, 8)}`;
    const now = Date.now();

    return Object.freeze({
      permitId,
      nonce,
      mint: params.mint,
      side: params.side,
      maxInputLamportsOrTokens: params.maxInputLamportsOrTokens,
      minOutputLamportsOrTokens: params.minOutputLamportsOrTokens,
      maxSlippageBps: params.maxSlippageBps,
      route: params.route,
      allowedProgramIds: Object.freeze([...params.allowedProgramIds]),
      writableAccounts: Object.freeze([...params.writableAccounts]),
      blockhash: params.blockhash,
      validFromSlot: params.currentSlot,
      validUntilSlot: params.currentSlot + params.slotValidityWindow,
      policyRoot: params.policyRoot,
      stateRoot: params.stateRoot,
      releaseRoot: params.releaseRoot,
      capitalReservationId: params.capitalReservationId,
      issuedAtMs: now,
      expiresAtMs: now + 60_000, // 60 seconds strict expiry
      isConsumed: false,
    });
  }

  /**
   * Validates the permit against current slot, clock, and consumption registry.
   * Consumes the permit upon successful validation (one-shot invariant).
   */
  public static consumePermit(permit: OneShotExecutionPermit, currentSlot: bigint): void {
    if (this.consumedPermits.has(permit.permitId)) {
      throw new Error(`PERMIT_REUSE_DETECTED: Permit ${permit.permitId} has already been consumed`);
    }

    const now = Date.now();
    if (now > permit.expiresAtMs) {
      throw new Error(`PERMIT_EXPIRED: Permit ${permit.permitId} expired at ${permit.expiresAtMs} (now ${now})`);
    }

    if (currentSlot < permit.validFromSlot || currentSlot > permit.validUntilSlot) {
      throw new Error(
        `PERMIT_SLOT_OUT_OF_RANGE: Current slot ${currentSlot} outside valid range [${permit.validFromSlot}, ${permit.validUntilSlot}]`
      );
    }

    this.consumedPermits.add(permit.permitId);
  }

  /**
   * Verifies the cryptographic invariant that all stages processed the EXACT same serialized bytes.
   */
  public static verifyExactBytesPipeline(params: {
    permitId: string;
    builtBytes: Uint8Array;
    simulatedBytes: Uint8Array;
    authorizedBytes: Uint8Array;
    signedMessageBytes: Uint8Array;
    submittedMessageBytes: Uint8Array;
  }): ExactBytesPipelineDigest {
    const builtHash = this.computeBytesHash(params.builtBytes);
    const simulationHash = this.computeBytesHash(params.simulatedBytes);
    const authorizationHash = this.computeBytesHash(params.authorizedBytes);
    const signedHash = this.computeBytesHash(params.signedMessageBytes);
    const submissionHash = this.computeBytesHash(params.submittedMessageBytes);

    if (builtHash !== simulationHash) {
      throw new Error(`EXACT_BYTES_MUTATION_DETECTED: Simulation bytes mismatch (built: ${builtHash}, sim: ${simulationHash})`);
    }
    if (builtHash !== authorizationHash) {
      throw new Error(`EXACT_BYTES_MUTATION_DETECTED: Authorization bytes mismatch (built: ${builtHash}, auth: ${authorizationHash})`);
    }
    if (builtHash !== signedHash) {
      throw new Error(`EXACT_BYTES_MUTATION_DETECTED: Signed message bytes mismatch (built: ${builtHash}, signed: ${signedHash})`);
    }
    if (builtHash !== submissionHash) {
      throw new Error(`EXACT_BYTES_MUTATION_DETECTED: Submitted message bytes mismatch (built: ${builtHash}, submitted: ${submissionHash})`);
    }

    return Object.freeze({
      permitId: params.permitId,
      builtHash,
      simulationHash,
      authorizationHash,
      signedHash,
      submissionHash,
      allStagesIdentical: true,
      exactWireBytesLength: params.builtBytes.byteLength,
    });
  }
}
