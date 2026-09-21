/**
 * SHANNON: Information Flow & Signal Originality Engine
 * Blueprint Engine #5
 * 
 * Determines signal originality, information entropy, and velocity:
 * States: ORIGIN | EARLY | PROPAGATING | PUBLIC | SATURATED | STALE.
 * Critical Invariant: Prevents six correlated indicators caused by one underlying event
 * from being counted as six independent confirmations.
 */

export type ShannonInformationState = 
  | 'ORIGIN'
  | 'EARLY'
  | 'PROPAGATING'
  | 'PUBLIC'
  | 'SATURATED'
  | 'STALE';

export interface RawSignalSource {
  readonly id: string;
  readonly name: string;
  readonly observed_at_ms: number;
  readonly underlying_event_id: string; // The root event causing this signal
  readonly raw_strength: number; // 0.0 to 1.0
  readonly source_type: 'ON_CHAIN_TX' | 'POOL_EVENT' | 'DEX_TICKER' | 'SOCIAL_DISCORD' | 'MODEL_DERIVED';
}

export interface ShannonSignalEvaluation {
  readonly state: ShannonInformationState;
  readonly originality_score: number; // 0.0 (fully saturated/duplicate) to 1.0 (novel origin)
  readonly effective_independent_signals: number;
  readonly discounted_aggregate_strength: number;
  readonly entropy_bits: number;
  readonly information_age_ms: number;
  readonly is_stale: boolean;
}

export class ShannonInformationFlowEngine {
  public static readonly VERSION = '1.0.0';

  /**
   * Evaluates a set of concurrent signals for a token, discounting duplicates
   * that stem from the same root event.
   */
  public static evaluateSignals(
    signals: readonly RawSignalSource[],
    nowMs: number = Date.now()
  ): ShannonSignalEvaluation {
    if (!signals || signals.length === 0) {
      return {
        state: 'STALE',
        originality_score: 0.0,
        effective_independent_signals: 0,
        discounted_aggregate_strength: 0,
        entropy_bits: 0,
        information_age_ms: 0,
        is_stale: true
      };
    }

    // Group signals by underlying root event id to avoid double counting
    const groupedByRootEvent = new Map<string, RawSignalSource[]>();
    let earliestObservedMs = Infinity;
    let latestObservedMs = -Infinity;

    for (const sig of signals) {
      if (sig.observed_at_ms < earliestObservedMs) earliestObservedMs = sig.observed_at_ms;
      if (sig.observed_at_ms > latestObservedMs) latestObservedMs = sig.observed_at_ms;

      const group = groupedByRootEvent.get(sig.underlying_event_id) ?? [];
      group.push(sig);
      groupedByRootEvent.set(sig.underlying_event_id, group);
    }

    const independentRootsCount = groupedByRootEvent.size;
    const rawCount = signals.length;

    // Originality is the ratio of independent events to total claimed signals
    const originality = Math.min(1.0, independentRootsCount / rawCount);

    // Compute discounted strength: each root event only gets its maximum strength + 0.1 for corroboration
    let discountedStrengthSum = 0;
    for (const group of groupedByRootEvent.values()) {
      const maxStrength = Math.max(...group.map(s => s.raw_strength));
      const corroborationBonus = Math.min(0.2, (group.length - 1) * 0.05);
      discountedStrengthSum += Math.min(1.0, maxStrength + corroborationBonus);
    }

    const ageMs = Math.max(0, nowMs - earliestObservedMs);
    const isStale = ageMs > 60000; // > 60s without fresh root events

    // Determine state based on age and propagation spread
    let state: ShannonInformationState = 'EARLY';
    if (isStale) {
      state = 'STALE';
    } else if (ageMs < 3000 && independentRootsCount <= 2) {
      state = 'ORIGIN';
    } else if (ageMs < 15000) {
      state = 'EARLY';
    } else if (ageMs < 45000) {
      state = 'PROPAGATING';
    } else if (independentRootsCount > 8 || rawCount > 15) {
      state = 'SATURATED';
    } else {
      state = 'PUBLIC';
    }

    // Shannon entropy approximation H(X) = - sum(p * log2(p)) across root event weights
    let entropy = 0;
    if (discountedStrengthSum > 0) {
      for (const group of groupedByRootEvent.values()) {
        const p = Math.max(...group.map(s => s.raw_strength)) / discountedStrengthSum;
        if (p > 0) {
          entropy -= p * Math.log2(p);
        }
      }
    }

    return {
      state,
      originality_score: Number(originality.toFixed(3)),
      effective_independent_signals: independentRootsCount,
      discounted_aggregate_strength: Number((discountedStrengthSum / Math.max(1, independentRootsCount)).toFixed(3)),
      entropy_bits: Number(entropy.toFixed(3)),
      information_age_ms: ageMs,
      is_stale: isStale
    };
  }
}
