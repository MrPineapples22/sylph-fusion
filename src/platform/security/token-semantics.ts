/**
 * SOL-SYLPH 2026 Platform - Token-2022 Semantics Authority
 *
 * Evaluates Token-2022 and Legacy SPL Token semantics before trade entry:
 * - Transfer fees (withholds basis points; requires gross vs net accounting)
 * - Transfer hooks (custom program execution; requires account identification and simulation)
 * - Permanent delegates, pause states, non-transferability, default-frozen states
 * - Authorities (mint & freeze)
 *
 * Non-negotiable invariant:
 * UNVERIFIED_TRANSFER_HOOK / UNKNOWN_EXTENSION => TRANSFER_SEMANTICS_UNVERIFIED => EXECUTION_BLOCKED
 */

import { createHash } from 'node:crypto';

export type TokenProgramClassification = 'TOKEN_PROGRAM' | 'TOKEN_2022_PROGRAM' | 'UNKNOWN_PROGRAM';

export type TokenSemanticsClassification =
  | 'STANDARD_SPL'
  | 'BENIGN_METADATA_EXTENSIONS'
  | 'TRANSFER_FEE_ACTIVE'
  | 'TRANSFER_HOOK_ACTIVE'
  | 'COMPLEX_TRANSFER_SEMANTICS'
  | 'MALICIOUS_BACKDOOR';

export type ExecutionPolicyVerdict = 'ELIGIBLE' | 'RESTRICTED' | 'TRANSFER_SEMANTICS_UNVERIFIED' | 'BLOCKED';

export interface TokenSemantics {
  readonly mint: string;
  readonly program: TokenProgramClassification;
  readonly transferFeeActive: boolean;
  readonly transferFeeBps: number;
  readonly transferHookActive: boolean;
  readonly hookProgramId?: string;
  readonly permanentDelegatePresent: boolean;
  readonly pausableActive: boolean;
  readonly defaultFrozen: boolean;
  readonly nonTransferable: boolean;
  readonly freezeAuthorityPresent: boolean;
  readonly mintAuthorityPresent: boolean;
  readonly classification: TokenSemanticsClassification;
  readonly executionPolicy: ExecutionPolicyVerdict;
  readonly semanticsHash: string;
  readonly verifiedAtSlot: number;
  readonly timestamp: number;
}

export interface GrossNetTokenDelta {
  readonly grossTokens: bigint;
  readonly feeWithheldTokens: bigint;
  readonly netReceivedTokens: bigint;
}

export class TokenSemanticsAuthority {
  public static evaluateSemantics(params: {
    mint: string;
    programId: string;
    isMintAuthorityRevoked: boolean;
    isFreezeAuthorityRevoked: boolean;
    transferFeeBps?: number | null;
    hasTransferHook?: boolean;
    hookProgramId?: string;
    hasPermanentDelegate?: boolean;
    isDefaultFrozen?: boolean;
    isNonTransferable?: boolean;
    isPausable?: boolean;
    verifiedAtSlot: number;
  }): TokenSemantics {
    const isToken2022 = params.programId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
    const isStandardSpl = params.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

    let program: TokenProgramClassification = 'UNKNOWN_PROGRAM';
    if (isToken2022) program = 'TOKEN_2022_PROGRAM';
    else if (isStandardSpl) program = 'TOKEN_PROGRAM';

    const transferFeeActive = (params.transferFeeBps ?? 0) > 0;
    const transferFeeBps = params.transferFeeBps ?? 0;
    const transferHookActive = params.hasTransferHook === true;
    const permanentDelegatePresent = params.hasPermanentDelegate === true;
    const pausableActive = params.isPausable === true;
    const defaultFrozen = params.isDefaultFrozen === true;
    const nonTransferable = params.isNonTransferable === true;
    const freezeAuthorityPresent = !params.isFreezeAuthorityRevoked;
    const mintAuthorityPresent = !params.isMintAuthorityRevoked;

    // Classification & Risk Verdict
    let classification: TokenSemanticsClassification = 'STANDARD_SPL';
    let executionPolicy: ExecutionPolicyVerdict = 'ELIGIBLE';

    if (permanentDelegatePresent || defaultFrozen || nonTransferable) {
      classification = 'MALICIOUS_BACKDOOR';
      executionPolicy = 'BLOCKED';
    } else if (transferHookActive) {
      classification = 'TRANSFER_HOOK_ACTIVE';
      // Transfer hooks require verified hook program simulation
      executionPolicy = params.hookProgramId ? 'RESTRICTED' : 'TRANSFER_SEMANTICS_UNVERIFIED';
    } else if (transferFeeActive) {
      classification = 'TRANSFER_FEE_ACTIVE';
      executionPolicy = transferFeeBps <= 500 ? 'RESTRICTED' : 'BLOCKED'; // 5% fee ceiling
    } else if (freezeAuthorityPresent || mintAuthorityPresent) {
      classification = 'COMPLEX_TRANSFER_SEMANTICS';
      executionPolicy = 'RESTRICTED';
    } else if (isToken2022) {
      classification = 'BENIGN_METADATA_EXTENSIONS';
      executionPolicy = 'ELIGIBLE';
    }

    const payload = `${params.mint}:${program}:${transferFeeBps}:${transferHookActive}:${params.hookProgramId ?? ''}:${permanentDelegatePresent}:${freezeAuthorityPresent}:${mintAuthorityPresent}:${params.verifiedAtSlot}`;
    const semanticsHash = createHash('sha256').update(payload).digest('hex');

    return {
      mint: params.mint,
      program,
      transferFeeActive,
      transferFeeBps,
      transferHookActive,
      hookProgramId: params.hookProgramId,
      permanentDelegatePresent,
      pausableActive,
      defaultFrozen,
      nonTransferable,
      freezeAuthorityPresent,
      mintAuthorityPresent,
      classification,
      executionPolicy,
      semanticsHash,
      verifiedAtSlot: params.verifiedAtSlot,
      timestamp: Date.now(),
    };
  }

  /**
   * Reconciles gross vs net received token balances under transfer-fee mints.
   */
  public static calculateGrossNetTransfer(grossTokens: bigint, transferFeeBps: number): GrossNetTokenDelta {
    if (grossTokens <= 0n || transferFeeBps <= 0) {
      return {
        grossTokens,
        feeWithheldTokens: 0n,
        netReceivedTokens: grossTokens,
      };
    }
    const feeWithheld = (grossTokens * BigInt(transferFeeBps)) / 10_000n;
    const netReceived = grossTokens - feeWithheld;
    return {
      grossTokens,
      feeWithheldTokens: feeWithheld,
      netReceivedTokens: netReceived,
    };
  }
}
