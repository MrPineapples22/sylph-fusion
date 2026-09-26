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
export class NegativeKnowledgeDB {
    records = new Map();
    recordFailure(record) {
        this.records.set(record.recordId, record);
    }
    hasSimilarFailure(hypothesisKeywords) {
        const conflicts = [];
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
    getAllRecords() {
        return Array.from(this.records.values());
    }
    getRecordCount() {
        return this.records.size;
    }
}
//# sourceMappingURL=negative-db.js.map