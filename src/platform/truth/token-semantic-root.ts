/**
 * SOL-SYLPH Platform - Token Semantic Root
 * Specifications: Master Blueprint Section 7 & Priority Item 7.
 *
 * Implements:
 * 1. TokenSemanticRoot: Authoritative semantic contract for SPL and Token-2022 mints.
 * 2. Transfer-fee, transfer-hook, permanent-delegate, CPI-guard, and non-transferability checks.
 * 3. Enforces the non-negotiable invariant:
 *    BUY PATH SUCCESS does NOT prove SELL PATH SUCCESS. Both must be explicitly verified.
 */

import { createHash } from 'node:crypto';
import { DecodedMintState, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '../security/veto/parser-zero.js';

export interface TransferFeeSemantics {
  readonly currentEpochFeeBps: number;
  readonly olderFeeBps: number;
  readonly newerFeeBps: number;
  readonly maximumFeeRaw: bigint;
  readonly authority?: string;
  readonly isFeeDynamic: boolean;
}

export interface PermanentDelegateSemantics {
  readonly delegateAddress?: string;
  readonly isPresent: boolean;
  readonly canBurnOrTransferArbitraryHoldings: boolean;
}

export interface TransferHookSemantics {
  readonly hookProgramId?: string;
  readonly authority?: string;
  readonly isPresent: boolean;
}

export interface FreezeSemantics {
  readonly hasFreezeAuthority: boolean;
  readonly freezeAuthority?: string;
  readonly defaultAccountState: 'INITIALIZED' | 'FROZEN' | 'UNINITIALIZED';
}

export interface TokenSemanticRoot {
  readonly mint: string;
  readonly tokenProgram: string;
  readonly decimals: number;
  readonly rawSupply: bigint;
  readonly extensions: readonly string[];
  readonly transferFee: TransferFeeSemantics | null;
  readonly permanentDelegate: PermanentDelegateSemantics | null;
  readonly transferHook: TransferHookSemantics | null;
  readonly freezeSemantics: FreezeSemantics;
  readonly isNonTransferable: boolean;
  readonly hasCpiGuardExtension: boolean;
  readonly isBuyPathFeasible: boolean;
  readonly isSellPathFeasible: boolean;
  readonly sellPathRiskFactors: readonly string[];
  readonly semanticHash: string;
  readonly verificationSlot: number;
  readonly evaluatedAtMs: number;
}

export class TokenSemanticEngine {
  /**
   * Resolves and verifies comprehensive Token-2022 and SPL token semantics.
   */
  public static evaluateSemantics(params: {
    mint: string;
    tokenProgram?: string;
    decodedState?: Partial<DecodedMintState>;
    currentEpoch?: bigint;
    slot: number;
  }): TokenSemanticRoot {
    const { mint, slot, currentEpoch = 600n } = params;
    const tokenProgram = params.tokenProgram ?? (params.decodedState?.parsedExtensions?.length ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID);
    const decoded = params.decodedState;

    const extensions: string[] = [];
    const sellPathRiskFactors: string[] = [];

    // 1. Transfer Fee Evaluation
    let transferFee: TransferFeeSemantics | null = null;
    if (decoded?.transferFeeBps !== undefined || decoded?.newerTransferFee || decoded?.olderTransferFee) {
      extensions.push('TransferFeeConfig');
      const olderBps = decoded.olderTransferFee?.transferFeeBasisPoints ?? Number(decoded.transferFeeBps ?? 0n);
      const newerBps = decoded.newerTransferFee?.transferFeeBasisPoints ?? olderBps;
      const newerEpoch = decoded.newerTransferFee?.epoch ?? 0n;

      // Active fee depends on current epoch
      const currentBps = (newerEpoch > 0n && currentEpoch >= newerEpoch) ? newerBps : olderBps;
      const maxFee = decoded.newerTransferFee?.maximumFee ?? decoded.olderTransferFee?.maximumFee ?? 0n;

      transferFee = {
        currentEpochFeeBps: currentBps,
        olderFeeBps: olderBps,
        newerFeeBps: newerBps,
        maximumFeeRaw: maxFee,
        isFeeDynamic: olderBps !== newerBps,
      };

      if (currentBps > 1000) { // Over 10% transfer tax
        sellPathRiskFactors.push(`PUNITIVE_TRANSFER_FEE: Active transfer fee is ${currentBps} bps (> 10%)`);
      }
    }

    // 2. Permanent Delegate Evaluation
    let permanentDelegate: PermanentDelegateSemantics | null = null;
    if (decoded?.permanentDelegate && decoded.permanentDelegate.kind === 'PRESENT') {
      extensions.push('PermanentDelegate');
      permanentDelegate = {
        delegateAddress: decoded.permanentDelegate.authority,
        isPresent: true,
        canBurnOrTransferArbitraryHoldings: true,
      };
      sellPathRiskFactors.push(`PERMANENT_DELEGATE_PRESENT: Address ${decoded.permanentDelegate.authority} can seize or burn tokens`);
    }

    // 3. Transfer Hook Evaluation
    let transferHook: TransferHookSemantics | null = null;
    if (decoded?.transferHook && decoded.transferHook.kind === 'PRESENT') {
      extensions.push('TransferHook');
      transferHook = {
        hookProgramId: decoded.transferHook.authority,
        isPresent: true,
      };
      sellPathRiskFactors.push(`TRANSFER_HOOK_ACTIVE: External CPI program ${decoded.transferHook.authority} intercepts transfers`);
    }

    // 4. Freeze & Default Account State
    const hasFreeze = decoded?.freezeAuthority?.kind === 'PRESENT';
    if (hasFreeze && decoded?.freezeAuthority?.kind === 'PRESENT') {
      sellPathRiskFactors.push(`FREEZE_AUTHORITY_ACTIVE: Freeze authority present (${decoded.freezeAuthority.authority})`);
    }

    const defaultAccountState = (decoded?.defaultAccountState && decoded.defaultAccountState.kind === 'PRESENT' && decoded.defaultAccountState.authority === 'FROZEN')
      ? 'FROZEN'
      : 'INITIALIZED';
    if (defaultAccountState === 'FROZEN') {
      extensions.push('DefaultAccountState(Frozen)');
      sellPathRiskFactors.push('DEFAULT_ACCOUNT_FROZEN: Token accounts are initialized frozen');
    }

    // 5. Non-Transferability Check
    // Extension type 9 in Token-2022 is NonTransferable
    const isNonTransferable = Boolean(decoded?.parsedExtensions?.includes(9));
    if (isNonTransferable) {
      extensions.push('NonTransferable');
      sellPathRiskFactors.push('NON_TRANSFERABLE_MINT: Token transfers are blocked at program level (Soulbound)');
    }

    const hasCpiGuard = Boolean(decoded?.parsedExtensions?.includes(14));
    if (hasCpiGuard) {
      extensions.push('CpiGuard');
    }

    // Hard Rule Invariant:
    // Buy path may succeed via standard pool instruction, but sell path fails if non-transferable,
    // accounts default frozen, or transfer tax exceeds 50%.
    const isBuyPathFeasible = !isNonTransferable && defaultAccountState !== 'FROZEN';
    const isSellPathFeasible =
      isBuyPathFeasible &&
      !isNonTransferable &&
      !hasFreeze &&
      (!transferFee || transferFee.currentEpochFeeBps < 5000) &&
      (!permanentDelegate || !permanentDelegate.isPresent) &&
      sellPathRiskFactors.length === 0;

    const evaluatedAtMs = Date.now();
    const semanticHash = createHash('sha256')
      .update(JSON.stringify({
        mint,
        tokenProgram,
        decimals: decoded?.decimals ?? 6,
        rawSupply: String(decoded?.rawSupply ?? 0n),
        extensions,
        transferFee,
        permanentDelegate,
        transferHook,
        hasFreeze,
        defaultAccountState,
        isNonTransferable,
        hasCpiGuard,
        isSellPathFeasible,
      }))
      .digest('hex');

    return {
      mint,
      tokenProgram,
      decimals: decoded?.decimals ?? 6,
      rawSupply: decoded?.rawSupply ?? 0n,
      extensions: Object.freeze(extensions),
      transferFee,
      permanentDelegate,
      transferHook,
      freezeSemantics: {
        hasFreezeAuthority: hasFreeze,
        freezeAuthority: decoded?.freezeAuthority?.kind === 'PRESENT' ? decoded.freezeAuthority.authority : undefined,
        defaultAccountState,
      },
      isNonTransferable,
      hasCpiGuardExtension: hasCpiGuard,
      isBuyPathFeasible,
      isSellPathFeasible,
      sellPathRiskFactors: Object.freeze(sellPathRiskFactors),
      semanticHash,
      verificationSlot: slot,
      evaluatedAtMs,
    };
  }

  /**
   * Deterministically verifies whether a token can be exited without hostile interception.
   */
  public static verifySellPath(root: TokenSemanticRoot): {
    isSellApproved: boolean;
    failureReasons: readonly string[];
  } {
    if (root.isSellPathFeasible) {
      return { isSellApproved: true, failureReasons: [] };
    }
    return {
      isSellApproved: false,
      failureReasons: root.sellPathRiskFactors.length > 0 ? root.sellPathRiskFactors : ['INSUFFICIENT_SELL_PATH_SAFETY'],
    };
  }
}
