/**
 * SYLPH FUSION — COUNTEREXAMPLE MEMORY & REGRESSION CORPUS
 * Specifications: Prompt 56
 *
 * Permanent, machine-readable regression evidence for catastrophic failures and edge cases:
 *   - late landing
 *   - false NoLand
 *   - wrong ALT resolution
 *   - Token-2022 semantic miss
 *   - unexpected CPI
 *   - provider disagreement
 *   - fork error
 *   - slippage miss
 *   - bundle failure
 *   - capital lock
 *   - reconciliation mismatch
 *   - model false positive
 *   - market manipulation pattern
 *
 * Invariant: Never allow solved catastrophic classes to disappear from testing.
 */

import { hashCanonical } from './canonical-hashing.js';

export type FailureClass =
  | 'LATE_LANDING'
  | 'FALSE_NOLAND'
  | 'WRONG_ALT_RESOLUTION'
  | 'TOKEN_2022_SEMANTIC_MISS'
  | 'UNEXPECTED_CPI'
  | 'PROVIDER_DISAGREEMENT'
  | 'FORK_ERROR'
  | 'SLIPPAGE_MISS'
  | 'BUNDLE_FAILURE'
  | 'CAPITAL_LOCK'
  | 'RECONCILIATION_MISMATCH'
  | 'MODEL_FALSE_POSITIVE'
  | 'MARKET_MANIPULATION_PATTERN';

export interface CounterexampleRecord {
  readonly counterexampleId: string;
  readonly failureClass: FailureClass;
  readonly inputRoots: readonly string[];
  readonly systemVersions: {
    readonly engineVersion: string;
    readonly policyVersion: string;
    readonly schemaVersion: string;
  };
  readonly expectedBehavior: string;
  readonly actualBehavior: string;
  readonly fixVersion: string;
  readonly regressionTestReference: string;
  readonly recordedAt: string;
  readonly recordHash: string;
}

export class CounterexampleMemory {
  private readonly records = new Map<string, CounterexampleRecord>();

  constructor() {
    this.seedKnownCatastrophicCounterexamples();
  }

  private seedKnownCatastrophicCounterexamples(): void {
    // 1. False NoLand defect
    this.recordCounterexample({
      counterexampleId: 'ce_false_noland_001',
      failureClass: 'FALSE_NOLAND',
      inputRoots: ['root_unsearched_history'],
      systemVersions: {
        engineVersion: '1.0.0-legacy',
        policyVersion: 'policy_v0',
        schemaVersion: '1.0.0',
      },
      expectedBehavior: 'Maintain UNKNOWN / EXPIRED_UNRESOLVED if archive search was not actually performed',
      actualBehavior: 'Caller passed searchHistoryConfirmedNotFound: true without archive proof',
      fixVersion: '1.0.0-fusion-phase3',
      regressionTestReference: 'test/platform/no-land-red-team.test.mjs',
    });

    // 2. Trapped capital on timeout
    this.recordCounterexample({
      counterexampleId: 'ce_capital_lock_002',
      failureClass: 'CAPITAL_LOCK',
      inputRoots: ['root_expired_submission'],
      systemVersions: {
        engineVersion: '1.0.0-legacy',
        policyVersion: 'policy_v0',
        schemaVersion: '1.0.0',
      },
      expectedBehavior: 'Maintain encumbered unknown liability until authoritative chain outcome reconciliation',
      actualBehavior: 'Timeout was treated as non-existent or release was unverified',
      fixVersion: '1.0.0-fusion-phase2',
      regressionTestReference: 'test/platform/pipeline-adapters.test.mjs',
    });

    // 3. Fallback slippage labeled empirical
    this.recordCounterexample({
      counterexampleId: 'ce_slippage_miss_003',
      failureClass: 'SLIPPAGE_MISS',
      inputRoots: ['root_hardcoded_15bps'],
      systemVersions: {
        engineVersion: '1.0.0-legacy',
        policyVersion: 'policy_v0',
        schemaVersion: '1.0.0',
      },
      expectedBehavior: 'Explicitly mark fallback as non-empirical and require 10+ landed-vs-quoted samples',
      actualBehavior: 'Fallback 15 bps was presented as empirical observation',
      fixVersion: '1.0.0-fusion-phase5',
      regressionTestReference: 'test/platform/execution-economics.test.mjs',
    });
  }

  public recordCounterexample(params: Omit<CounterexampleRecord, 'recordedAt' | 'recordHash'>): CounterexampleRecord {
    const recordedAt = new Date().toISOString();
    const recordPayload = {
      ...params,
      recordedAt,
    };
    const recordHash = hashCanonical(recordPayload);

    const record: CounterexampleRecord = Object.freeze({
      ...params,
      recordedAt,
      recordHash,
    });

    this.records.set(record.counterexampleId, record);
    return record;
  }

  public get(id: string): CounterexampleRecord | undefined {
    return this.records.get(id);
  }

  public getByClass(failureClass: FailureClass): readonly CounterexampleRecord[] {
    return Object.freeze(Array.from(this.records.values()).filter(r => r.failureClass === failureClass));
  }

  public all(): readonly CounterexampleRecord[] {
    return Object.freeze(Array.from(this.records.values()));
  }
}
