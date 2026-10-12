/**
 * SYLPH FUSION — SOLANA MARKET MAKING & ADVERSE SELECTION ENGINE
 * Specification: Solana-Only Integration Blueprint (Sections 21–24)
 *
 * Epistemic Invariants:
 * 1. Do not quote simply because a spread exists: Quote decisions depend on fair value,
 *    inventory skew, volatility, queue position, and adverse selection scores.
 * 2. Section 22: Post-fill adverse selection tracking at +10ms, +50ms, +250ms, +1s, +5s.
 *    Systematic unfavorable drift increases AdverseSelectionScore and automatically widens
 *    spreads or triggers defensive cancellation.
 * 3. Section 23: Reference-Market Guardian cross-checks deep CEX/Jupiter pools; if the reference
 *    price shifts by > threshold, local resting quotes are cancelled defensively.
 * 4. Section 24: Queue Position Valuation: Replaces only occur if price advantage exceeds lost
 *    queue priority value.
 */
import { hashCanonical } from '../pipeline/canonical-hashing.js';
export class SolanaMarketMakingEngine {
    fillHistory = [];
    adverseSelectionScore = 0; // 0 (clean) to 100 (hostile informed flow)
    currentInventoryLamports = 0n;
    maxInventoryCapacityLamports;
    constructor(maxInventoryCapacityLamports = 10000000000n) {
        this.maxInventoryCapacityLamports = maxInventoryCapacityLamports;
    }
    /**
     * Set current market-maker inventory balance to modulate inventory skew & asymmetric sizing.
     */
    recordInventory(currentInventoryLamports) {
        this.currentInventoryLamports = currentInventoryLamports;
    }
    /**
     * Section 21: Compute optimal quote spread based on volatility, inventory skew, and adverse selection.
     */
    calculateQuote(params) {
        const baseSpread = params.baseSpreadBps ?? 20; // 20 bps minimum baseline
        // Inventory skew penalty: if inventory is long, lower bids and asks to encourage selling
        const inventoryRatio = Number(this.currentInventoryLamports) / Number(this.maxInventoryCapacityLamports);
        const skewBps = Math.floor(inventoryRatio * 15);
        // Adverse selection widening: if toxic flow detected, widen spread up to 3x
        const toxicityWideningBps = Math.floor((this.adverseSelectionScore / 100) * 40);
        const totalSpreadBps = baseSpread + params.volatilityBps + toxicityWideningBps;
        const halfSpread = (params.fairMidPriceSol * (totalSpreadBps / 10_000)) / 2;
        const skewAdjustment = params.fairMidPriceSol * (skewBps / 10_000);
        // Orderbook queue depth imbalance micro-adjustment:
        // If bids dominate asks, buy pressure is strong; shift center price up slightly to capture edge on ask
        const totalQueueDepth = params.bidQueueDepth + params.askQueueDepth;
        const orderbookImbalanceRatio = totalQueueDepth > 0
            ? (params.bidQueueDepth - params.askQueueDepth) / (totalQueueDepth + 1)
            : 0;
        const imbalanceMicroShiftSol = params.fairMidPriceSol * (orderbookImbalanceRatio * 0.0002); // up to 2 bps micro-shift
        const bidPriceSol = Math.max(0.000001, params.fairMidPriceSol - halfSpread - skewAdjustment + imbalanceMicroShiftSol);
        const askPriceSol = params.fairMidPriceSol + halfSpread - skewAdjustment + imbalanceMicroShiftSol;
        // Expected net spread yield after 10 bps estimated round-trip exchange/priority fees
        const expectedNetSpreadYieldBps = Math.max(0, totalSpreadBps - 10);
        const quoteStatus = this.adverseSelectionScore >= 80 ? 'HALTED'
            : this.adverseSelectionScore >= 40 ? 'WIDENED_ADVERSE'
                : 'ACTIVE';
        // Asymmetric inventory-skewed sizing:
        // When long inventory, taper bid size and expand ask size to offload inventory at favorable prices
        let bidSizeLamports = 500000000n; // 0.5 SOL base
        let askSizeLamports = 500000000n;
        if (quoteStatus === 'HALTED') {
            bidSizeLamports = 0n;
            askSizeLamports = 0n;
        }
        else if (inventoryRatio > 0) {
            // Long inventory: scale down bid, scale up ask
            const bidScale = Math.max(0.1, 1 - inventoryRatio);
            const askScale = Math.min(2.0, 1 + inventoryRatio);
            bidSizeLamports = BigInt(Math.max(50_000_000, Math.floor(500_000_000 * bidScale)));
            askSizeLamports = BigInt(Math.min(1_000_000_000, Math.floor(500_000_000 * askScale)));
        }
        else if (inventoryRatio < 0) {
            // Short inventory: scale up bid, scale down ask
            const absRatio = Math.abs(inventoryRatio);
            const bidScale = Math.min(2.0, 1 + absRatio);
            const askScale = Math.max(0.1, 1 - absRatio);
            bidSizeLamports = BigInt(Math.min(1_000_000_000, Math.floor(500_000_000 * bidScale)));
            askSizeLamports = BigInt(Math.max(50_000_000, Math.floor(500_000_000 * askScale)));
        }
        const payload = {
            poolId: params.poolId,
            bidPriceSol,
            askPriceSol,
            totalSpreadBps,
            adverseSelectionScore: this.adverseSelectionScore,
        };
        const quoteId = `quote_mm_${hashCanonical(payload).slice(0, 12)}`;
        return Object.freeze({
            quoteId,
            poolId: params.poolId,
            bidPriceSol,
            askPriceSol,
            bidSizeLamports,
            askSizeLamports,
            spreadBps: totalSpreadBps,
            inventorySkewPct: inventoryRatio * 100,
            queuePositionBid: params.bidQueueDepth + 1,
            queuePositionAsk: params.askQueueDepth + 1,
            quoteStatus,
            expectedNetSpreadYieldBps,
            orderbookImbalanceRatio,
        });
    }
    /**
     * Section 22: Post-Fill Adverse Selection Measurement
     * Ingests chronological price samples at +10ms, +50ms, +250ms, +1s, +5s.
     */
    recordPostFillObservation(observation) {
        this.fillHistory.push(Object.freeze({ ...observation }));
        if (this.fillHistory.length > 200) {
            this.fillHistory.shift();
        }
        // Recompute adverse selection score from last 20 fills
        const recent = this.fillHistory.slice(-20);
        let adverseCount = 0;
        for (const f of recent) {
            if (f.price1s !== null) {
                if (f.fillSide === 'BUY' && f.price1s < f.fillPriceSol) {
                    // We bought, but price dropped within 1s -> adverse selection
                    adverseCount++;
                }
                else if (f.fillSide === 'SELL' && f.price1s > f.fillPriceSol) {
                    // We sold, but price rose within 1s -> adverse selection
                    adverseCount++;
                }
            }
        }
        this.adverseSelectionScore = recent.length > 0 ? Math.floor((adverseCount / recent.length) * 100) : 0;
    }
    /**
     * Section 23: Reference-Market Guardian
     * Compares local quoting pool mid-price against deep CEX/Jupiter reference market.
     */
    checkReferenceMarket(params) {
        const threshold = params.maxAllowedDivergenceBps ?? 25; // 25 bps threshold
        const diff = Math.abs(params.localQuoteMidPriceSol - params.referencePriceSol);
        const divergenceBps = (diff / params.referencePriceSol) * 10_000;
        const cancelRecommended = divergenceBps > threshold;
        return Object.freeze({
            referenceSource: params.referenceSource,
            referencePriceSol: params.referencePriceSol,
            localQuoteMidPriceSol: params.localQuoteMidPriceSol,
            divergenceBps,
            cancelRecommended,
        });
    }
    /**
     * Section 24: Queue Position Valuation
     * Asserts whether repricing to better price justifies losing queue seniority.
     */
    evaluateRepriceVsQueueSeniority(params) {
        const priceImprovementBps = (Math.abs(params.targetPriceSol - params.currentPriceSol) / params.currentPriceSol) * 10_000;
        // Seniority penalty: each queue spot gives ~2 bps of fill value
        const lostSeniorityCostBps = Math.min(50, params.currentQueuePosition * 2);
        const netAdvantageBps = priceImprovementBps - lostSeniorityCostBps;
        return Object.freeze({
            shouldReprice: netAdvantageBps > 5, // Only reprice if net advantage > 5 bps
            netAdvantageBps,
        });
    }
    getAdverseSelectionScore() {
        return this.adverseSelectionScore;
    }
    getTelemetry() {
        return Object.freeze({
            adverseSelectionScore: this.adverseSelectionScore,
            currentInventoryLamports: this.currentInventoryLamports,
            maxInventoryCapacityLamports: this.maxInventoryCapacityLamports,
            totalFillsObserved: this.fillHistory.length,
            recentFills: Object.freeze([...this.fillHistory.slice(-10)]),
        });
    }
}
//# sourceMappingURL=market-making-engine.js.map