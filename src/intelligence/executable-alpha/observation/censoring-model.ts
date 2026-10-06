/**
 * SYLPH FUSION — INFORMATIVE CENSORING & MNAR ENGINE
 * Studies: INFORMATIVE-CENSORING-X, MNAR-WORST-CASE-X (Section VIII)
 *
 * Invariant: Missing exit != Zero loss.
 * If a token's price history terminates abruptly, this is almost always
 * informative censoring (liquidity pulled, pool drained, or trading halted).
 * Under MNAR worst-case stress, missing exit observations are attributed
 * total loss (-100%) to prevent survivor bias.
 */

export interface CensoringAnalysis {
  readonly isCensored: boolean;
  readonly censoringType: 'RIGHT_CENSORED' | 'TERMINAL_COLLAPSE' | 'UNOBSERVED_EXIT' | 'COMPLETE';
  readonly lastObservedMultiple: number;
  readonly conservativeReturnMultiple: number;
  readonly attributedLossPct: number;
  readonly missingExitPenalized: boolean;
}

export class CensoringModelEngine {
  public static evaluateCensoring(
    lastObservedPriceSol: number,
    initialPriceSol: number,
    finalTimestampMs: number,
    currentTimeMs: number,
    poolActive: boolean
  ): CensoringAnalysis {
    const elapsedSinceLastObsSec = Math.max(0, (currentTimeMs - finalTimestampMs) / 1000.0);
    const lastMultiple = initialPriceSol > 0 ? lastObservedPriceSol / initialPriceSol : 0.0;

    // If pool is inactive or no tick for > 15 minutes, the history is right-censored
    if (!poolActive || elapsedSinceLastObsSec > 900.0) {
      // Under MNAR worst-case stress:
      // An unobserved exit is treated as a total loss (0.0x / -100%)
      return {
        isCensored: true,
        censoringType: !poolActive ? 'TERMINAL_COLLAPSE' : 'UNOBSERVED_EXIT',
        lastObservedMultiple: lastMultiple,
        conservativeReturnMultiple: 0.0,
        attributedLossPct: 100.0,
        missingExitPenalized: true,
      };
    }

    if (elapsedSinceLastObsSec > 180.0) {
      // Degraded / stale observation: penalize by 50% haircut
      return {
        isCensored: true,
        censoringType: 'RIGHT_CENSORED',
        lastObservedMultiple: lastMultiple,
        conservativeReturnMultiple: lastMultiple * 0.50,
        attributedLossPct: Math.min(100.0, (1.0 - (lastMultiple * 0.50)) * 100.0),
        missingExitPenalized: true,
      };
    }

    return {
      isCensored: false,
      censoringType: 'COMPLETE',
      lastObservedMultiple: lastMultiple,
      conservativeReturnMultiple: lastMultiple,
      attributedLossPct: Math.max(0, (1.0 - lastMultiple) * 100.0),
      missingExitPenalized: false,
    };
  }
}
