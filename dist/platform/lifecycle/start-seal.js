/**
 * SYLPH FUSION — STARTSEAL: Reconcile-First Startup Sequence & Inventory Census
 * Specifications: Sections 20, 42, 60, 103 (Invariants 2, 4, 11, 15, 18)
 *
 * Enforces the strict 12-stage startup sequence:
 * BOOT -> RELEASE_VERIFY -> FENCE_ACQUIRE -> PROVIDER_SYNC -> JOURNAL_RECOVERY ->
 * PENDING_TX_RECONCILIATION -> FULL_WALLET_INVENTORY_CENSUS -> CAPITAL_CONSERVATION ->
 * TOKEN_SEMANTICS_REFRESH -> EVENT_CATCHUP -> REDUCE_ONLY -> ENTRY_READY
 *
 * Conducts whole-wallet inventory census for SOL, SPL Token, and Token-2022.
 * Detects: unknown assets, external positions, manual sells, unsolicited tokens, missing inventory.
 * Never silently overwrites local state.
 */
import { createHash } from 'node:crypto';
export class StartSealAuthority {
    currentPhase = 'BOOT';
    auditHistory = [];
    fenceEpoch = 0;
    inventoryCensus = [];
    isEntryReady = false;
    static SEQUENCE_ORDER = [
        'BOOT',
        'RELEASE_VERIFY',
        'FENCE_ACQUIRE',
        'PROVIDER_SYNC',
        'JOURNAL_RECOVERY',
        'PENDING_TX_RECONCILIATION',
        'FULL_WALLET_INVENTORY_CENSUS',
        'CAPITAL_CONSERVATION',
        'TOKEN_SEMANTICS_REFRESH',
        'EVENT_CATCHUP',
        'REDUCE_ONLY',
        'ENTRY_READY',
    ];
    getPhase() {
        return this.currentPhase;
    }
    getFenceEpoch() {
        return this.fenceEpoch;
    }
    getInventory() {
        return this.inventoryCensus;
    }
    /**
     * Executes the next phase in the startup sequence.
     * Enforces that stages cannot be skipped or reordered.
     */
    advancePhase(target, details) {
        const currentIdx = StartSealAuthority.SEQUENCE_ORDER.indexOf(this.currentPhase);
        const targetIdx = StartSealAuthority.SEQUENCE_ORDER.indexOf(target);
        if (targetIdx !== currentIdx + 1) {
            throw new Error(`STARTSEAL_SEQUENCE_VIOLATION: Cannot jump from ${this.currentPhase} to ${target}. Strict sequence required.`);
        }
        this.currentPhase = target;
        this.auditHistory.push({
            phase: target,
            completedAtMs: Date.now(),
            status: 'PASS',
            details,
        });
        if (target === 'ENTRY_READY') {
            this.isEntryReady = true;
        }
    }
    /**
     * Stage 2: Verify Release Root & build integrity.
     */
    verifyRelease(releaseRootSha256, expectedHash) {
        if (this.currentPhase !== 'BOOT')
            throw new Error('Invalid phase for release verification');
        if (!releaseRootSha256 || releaseRootSha256 !== expectedHash) {
            this.auditHistory.push({
                phase: 'RELEASE_VERIFY',
                completedAtMs: Date.now(),
                status: 'FAIL',
                details: `Release root mismatch: ${releaseRootSha256} != ${expectedHash}`,
            });
            throw new Error('STARTSEAL_RELEASE_VERIFICATION_FAILED');
        }
        this.advancePhase('RELEASE_VERIFY', `ReleaseRoot verified: ${releaseRootSha256.slice(0, 16)}...`);
    }
    /**
     * Stage 3: Acquire external FenceEpoch.
     */
    acquireFence(epoch) {
        if (this.currentPhase !== 'RELEASE_VERIFY')
            throw new Error('Invalid phase for fence acquisition');
        if (epoch <= 0 || !Number.isInteger(epoch)) {
            throw new Error('STARTSEAL_FENCE_ACQUISITION_FAILED: epoch must be positive integer');
        }
        this.fenceEpoch = epoch;
        this.advancePhase('FENCE_ACQUIRE', `Acquired FenceEpoch: ${epoch}`);
    }
    /**
     * Stage 7: Conduct Full Wallet Inventory Census across SOL, SPL, and Token-2022.
     */
    executeWalletCensus(params) {
        if (this.currentPhase !== 'PENDING_TX_RECONCILIATION') {
            throw new Error('STARTSEAL_CENSUS_PHASE_INVALID: pending tx reconciliation must precede wallet census');
        }
        const { onChainAccounts, localKnownPositions } = params;
        const items = [];
        const seenMints = new Set();
        for (const acc of onChainAccounts) {
            seenMints.add(acc.mint);
            const local = localKnownPositions[acc.mint];
            const localBalance = local ? BigInt(local.qty) : 0n;
            let classification = 'MATCHED_POSITION';
            let requiresManualReview = false;
            if (!local) {
                if (acc.rawBalance > 0n) {
                    // Tokens on chain not known locally: unsolicited airdrop or externally bought
                    classification = 'UNSOLICITED_TOKEN';
                    requiresManualReview = true;
                }
                else {
                    classification = 'ATA_CLOSED';
                }
            }
            else {
                if (acc.rawBalance !== localBalance) {
                    classification = 'MANUAL_DISCREPANCY';
                    requiresManualReview = true;
                }
                else {
                    classification = 'MATCHED_POSITION';
                }
            }
            items.push({
                mint: acc.mint,
                tokenProgram: acc.tokenProgram,
                ataAddress: acc.ataAddress,
                onChainRawBalance: acc.rawBalance,
                localLotRawBalance: localBalance,
                classification,
                requiresManualReview,
            });
        }
        // Check for local positions that have completely vanished on-chain
        for (const [mint, localPos] of Object.entries(localKnownPositions)) {
            if (!seenMints.has(mint) && BigInt(localPos.qty) > 0n) {
                items.push({
                    mint,
                    tokenProgram: 'TOKEN_PROGRAM',
                    ataAddress: 'MISSING_ATA',
                    onChainRawBalance: 0n,
                    localLotRawBalance: BigInt(localPos.qty),
                    classification: 'MISSING_INVENTORY',
                    requiresManualReview: true,
                });
            }
        }
        this.inventoryCensus = items;
        const discrepancies = items.filter(i => i.requiresManualReview).length;
        this.advancePhase('FULL_WALLET_INVENTORY_CENSUS', `Census complete. Evaluated ${items.length} assets with ${discrepancies} discrepancies.`);
        return items;
    }
    /**
     * Seals the startup sequence and emits the formal certificate.
     */
    generateSealCertificate(wallet, solBalanceLamports) {
        const discrepancies = this.inventoryCensus.filter(i => i.requiresManualReview).length;
        const isEntryPermitted = this.isEntryReady && discrepancies === 0;
        const certId = createHash('sha256')
            .update(`${wallet}:${this.fenceEpoch}:${this.currentPhase}:${discrepancies}:${Date.now()}`)
            .digest('hex')
            .slice(0, 16);
        return {
            certificateId: `STARTSEAL-${certId}`,
            wallet,
            fenceEpoch: this.fenceEpoch,
            isEntryPermitted,
            currentPhase: this.currentPhase,
            totalOnChainSolLamports: solBalanceLamports,
            inventoryItems: [...this.inventoryCensus],
            discrepancyCount: discrepancies,
            auditHistory: [...this.auditHistory],
            sealedAtMs: Date.now(),
            reason: discrepancies > 0
                ? `Startup locked to REDUCE_ONLY due to ${discrepancies} wallet inventory discrepancies requiring manual reconciliation`
                : 'Startup reconciliation complete. All invariants satisfied.',
        };
    }
}
export const globalStartSeal = new StartSealAuthority();
//# sourceMappingURL=start-seal.js.map