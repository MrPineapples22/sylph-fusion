/**
 * SYLPH FUSION — OBSERVATION QUALITY ENGINE
 * Study: OBSERVABILITY-GAP-X, EXECUTABLE-PEAK-X (Section VIII)
 *
 * Evaluates whether raw stream observations meet minimum data quality,
 * lag boundaries, and missingness tolerances before features are evaluated.
 */

import { createHash } from 'node:crypto';
import type { ObservationQualityCertificate, PointInTimeResearchState } from '../types.js';

export interface ObservationQualityInputs {
  readonly observationCount: number;
  readonly historySpanSeconds: number;
  readonly slotLag: number;
  readonly wallAgeMs: number;
  readonly maxObservedGapSeconds: number;
  readonly sourceCount: number;
  readonly sourcesInAgreement: number;
  readonly unobservedDropCount: number;
}

export class ObservationQualityEngine {
  public static evaluate(inputs: ObservationQualityInputs): ObservationQualityCertificate {
    const blockers: string[] = [];
    const numericInputs = [
      ['OBSERVATION_COUNT', inputs.observationCount], ['HISTORY_SPAN_SECONDS', inputs.historySpanSeconds],
      ['SLOT_LAG', inputs.slotLag], ['WALL_AGE_MS', inputs.wallAgeMs],
      ['MAX_OBSERVED_GAP_SECONDS', inputs.maxObservedGapSeconds], ['SOURCE_COUNT', inputs.sourceCount],
      ['SOURCES_IN_AGREEMENT', inputs.sourcesInAgreement], ['UNOBSERVED_DROP_COUNT', inputs.unobservedDropCount],
    ] as const;
    for (const [name, value] of numericInputs) if (!Number.isFinite(value)) blockers.push(`INVALID_${name}`);
    if (inputs.observationCount < 0 || inputs.historySpanSeconds < 0 || inputs.maxObservedGapSeconds < 0 ||
        inputs.sourceCount < 0 || inputs.sourcesInAgreement < 0 || inputs.unobservedDropCount < 0) {
      blockers.push('NEGATIVE_OBSERVATION_QUALITY_INPUT');
    }
    if (inputs.sourcesInAgreement > inputs.sourceCount) blockers.push('SOURCE_AGREEMENT_EXCEEDS_SOURCE_COUNT');
    const invalidTemporalInput = !Number.isFinite(inputs.wallAgeMs) || !Number.isFinite(inputs.slotLag);
    if (invalidTemporalInput) blockers.push('INVALID_TEMPORAL_INPUT');

    // Invariant: Short history constraint (< 3 observations is unverified)
    if (inputs.observationCount < 2) {
      blockers.push('SINGLE_OBSERVATION_INSUFFICIENT');
    }

    // Future leakage check (observation timestamp ahead of decision clock or negative wall age)
    if (!invalidTemporalInput && (inputs.wallAgeMs < 0 || inputs.slotLag < 0)) {
      blockers.push('FUTURE_LEAKAGE_DETECTED: Observation timestamp in future of decision clock');
    }

    // Wall age fence (default: 5000ms freshness)
    if (inputs.wallAgeMs > 5000) {
      blockers.push('WALL_AGE_EXCEEDS_FRESHNESS_LIMIT');
    }

    // Slot lag fence (> 12 slots is stale on Solana)
    if (inputs.slotLag > 12) {
      blockers.push('SLOT_LAG_EXCESSIVE');
    }

    // Gap fence (> 60s gap in early token history indicates collector disconnect or dead token)
    if (inputs.maxObservedGapSeconds > 60) {
      blockers.push('OBSERVATION_GAP_EXCEEDS_60S');
    }

    // Source agreement check (if multiple sources exist, at least 60% must agree)
    const sourceAgreement = inputs.sourceCount > 1 && inputs.sourcesInAgreement <= inputs.sourceCount
      ? inputs.sourcesInAgreement / inputs.sourceCount
      : inputs.sourceCount > 0 && inputs.sourcesInAgreement > inputs.sourceCount ? 0 : 1.0;
    if (inputs.sourceCount > 1 && sourceAgreement < 0.60) {
      blockers.push('CROSS_SOURCE_DISAGREEMENT');
    }

    // Coverage metric: based on expected sample density (1 sample per 3s)
    const expectedSamples = Math.max(1, Math.floor(inputs.historySpanSeconds / 3.0));
    const observationCoverage = Math.min(1.0, inputs.observationCount / expectedSamples);

    // Missingness risk
    const missingnessRisk = inputs.observationCount < 5
      ? 0.85
      : Math.min(1.0, (inputs.maxObservedGapSeconds / 120.0) + (inputs.unobservedDropCount * 0.15));

    // Censoring risk (high when history is truncated abruptly < 90s)
    const censoringRisk = inputs.historySpanSeconds < 90.0
      ? 0.80
      : inputs.historySpanSeconds < 300.0 ? 0.40 : 0.10;

    const sufficient = blockers.length === 0 && observationCoverage >= 0.40 && missingnessRisk <= 0.70;

    const digest = createHash('sha256')
      .update([
        inputs.observationCount,
        inputs.slotLag,
        inputs.wallAgeMs,
        inputs.historySpanSeconds,
        inputs.maxObservedGapSeconds,
        inputs.sourceCount,
        inputs.sourcesInAgreement,
        inputs.unobservedDropCount,
        observationCoverage.toFixed(4),
        missingnessRisk.toFixed(4),
        sufficient ? 'PASS' : 'FAIL',
        blockers.join(','),
      ].join('::'))
      .digest('hex');

    return {
      observationCoverage,
      slotLag: inputs.slotLag,
      wallAgeMs: inputs.wallAgeMs,
      interveningTrades: inputs.observationCount,
      missingnessRisk,
      censoringRisk,
      sourceAgreement,
      sufficient,
      blockers,
      certificateDigest: digest,
    };
  }
}
