/**
 * SOL-SYLPH Thesis Autopsy Engine
 * Blueprint Part LII
 *
 * Post-trade forensic causal reconstruction:
 * INITIAL THESIS → SUPPORTING EVIDENCE → CONTRADICTIONS →
 * THESIS TRANSITIONS → DECISIONS → EXECUTION → OUTCOME.
 * Evaluates: InvalidationLatency, FalseInvalidation, MissedInvalidation, LateInvalidation.
 */

export interface ThesisAutopsyRecord {
  readonly autopsyId: string;
  readonly mint: string;
  readonly initialThesisSummary: string;
  readonly actualOutcome: 'PROFITABLE_EXIT' | 'STOPPED_OUT' | 'RUGGED' | 'EXPIRED';
  readonly invalidationLatencyMs: number;
  readonly classification: 'ACCURATE_INVALIDATION' | 'FALSE_INVALIDATION' | 'MISSED_INVALIDATION' | 'LATE_INVALIDATION' | 'HEALTHY_THESIS_CONFIRMED';
  readonly causalPath: readonly string[];
  readonly policyLesson: string;
}

export class ThesisAutopsyEngine {
  public conductAutopsy(params: {
    mint: string;
    thesisCreatedMs: number;
    invalidationTriggeredMs?: number;
    shockEventMs?: number;
    actualOutcome: 'PROFITABLE_EXIT' | 'STOPPED_OUT' | 'RUGGED' | 'EXPIRED';
    wasThesisInvalidated: boolean;
  }): ThesisAutopsyRecord {
    const mint = params.mint;
    let latency = 0;
    let classification: ThesisAutopsyRecord['classification'] = 'HEALTHY_THESIS_CONFIRMED';

    if (params.shockEventMs && params.invalidationTriggeredMs) {
      latency = params.invalidationTriggeredMs - params.shockEventMs;
    }

    if (params.actualOutcome === 'RUGGED' || params.actualOutcome === 'STOPPED_OUT') {
      if (!params.wasThesisInvalidated) {
        classification = 'MISSED_INVALIDATION';
      } else if (latency > 5000) {
        classification = 'LATE_INVALIDATION';
      } else {
        classification = 'ACCURATE_INVALIDATION';
      }
    } else if (params.actualOutcome === 'PROFITABLE_EXIT') {
      if (params.wasThesisInvalidated) {
        classification = 'FALSE_INVALIDATION';
      } else {
        classification = 'HEALTHY_THESIS_CONFIRMED';
      }
    }

    const causalPath = [
      `1. Initial thesis established at ${new Date(params.thesisCreatedMs).toISOString()}`,
      params.shockEventMs ? `2. Adversarial shock or market deterioration detected at ${new Date(params.shockEventMs).toISOString()}` : '2. No catastrophic shock detected',
      params.wasThesisInvalidated ? `3. Thesis invalidated at ${params.invalidationTriggeredMs ? new Date(params.invalidationTriggeredMs).toISOString() : 'unknown'}` : '3. Thesis remained intact throughout trade lifecycle',
      `4. Final outcome: ${params.actualOutcome}`,
    ];

    let lesson = '';
    if (classification === 'MISSED_INVALIDATION') {
      lesson = 'Model missed invalidating thesis before shock landed. Tighten threshold on exit capacity deterioration.';
    } else if (classification === 'LATE_INVALIDATION') {
      lesson = `Invalidation lagged market collapse by ${latency}ms. Prioritize early velocity alerts.`;
    } else if (classification === 'FALSE_INVALIDATION') {
      lesson = 'Premature invalidation caused by transient noise. Widen threshold for temporary price excursions.';
    } else {
      lesson = 'Thesis lifecycle performed accurately according to policy expectations.';
    }

    return {
      autopsyId: `autopsy_${mint.slice(0, 6)}_${Date.now()}`,
      mint,
      initialThesisSummary: 'Initial multi-agent verified thesis',
      actualOutcome: params.actualOutcome,
      invalidationLatencyMs: latency,
      classification,
      causalPath,
      policyLesson: lesson,
    };
  }
}
