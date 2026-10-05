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

export interface MarketMakerQuote {
  readonly quoteId: string;
  readonly poolId: string;
  readonly bidPriceSol: number;
  readonly askPriceSol: number;
  readonly bidSizeLamports: bigint;
  readonly askSizeLamports: bigint;
  readonly spreadBps: number;
  readonly inventorySkewPct: number;
  readonly queuePositionBid: number;
  readonly queuePositionAsk: number;
  readonly quoteStatus: 'ACTIVE' | 'CANCELLED_DEFENSIVE' | 'WIDENED_ADVERSE' | 'HALTED';
}

export interface PostFillObservation {
  readonly fillId: string;
  readonly fillPriceSol: number;
  readonly fillSide: 'BUY' | 'SELL';
  readonly filledAtMs: number;
  readonly price10ms: number | null;
  readonly price50ms: number | null;
  readonly price250ms: number | null;
  readonly price1s: number | null;
  readonly price5s: number | null;
}

export interface ReferenceMarketCheck {
  readonly referenceSource: string;
  readonly referencePriceSol: number;
  readonly localQuoteMidPriceSol: number;
  readonly divergenceBps: number;
  readonly cancelRecommended: boolean;
}

export class SolanaMarketMakingEngine {
  private readonly fillHistory: PostFillObservation[] = [];
  private adverseSelectionScore: number = 0; // 0 (clean) to 100 (hostile informed flow)
  private currentInventoryLamports: bigint = 0n;
  private readonly maxInventoryCapacityLamports: bigint;

  constructor(maxInventoryCapacityLamports: bigint = 10_000_000_000n) { // 10 SOL default
    this.maxInventoryCapacityLamports = maxInventoryCapacityLamports;
  }

  /**
   * Section 21: Compute optimal quote spread based on volatility, inventory skew, and adverse selection.
   */
  public calculateQuote(params: {
    poolId: string;
    fairMidPriceSol: number;
    volatilityBps: number;
    baseSpreadBps?: number;
    bidQueueDepth: number;
    askQueueDepth: number;
  }): MarketMakerQuote {
    const baseSpread = params.baseSpreadBps ?? 20; // 20 bps minimum baseline
    
    // Inventory skew penalty: if inventory is long, lower bids and asks to encourage selling
    const inventoryRatio = Number(this.currentInventoryLamports) / Number(this.maxInventoryCapacityLamports);
    const skewBps = Math.floor(inventoryRatio * 15);

    // Adverse selection widening: if toxic flow detected, widen spread up to 3x
    const toxicityWideningBps = Math.floor((this.adverseSelectionScore / 100) * 40);
    const totalSpreadBps = baseSpread + params.volatilityBps + toxicityWideningBps;

    const halfSpread = (params.fairMidPriceSol * (totalSpreadBps / 10_000)) / 2;
    const skewAdjustment = params.fairMidPriceSol * (skewBps / 10_000);

    const bidPriceSol = Math.max(0.000001, params.fairMidPriceSol - halfSpread - skewAdjustment);
    const askPriceSol = params.fairMidPriceSol + halfSpread - skewAdjustment;

    const quoteStatus = this.adverseSelectionScore >= 80 ? 'HALTED'
      : this.adverseSelectionScore >= 40 ? 'WIDENED_ADVERSE'
      : 'ACTIVE';

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
      bidSizeLamports: quoteStatus === 'HALTED' ? 0n : 500_000_000n, // 0.5 SOL
      askSizeLamports: quoteStatus === 'HALTED' ? 0n : 500_000_000n,
      spreadBps: totalSpreadBps,
      inventorySkewPct: inventoryRatio * 100,
      queuePositionBid: params.bidQueueDepth + 1,
      queuePositionAsk: params.askQueueDepth + 1,
      quoteStatus,
    });
  }

  /**
   * Section 22: Post-Fill Adverse Selection Measurement
   * Ingests chronological price samples at +10ms, +50ms, +250ms, +1s, +5s.
   */
  public recordPostFillObservation(observation: PostFillObservation): void {
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
        } else if (f.fillSide === 'SELL' && f.price1s > f.fillPriceSol) {
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
  public checkReferenceMarket(params: {
    referenceSource: string;
    referencePriceSol: number;
    localQuoteMidPriceSol: number;
    maxAllowedDivergenceBps?: number;
  }): ReferenceMarketCheck {
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
  public evaluateRepriceVsQueueSeniority(params: {
    currentQueuePosition: number;
    currentPriceSol: number;
    targetPriceSol: number;
    estimatedFillProbAtCurrentPosition: number;
  }): { readonly shouldReprice: boolean; readonly netAdvantageBps: number } {
    const priceImprovementBps = (Math.abs(params.targetPriceSol - params.currentPriceSol) / params.currentPriceSol) * 10_000;
    // Seniority penalty: each queue spot gives ~2 bps of fill value
    const lostSeniorityCostBps = Math.min(50, params.currentQueuePosition * 2);
    const netAdvantageBps = priceImprovementBps - lostSeniorityCostBps;

    return Object.freeze({
      shouldReprice: netAdvantageBps > 5, // Only reprice if net advantage > 5 bps
      netAdvantageBps,
    });
  }

  public getAdverseSelectionScore(): number {
    return this.adverseSelectionScore;
  }
}
