/**
 * SYLPH FUSION — OPPORTUNITY MARKET-X: AUCTION CLEARANCE CERTIFICATE
 * Specifications: Master Blueprint Section XXX (Auction Clearance Certificate)
 */
import { createHash } from 'node:crypto';
export function certifyAuctionClearance(slot, result) {
    const clearedAtMs = Date.now();
    const bindingConstraints = Object.entries(result.capacityUtilization)
        .filter(([_, util]) => util >= 0.90)
        .map(([res]) => res);
    const clearedBidIds = result.clearedBids.map((b) => b.bidId);
    const unsigned = {
        slot: slot.toString(),
        clearedCount: result.clearedBids.length,
        surplus: result.totalSurplusExtractedUsd,
        bindingConstraints,
        clearedAtMs,
    };
    const certificateHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
    const certificateId = `acc_${certificateHash.slice(0, 16)}`;
    return {
        certificateId,
        slot,
        clearedBidsCount: result.clearedBids.length,
        rejectedBidsCount: result.rejectedBids.length,
        clearedBidIds,
        totalSurplusUsd: result.totalSurplusExtractedUsd,
        bindingConstraints,
        certificateHash,
        clearedAtMs,
    };
}
//# sourceMappingURL=auction-clearance-certificate.js.map