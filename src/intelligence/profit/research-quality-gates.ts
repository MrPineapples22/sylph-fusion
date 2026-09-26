/** Shadow/paper research gates; these types cannot authorize a transaction. */
export type EconomicOutcome = 'WIN' | 'FLAT' | 'ORDINARY_LOSS' | 'RUG' | 'LIQUIDITY_COLLAPSE' | 'PARTIAL_FILL' | 'NO_FILL' | 'FAILED_TRANSACTION';

export interface ResearchRecord {
  readonly recordId: string;
  readonly requiredFields: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
  readonly outcome?: EconomicOutcome;
}

export interface CompletenessReport {
  readonly records: number;
  readonly requiredValues: number;
  readonly presentValues: number;
  readonly completenessBps: number;
  readonly missingByField: Readonly<Record<string, number>>;
}

export function classifyEconomicOutcome(params: {
  readonly grossPnlLamports: bigint;
  readonly netPnlLamports: bigint;
  readonly fillFractionBps: number;
  readonly failedTransaction: boolean;
  readonly rugObserved: boolean;
  readonly liquidityCollapseObserved: boolean;
}): EconomicOutcome {
  if (!Number.isInteger(params.fillFractionBps) || params.fillFractionBps < 0 || params.fillFractionBps > 10_000) throw new Error('FILL_FRACTION_BPS_INVALID');
  if (params.failedTransaction) return 'FAILED_TRANSACTION';
  if (params.fillFractionBps === 0) return 'NO_FILL';
  if (params.rugObserved) return 'RUG';
  if (params.liquidityCollapseObserved) return 'LIQUIDITY_COLLAPSE';
  if (params.fillFractionBps < 10_000) return 'PARTIAL_FILL';
  if (params.netPnlLamports > 0n) return 'WIN';
  if (params.netPnlLamports === 0n) return 'FLAT';
  return 'ORDINARY_LOSS';
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

export function assessEconomicCompleteness(records: readonly ResearchRecord[]): CompletenessReport {
  const missingByField: Record<string, number> = {};
  let requiredValues = 0;
  let presentValues = 0;
  const ids = new Set<string>();
  for (const record of records) {
    if (!record.recordId || ids.has(record.recordId)) throw new Error('RESEARCH_RECORD_ID_MUST_BE_UNIQUE');
    ids.add(record.recordId);
    for (const field of record.requiredFields) {
      if (!field) throw new Error('REQUIRED_FIELD_NAME_INVALID');
      requiredValues += 1;
      if (present(record.values[field])) presentValues += 1;
      else missingByField[field] = (missingByField[field] ?? 0) + 1;
    }
  }
  return {
    records: records.length,
    requiredValues,
    presentValues,
    completenessBps: requiredValues === 0 ? 10_000 : Math.floor((presentValues / requiredValues) * 10_000),
    missingByField: Object.freeze(missingByField),
  };
}

/** Refuse to declare a research cohort eligible when its economics are incomplete. */
export function assertEconomicCohortEligible(report: CompletenessReport, minimumCompletenessBps = 9_900): void {
  if (!Number.isInteger(minimumCompletenessBps) || minimumCompletenessBps < 0 || minimumCompletenessBps > 10_000) throw new Error('MINIMUM_COMPLETENESS_BPS_INVALID');
  if (report.records === 0) throw new Error('ECONOMIC_COHORT_EMPTY');
  if (report.completenessBps < minimumCompletenessBps) throw new Error('ECONOMIC_COHORT_INCOMPLETE');
}
