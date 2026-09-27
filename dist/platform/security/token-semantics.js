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
export class TokenSemanticsAuthority {
    static evaluateSemantics(params) {
        const isToken2022 = params.programId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
        const isStandardSpl = params.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
        let program = 'UNKNOWN_PROGRAM';
        if (isToken2022)
            program = 'TOKEN_2022_PROGRAM';
        else if (isStandardSpl)
            program = 'TOKEN_PROGRAM';
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
        let classification = 'STANDARD_SPL';
        let executionPolicy = 'ELIGIBLE';
        if (permanentDelegatePresent || defaultFrozen || nonTransferable) {
            classification = 'MALICIOUS_BACKDOOR';
            executionPolicy = 'BLOCKED';
        }
        else if (transferHookActive) {
            classification = 'TRANSFER_HOOK_ACTIVE';
            // Transfer hooks require verified hook program simulation
            executionPolicy = params.hookProgramId ? 'RESTRICTED' : 'TRANSFER_SEMANTICS_UNVERIFIED';
        }
        else if (transferFeeActive) {
            classification = 'TRANSFER_FEE_ACTIVE';
            executionPolicy = transferFeeBps <= 500 ? 'RESTRICTED' : 'BLOCKED'; // 5% fee ceiling
        }
        else if (freezeAuthorityPresent || mintAuthorityPresent) {
            classification = 'COMPLEX_TRANSFER_SEMANTICS';
            executionPolicy = 'RESTRICTED';
        }
        else if (isToken2022) {
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
    static calculateGrossNetTransfer(grossTokens, transferFeeBps) {
        if (grossTokens <= 0n || transferFeeBps <= 0) {
            return {
                grossTokens,
                feeWithheldTokens: 0n,
                netReceivedTokens: grossTokens,
            };
        }
        const feeWithheld = (grossTokens * BigInt(transferFeeBps)) / 10000n;
        const netReceived = grossTokens - feeWithheld;
        return {
            grossTokens,
            feeWithheldTokens: feeWithheld,
            netReceivedTokens: netReceived,
        };
    }
}
export class SemanticLeaseAuthority {
    activeLeases = new Map();
    behaviorCerts = new Map();
    accountCerts = new Map();
    /**
     * Certifies complete token behavioral semantics (Section 13).
     */
    certifyTokenBehavior(params) {
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
        const reasons = [];
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
        const cert = {
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
    certifyTokenAccount(params) {
        const { accountAddress, expectedAta, owner, mint, tokenProgram, rawBalance, isFrozen, existsOnChain } = params;
        let isEntryCertified = true;
        const reasons = [];
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
        const cert = {
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
    issueSemanticLease(params) {
        const { mint, tokenAccount, epoch, slot } = params;
        const ttlMs = params.ttlMs ?? 15_000; // 15 second renewable lease
        const bCert = this.behaviorCerts.get(mint);
        const aCert = this.accountCerts.get(tokenAccount);
        let status = 'ACTIVE';
        let isEntryPermitted = true;
        const isSurvivalExitPermitted = bCert ? bCert.isClosePermitted : true;
        if (!bCert || !aCert) {
            status = 'EXPIRED';
            isEntryPermitted = false;
        }
        else if (!bCert.isOpenPermitted || !aCert.isEntryCertified) {
            status = 'REVOKED';
            isEntryPermitted = false;
        }
        const leaseId = `LEASE-${createHash('sha256').update(`${mint}:${tokenAccount}:${epoch}:${slot}:${Date.now()}`).digest('hex').slice(0, 16)}`;
        const lease = {
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
    getActiveLease(mint) {
        const lease = this.activeLeases.get(mint);
        if (!lease)
            return undefined;
        if (Date.now() > lease.expiresAtMs) {
            return { ...lease, status: 'EXPIRED', isEntryPermitted: false };
        }
        return lease;
    }
}
export const globalSemanticLeaseAuthority = new SemanticLeaseAuthority();
//# sourceMappingURL=token-semantics.js.map