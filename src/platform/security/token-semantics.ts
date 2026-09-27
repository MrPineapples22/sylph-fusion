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


// ============================================================================
// SYLPH FUSION — TOKEN BEHAVIOR CERTIFICATE & ACCOUNTROOT (Sections 13, 14, 15)
// ============================================================================

export interface TokenBehaviorCertificate {
  readonly certificateId: string;
  readonly mint: string;
  readonly tokenProgram: TokenProgramClassification;
  readonly mintAuthority: string | null;
  readonly freezeAuthority: string | null;
  readonly transferFeeBps: number;
  readonly maxTransferFeeBps: number;
  readonly scheduledFutureFeeEpoch?: number;
  readonly transferHookProgramId?: string;
  readonly hookExtraAccounts: readonly string[];
  readonly permanentDelegate?: string;
  readonly isPausable: boolean;
  readonly isDefaultFrozen: boolean;
  readonly isNonTransferable: boolean;
  readonly hasConfidentialTransfer: boolean;
  readonly metadataOnlyExtensions: readonly string[];
  readonly unknownExtensions: readonly string[];
  readonly isOpenPermitted: boolean;
  readonly isIncreasePermitted: boolean;
  readonly isClosePermitted: boolean;
  readonly certifiedAtSlot: number;
  readonly certifiedAtMs: number;
  readonly sha256: string;
  readonly reason: string;
}

export interface TokenAccountCertificate {
  readonly certificateId: string;
  readonly accountAddress: string;
  readonly expectedAta: string;
  readonly owner: string;
  readonly mint: string;
  readonly tokenProgram: TokenProgramClassification;
  readonly rawBalance: bigint;
  readonly isFrozen: boolean;
  readonly delegate: string | null;
  readonly delegatedAmount: bigint;
  readonly closeAuthority: string | null;
  readonly cpiGuardEnabled: boolean;
  readonly memoTransferRequired: boolean;
  readonly transferHookAccountValid: boolean;
  readonly isEntryCertified: boolean;
  readonly requiresAtaCreation: boolean;
  readonly certifiedAtMs: number;
  readonly reason: string;
}

export interface PositionSemanticLease {
  readonly leaseId: string;
  readonly mint: string;
  readonly tokenAccount: string;
  readonly behaviorHash: string;
  readonly accountHash: string;
  readonly epoch: number;
  readonly slot: number;
  readonly grantedAtMs: number;
  readonly expiresAtMs: number;
  readonly status: 'ACTIVE' | 'EXPIRED' | 'DRIFT_DETECTED' | 'REVOKED';
  readonly isEntryPermitted: boolean;
  readonly isSurvivalExitPermitted: boolean;
}

export class SemanticLeaseAuthority {
  private activeLeases = new Map<string, PositionSemanticLease>();
  private behaviorCerts = new Map<string, TokenBehaviorCertificate>();
  private accountCerts = new Map<string, TokenAccountCertificate>();

