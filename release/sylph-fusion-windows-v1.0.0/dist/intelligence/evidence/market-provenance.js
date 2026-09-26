/**
 * SOL-SYLPH Market Evidence Provenance Engine
 * Streamflow & Distribution-Provenance Architecture
 *
 * Enforces the non-negotiable provenance axiom:
 * Token holder appears
 *         ↓
 * Was token purchased?
 *         ↓
 * or
 *         ↓
 * Was it received through:
 * vesting | airdrop | batch distribution | creator transfer | Streamflow contract
 *         ↓
 * HolderQuality / BuyerQuality
 *
 * Invariant: A wallet receiving tokens through vesting or bulk-distribution contracts
 * MUST NOT automatically count as an independent organic buyer.
 */
export class MarketEvidenceProvenanceEngine {
    static instance = null;
    // mint -> (walletAddress -> HolderProvenanceRecord)
    records = new Map();
    static getInstance() {
        if (!MarketEvidenceProvenanceEngine.instance) {
            MarketEvidenceProvenanceEngine.instance = new MarketEvidenceProvenanceEngine();
        }
        return MarketEvidenceProvenanceEngine.instance;
    }
    /**
     * Register explicit holder acquisition provenance.
     */
    recordAcquisition(record) {
        let mintHolders = this.records.get(record.mint);
        if (!mintHolders) {
            mintHolders = new Map();
            this.records.set(record.mint, mintHolders);
        }
        mintHolders.set(record.walletAddress, record);
    }
    /**
     * Decodes an inbound transfer event and determines whether it represents an open-market
     * purchase or a contract/vesting distribution (e.g. Streamflow, airdrop, bulk send).
     */
    recordTransfer(params) {
        let acquisitionMethod = 'UNKNOWN';
        if (params.isStreamflowContract) {
            acquisitionMethod = 'STREAMFLOW_CONTRACT';
        }
        else if (params.isVestingContract) {
            acquisitionMethod = 'VESTING';
        }
        else if (params.isBatchDistribution) {
            acquisitionMethod = 'BATCH_DISTRIBUTION';
        }
        else if (params.isAirdrop) {
            acquisitionMethod = 'AIRDROP';
        }
        else if (params.isCreatorTransfer) {
            acquisitionMethod = 'CREATOR_TRANSFER';
        }
        else if (params.isDexSwap) {
            acquisitionMethod = 'PURCHASED';
        }
        const isDirectPurchase = acquisitionMethod === 'PURCHASED';
        const isContractDistributed = acquisitionMethod === 'STREAMFLOW_CONTRACT' ||
            acquisitionMethod === 'VESTING' ||
            acquisitionMethod === 'BATCH_DISTRIBUTION' ||
            acquisitionMethod === 'AIRDROP' ||
            acquisitionMethod === 'CREATOR_TRANSFER';
        const record = {
            walletAddress: params.toAddress,
            mint: params.mint,
            acquisitionMethod,
            isDirectPurchase,
            isContractDistributed,
            contractAddress: params.contractAddress,
            amountTokens: params.amount,
            acquiredAtMs: params.timestampMs ?? Date.now(),
            unlockScheduleMs: params.unlockScheduleMs,
            sourceTxSignature: params.txSignature,
        };
        this.recordAcquisition(record);
        return record;
    }
    /**
     * Evaluates BuyerQuality:
     * Only genuine market buyers count as independent organic buyers.
     * Wallets receiving tokens via Streamflow, vesting, airdrops, or batch distribution
     * are explicitly discounted and NOT counted toward organic buyer momentum.
     */
    evaluateBuyerQuality(mint) {
        const mintHolders = this.records.get(mint);
        if (!mintHolders || mintHolders.size === 0) {
            return {
                mint,
                totalObservedWallets: 0,
                verifiedOrganicBuyerCount: 0,
                discountedDistributedWalletCount: 0,
                organicBuyerRatio: 0,
                buyerQualityTier: 'SYNTHETIC_VOLUME',
                verdict: 'REJECT_AS_SYBIL_INFLATION',
                explanation: 'No observed wallet provenance records found for mint.',
            };
        }
        let organicCount = 0;
        let distributedCount = 0;
        for (const record of mintHolders.values()) {
            if (record.isDirectPurchase) {
                organicCount++;
            }
            else if (record.isContractDistributed) {
                distributedCount++;
            }
        }
        const total = organicCount + distributedCount;
        const ratio = total > 0 ? organicCount / total : 0;
        let tier;
        let verdict;
        let explanation;
        if (ratio >= 0.75) {
            tier = 'HIGH_ORGANIC';
            verdict = 'COUNT_AS_ORGANIC_BUYERS';
            explanation = `High organic buyer ratio (${(ratio * 100).toFixed(1)}%). Wallets predominantly purchased via DEX liquidity pools.`;
        }
        else if (ratio >= 0.45) {
            tier = 'MIXED';
            verdict = 'DISCOUNT_NON_ORGANIC_BUYERS';
            explanation = `Mixed buyer quality (${(ratio * 100).toFixed(1)}% organic). ${distributedCount} wallets received tokens via distribution/Streamflow contracts.`;
        }
        else if (distributedCount > 0) {
            tier = 'DISPERSION_SPOOFED';
            verdict = 'REJECT_AS_SYBIL_INFLATION';
            explanation = `Dispersion spoofing detected: ${distributedCount} of ${total} wallets received tokens via distribution contracts rather than open-market purchases.`;
        }
        else {
            tier = 'SYNTHETIC_VOLUME';
            verdict = 'REJECT_AS_SYBIL_INFLATION';
            explanation = 'Insufficient open-market purchase provenance.';
        }
        return {
            mint,
            totalObservedWallets: total,
            verifiedOrganicBuyerCount: organicCount,
            discountedDistributedWalletCount: distributedCount,
            organicBuyerRatio: Number(ratio.toFixed(4)),
            buyerQualityTier: tier,
            verdict,
            explanation,
        };
    }
    /**
     * Evaluates HolderQuality:
     * High score means tokens are held by authentic market participants.
     * Low score signifies artificial holder inflation or team distribution dispersion.
     */
    evaluateHolderQuality(mint) {
        const mintHolders = this.records.get(mint);
        if (!mintHolders || mintHolders.size === 0) {
            return {
                mint,
                totalHoldersCount: 0,
                organicPurchaserCount: 0,
                distributedHolderCount: 0,
                streamflowVestingCount: 0,
                airdropRecipientCount: 0,
                creatorTransferCount: 0,
                batchDistributionCount: 0,
                holderQualityScore: 0,
                isSybilRiskElevated: false,
                provenanceConfidence: 0,
            };
        }
        let organic = 0;
        let streamflow = 0;
        let airdrop = 0;
        let creator = 0;
        let batch = 0;
        for (const rec of mintHolders.values()) {
            switch (rec.acquisitionMethod) {
                case 'PURCHASED':
                    organic++;
                    break;
                case 'STREAMFLOW_CONTRACT':
                case 'VESTING':
                    streamflow++;
                    break;
                case 'AIRDROP':
                    airdrop++;
                    break;
                case 'CREATOR_TRANSFER':
                    creator++;
                    break;
                case 'BATCH_DISTRIBUTION':
                    batch++;
                    break;
            }
        }
        const distributed = streamflow + airdrop + creator + batch;
        const total = organic + distributed;
        const organicRatio = total > 0 ? organic / total : 0;
        const sybilElevated = distributed > 5 && (distributed / total > 0.4 || batch > 3);
        // Score combines organic ratio and penalizes unverified bulk dispersion
        const qualityScore = Math.max(0, Math.min(1, organicRatio * 0.8 + (1 - (sybilElevated ? 0.5 : 0)) * 0.2));
        return {
            mint,
            totalHoldersCount: total,
            organicPurchaserCount: organic,
            distributedHolderCount: distributed,
            streamflowVestingCount: streamflow,
            airdropRecipientCount: airdrop,
            creatorTransferCount: creator,
            batchDistributionCount: batch,
            holderQualityScore: Number(qualityScore.toFixed(4)),
            isSybilRiskElevated: sybilElevated,
            provenanceConfidence: total >= 10 ? 0.95 : total >= 3 ? 0.7 : 0.4,
        };
    }
    /**
     * Filter candidate wallets to isolate true organic buyers,
     * completely dropping wallets that acquired tokens through vesting, airdrops, or batch distributions.
     */
    filterOrganicBuyers(mint, candidateWallets) {
        const mintHolders = this.records.get(mint);
        if (!mintHolders)
            return [];
        return candidateWallets.filter(wallet => {
            const rec = mintHolders.get(wallet);
            return rec ? rec.isDirectPurchase && !rec.isContractDistributed : false;
        });
    }
}
export const globalMarketEvidenceProvenanceEngine = MarketEvidenceProvenanceEngine.getInstance();
//# sourceMappingURL=market-provenance.js.map