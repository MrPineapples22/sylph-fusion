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
export class CounterexampleMemory {
    records = new Map();
    constructor() {
        this.seedKnownCatastrophicCounterexamples();
    }
    seedKnownCatastrophicCounterexamples() {
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
    recordCounterexample(params) {
        const recordedAt = new Date().toISOString();
        const recordPayload = {
            ...params,
            recordedAt,
        };
        const recordHash = hashCanonical(recordPayload);
        const record = Object.freeze({
            ...params,
            recordedAt,
            recordHash,
        });
        this.records.set(record.counterexampleId, record);
        return record;
    }
    get(id) {
        return this.records.get(id);
    }
    getByClass(failureClass) {
        return Object.freeze(Array.from(this.records.values()).filter(r => r.failureClass === failureClass));
    }
    all() {
        return Object.freeze(Array.from(this.records.values()));
    }
}
//# sourceMappingURL=counterexample-memory.js.map