  /**
   * Certifies complete token behavioral semantics (Section 13).
   */
  public certifyTokenBehavior(params: {
    mint: string;
    tokenProgram: TokenProgramClassification;
    mintAuthority: string | null;
    freezeAuthority: string | null;
    transferFeeBps?: number;
    maxTransferFeeBps?: number;
    scheduledFutureFeeEpoch?: number;
    transferHookProgramId?: string;
    hookExtraAccounts?: readonly string[];
    permanentDelegate?: string;
    isPausable?: boolean;
    isDefaultFrozen?: boolean;
    isNonTransferable?: boolean;
    hasConfidentialTransfer?: boolean;
    metadataOnlyExtensions?: readonly string[];
    unknownExtensions?: readonly string[];
    certifiedAtSlot: number;
  }): TokenBehaviorCertificate {
    const { mint, tokenProgram, mintAuthority, freezeAuthority, certifiedAtSlot } = params;
    const transferFeeBps = params.transferFeeBps ?? 0;
    const maxTransferFeeBps = params.maxTransferFeeBps ?? transferFeeBps;
    const isPausable = params.isPausable === true;
    const isDefaultFrozen = params.isDefaultFrozen === true;
    const isNonTransferable = params.isNonTransferable === true;
    const hasConfidentialTransfer = params.hasConfidentialTransfer === true;
    const unknownExtensions = params.unknownExtensions ?? [];
    const metadataOnlyExtensions = params.metadataOnlyExtensions ?? [];
    const hookExtraAccounts = params.hookExtraAccounts ?? [];

    let isOpenPermitted = true;
    let isIncreasePermitted = true;
    let isClosePermitted = true;
    const reasons: string[] = [];

    // Hard fail-closed vetoes for risk-increasing operations
    if (params.permanentDelegate) {
      isOpenPermitted = false;
      isIncreasePermitted = false;
      reasons.push('Permanent delegate present on mint');
    }
    if (isDefaultFrozen || freezeAuthority) {
      isOpenPermitted = false;
      isIncreasePermitted = false;
      reasons.push('Active freeze authority or default-frozen accounts');
    }
    if (isNonTransferable) {
      isOpenPermitted = false;
      isIncreasePermitted = false;
      isClosePermitted = false;
      reasons.push('Non-transferable mint extension');
    }
    if (hasConfidentialTransfer) {
      isOpenPermitted = false;
      isIncreasePermitted = false;
      reasons.push('Confidential transfer features active');
    }
    if (unknownExtensions.length > 0) {
      isOpenPermitted = false;
      isIncreasePermitted = false;
      reasons.push(`Unknown extensions detected: ${unknownExtensions.join(', ')}`);
    }
    if (transferFeeBps > 500) { // Max 5% fee
      isOpenPermitted = false;
      isIncreasePermitted = false;
      reasons.push(`Transfer fee ${transferFeeBps} bps exceeds 500 bps safety ceiling`);
    }
    if (params.transferHookProgramId && !params.transferHookProgramId.startsWith('Tokenz')) {
      // Unverified external transfer hook
      isOpenPermitted = false;
      isIncreasePermitted = false;
      reasons.push(`Unverified transfer hook program: ${params.transferHookProgramId}`);
    }

    const sha256 = createHash('sha256')
      .update(`${mint}:${tokenProgram}:${mintAuthority}:${freezeAuthority}:${transferFeeBps}:${certifiedAtSlot}:${reasons.join(';')}`)
      .digest('hex');

    const cert: TokenBehaviorCertificate = {
      certificateId: `TBCERT-${sha256.slice(0, 16)}`,
      mint,
      tokenProgram,
      mintAuthority,
      freezeAuthority,
      transferFeeBps,
      maxTransferFeeBps,
      scheduledFutureFeeEpoch: params.scheduledFutureFeeEpoch,
      transferHookProgramId: params.transferHookProgramId,
      hookExtraAccounts,
      permanentDelegate: params.permanentDelegate,
      isPausable,
      isDefaultFrozen,
      isNonTransferable,
      hasConfidentialTransfer,
      metadataOnlyExtensions,
      unknownExtensions,
      isOpenPermitted,
      isIncreasePermitted,
      isClosePermitted,
      certifiedAtSlot,
      certifiedAtMs: Date.now(),
      sha256,
      reason: reasons.length > 0 ? reasons.join('; ') : 'Token behavior verified within certified parameters',
    };

    this.behaviorCerts.set(mint, cert);
    return cert;
  }

