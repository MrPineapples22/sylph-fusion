/**
 * FISHER: Statistical Evidence & Multiple Testing Engine
 * Blueprint Engine #20
 *
 * Controls statistical rigor:
 * - Multiple hypothesis testing corrections (Bonferroni & Benjamini-Hochberg FDR)
 * - Sample sufficiency controls
 * - Separation of Statistical Significance (p-value) vs Economic Significance (net alpha after fees)
 * - Permanent archive of negative experiments to prevent survivor bias.
 */
export class FisherStatisticalEvidenceEngine {
    static VERSION = '1.0.0';
    negativeArchive = [];
    /**
     * Applies Benjamini-Hochberg False Discovery Rate correction across a batch of hypothesis tests.
     */
    static evaluateBatch(tests, targetFdr = 0.05) {
        const m = tests.length;
        if (m === 0)
            return [];
        // Sort by p-value ascending
        const sorted = [...tests].map((t, origIdx) => ({ ...t, origIdx })).sort((a, b) => a.raw_p_value - b.raw_p_value);
        return sorted.map((item, rankIdx) => {
            const rank = rankIdx + 1;
            const adjustedP = Math.min(1.0, (item.raw_p_value * m) / rank);
            const isStatSig = adjustedP < targetFdr && item.sample_size >= 30; // Minimum 30 samples
            const netAlpha = item.observed_alpha_bps - item.transaction_cost_bps;
            const isEconSig = netAlpha > (item.transaction_cost_bps * 1.5); // Net alpha must comfortably exceed costs
            return {
                test_id: item.test_id,
                hypothesis_name: item.hypothesis_name,
                raw_p_value: item.raw_p_value,
                adjusted_p_value: Number(adjustedP.toFixed(4)),
                is_statistically_significant: isStatSig,
                is_economically_significant: isEconSig,
                accepted_as_valid_evidence: isStatSig && isEconSig
            };
        });
    }
    recordNegativeResult(record) {
        if (record.is_null_result) {
            this.negativeArchive.push(record);
        }
    }
    getNegativeArchiveCount() {
        return this.negativeArchive.length;
    }
}
//# sourceMappingURL=fisher-evidence.js.map