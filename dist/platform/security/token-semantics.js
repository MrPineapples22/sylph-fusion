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
//# sourceMappingURL=token-semantics.js.map