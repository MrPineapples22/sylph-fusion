/**
 * SOL-SYLPH Master Production Intelligence - Negative Knowledge Database
 * Specifications: Section 85 (Negative Knowledge Database).
 *
 * Store failed ideas permanently:
 * - idea
 * - hypothesis
 * - experiment
 * - reason for failure (leakage, overfitting, redundancy, adversarial weakness, etc.)
 * - regime
 * - sample size
 */

export interface NegativeRecord {
  readonly recordId: string;
  readonly hypothesis: string;
  readonly failureReason:
    | 'TEMPORAL_LEAKAGE'
    | 'OVERFITTING'
    | 'REDUNDANT_WITH_EXISTING'
    | 'ADVERSARIALLY_MANIPULABLE'
    | 'EXECUTION_FRICTION_UNVIABLE'
    | 'REGIME_INSTABILITY';
  readonly testedRegimes: readonly string[];
  readonly sampleCount: number;
  readonly recordedAtMs: number;
  readonly notes: string;
}

export class NegativeKnowledgeDB {
  private readonly records: Map<string, NegativeRecord> = new Map();

  public recordFailure(record: NegativeRecord): void {
    this.records.set(record.recordId, record);
  }

  public hasSimilarFailure(hypothesisKeywords: readonly string[]): {
    matched: boolean;
    conflictingRecords: readonly NegativeRecord[];
  } {
    const conflicts: NegativeRecord[] = [];

    for (const record of this.records.values()) {
      const lowerHypo = record.hypothesis.toLowerCase();
      const matchCount = hypothesisKeywords.filter((k) => lowerHypo.includes(k.toLowerCase())).length;
      if (matchCount >= 2 || (hypothesisKeywords.length === 1 && matchCount === 1)) {
        conflicts.push(record);
      }
    }

    return {
      matched: conflicts.length > 0,
      conflictingRecords: conflicts,
    };
  }

  public getAllRecords(): readonly NegativeRecord[] {
    return Array.from(this.records.values());
  }

  public getRecordCount(): number {
    return this.records.size;
  }
}
