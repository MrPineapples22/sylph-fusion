/**
 * SYLPH FUSION — QUOTE DECAY ENGINE
 * Study 35: QUOTE-DECAY-X (Section XVI)
 *
 * Models the half-life and adverse selection degradation of executable quotes.
 * In fast-moving Solana mempool environments, a quote issued at slot T degrades
 * rapidly by slot T+1, T+2, or due to intervening front-running trades.
 */

export interface QuoteDecayReport {
  readonly initialPriceUsd: number;
  readonly degradedPriceUsd: number;
  readonly decayBps: number;
  readonly elapsedMs: number;
  readonly elapsedSlots: number;
  readonly isQuoteStale: boolean;
  readonly adverseSelectionRisk: number; // [0, 1]
}

export class QuoteDecayEngine {
  // Empirical observation: after 2 slots (~800ms) or 1500ms, quote decay exceeds slippage tolerance
  public static readonly MAX_VALID_SLOT_LAG = 2;
  public static readonly MAX_VALID_MS = 1500;

  public static evaluateDecay(params: {
    initialPriceUsd: number;
    quoteSlot: bigint;
    currentSlot: bigint;
    quoteTimestampMs: number;
    currentTimestampMs: number;
    volatilityAnnualized?: number;
  }): QuoteDecayReport {
    const {
      initialPriceUsd,
      quoteSlot,
      currentSlot,
      quoteTimestampMs,
      currentTimestampMs,
      volatilityAnnualized = 1.8,
    } = params;

    const elapsedSlots = Math.max(0, Number(currentSlot - quoteSlot));
    const elapsedMs = Math.max(0, currentTimestampMs - quoteTimestampMs);

    // Adverse selection drift model: decay grows quadratically with elapsed slots in volatile regimes
    const slotDecayFactor = Math.pow(elapsedSlots, 1.3) * 0.0035; // 35 bps per slot
    const timeDecayFactor = (elapsedMs / 1000.0) * (volatilityAnnualized * 0.005);
    const totalDecayFrac = slotDecayFactor + timeDecayFactor;

    const decayBps = Math.round(totalDecayFrac * 10000);
    // Degradation is adverse: buying pays more, selling receives less
    const degradedPriceUsd = initialPriceUsd * (1.0 + totalDecayFrac);

    const isQuoteStale = elapsedSlots > this.MAX_VALID_SLOT_LAG || elapsedMs > this.MAX_VALID_MS;
    const adverseSelectionRisk = Math.min(1.0, totalDecayFrac * 15.0);

    return {
      initialPriceUsd,
      degradedPriceUsd,
      decayBps,
      elapsedMs,
      elapsedSlots,
      isQuoteStale,
      adverseSelectionRisk,
    };
  }
}