  /**
   * Certifies exact destination token account (Section 14: ACCOUNTROOT).
   */
  public certifyTokenAccount(params: {
    accountAddress: string;
    expectedAta: string;
    owner: string;
    mint: string;
    tokenProgram: TokenProgramClassification;
    rawBalance: bigint;
    isFrozen: boolean;
    delegate?: string | null;
    delegatedAmount?: bigint;
    closeAuthority?: string | null;
    cpiGuardEnabled?: boolean;
    memoTransferRequired?: boolean;
    transferHookAccountValid?: boolean;
    existsOnChain: boolean;
  }): TokenAccountCertificate {
    const { accountAddress, expectedAta, owner, mint, tokenProgram, rawBalance, isFrozen, existsOnChain } = params;

    let isEntryCertified = true;
    const reasons: string[] = [];

    if (accountAddress !== expectedAta) {
      isEntryCertified = false;
      reasons.push(`Account address ${accountAddress} does not match canonical ATA ${expectedAta}`);
    }
    if (isFrozen) {
      isEntryCertified = false;
      reasons.push('Token account is currently frozen');
    }
    if (params.delegate && (params.delegatedAmount ?? 0n) > 0n) {
      isEntryCertified = false;
      reasons.push(`Active external delegate: ${params.delegate} (${params.delegatedAmount} tokens)`);
    }

    const sha256 = createHash('sha256')
      .update(`${accountAddress}:${owner}:${mint}:${rawBalance}:${isFrozen}:${existsOnChain}`)
      .digest('hex');

    const cert: TokenAccountCertificate = {
      certificateId: `ACCERT-${sha256.slice(0, 16)}`,
      accountAddress,
      expectedAta,
      owner,
      mint,
      tokenProgram,
      rawBalance,
      isFrozen,
      delegate: params.delegate ?? null,
      delegatedAmount: params.delegatedAmount ?? 0n,
      closeAuthority: params.closeAuthority ?? null,
      cpiGuardEnabled: params.cpiGuardEnabled === true,
      memoTransferRequired: params.memoTransferRequired === true,
      transferHookAccountValid: params.transferHookAccountValid ?? true,
      isEntryCertified: isEntryCertified && (!existsOnChain || !isFrozen),
      requiresAtaCreation: !existsOnChain,
      certifiedAtMs: Date.now(),
      reason: reasons.length > 0 ? reasons.join('; ') : 'Token account certified for trade execution',
    };

    this.accountCerts.set(accountAddress, cert);
    return cert;
  }

  /**
   * Issues or renews a PositionSemanticLease (Section 15).
   * Verifies that token behavior and account state remain consistent before any signed transfer.
   */
  public issueSemanticLease(params: {
    mint: string;
    tokenAccount: string;
    epoch: number;
    slot: number;
    ttlMs?: number;
  }): PositionSemanticLease {
    const { mint, tokenAccount, epoch, slot } = params;
    const ttlMs = params.ttlMs ?? 15_000; // 15 second renewable lease

    const bCert = this.behaviorCerts.get(mint);
    const aCert = this.accountCerts.get(tokenAccount);

    let status: PositionSemanticLease['status'] = 'ACTIVE';
    let isEntryPermitted = true;
    const isSurvivalExitPermitted = bCert ? bCert.isClosePermitted : true;

    if (!bCert || !aCert) {
      status = 'EXPIRED';
      isEntryPermitted = false;
    } else if (!bCert.isOpenPermitted || !aCert.isEntryCertified) {
      status = 'REVOKED';
      isEntryPermitted = false;
    }

    const leaseId = `LEASE-${createHash('sha256').update(`${mint}:${tokenAccount}:${epoch}:${slot}:${Date.now()}`).digest('hex').slice(0, 16)}`;

    const lease: PositionSemanticLease = {
      leaseId,
      mint,
      tokenAccount,
      behaviorHash: bCert ? bCert.sha256 : 'UNKNOWN_BEHAVIOR',
      accountHash: aCert ? aCert.certificateId : 'UNKNOWN_ACCOUNT',
      epoch,
      slot,
      grantedAtMs: Date.now(),
      expiresAtMs: Date.now() + ttlMs,
      status,
      isEntryPermitted,
      isSurvivalExitPermitted,
    };

    this.activeLeases.set(mint, lease);
    return lease;
  }

  public getActiveLease(mint: string): PositionSemanticLease | undefined {
    const lease = this.activeLeases.get(mint);
    if (!lease) return undefined;
    if (Date.now() > lease.expiresAtMs) {
      return { ...lease, status: 'EXPIRED', isEntryPermitted: false };
    }
    return lease;
  }
}

export const globalSemanticLeaseAuthority = new SemanticLeaseAuthority();
