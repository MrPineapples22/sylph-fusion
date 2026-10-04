/**
 * PHASE 3 — VETO-TOTALITY: COMPLETE SAFETY COVERAGE ENGINE
 *
 * Implements:
 * - HardRuleCoverageCertificate generation and verification
 * - Mathematical invariant:
 *   FAIL: exists rule r in Applicable: Violation(r) proven
 *   PASS: forall rule r in Applicable: no violation exists AND coverage is COMPLETE
 * - Any UNKNOWN, CONFLICTED, or UNSUPPORTED rule strictly prevents PASS.
 */
import { sha256Hex, } from './types.js';
export class VetoTotalityEngine {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    /**
     * Generates a HardRuleCoverageCertificate across all applicable registered hard rules.
     */
    certifyCoverage(subject, bank, evaluations) {
        const allRules = this.registry.allActiveRules();
        const applicableRules = [];
        for (const rule of allRules) {
            if (rule.applicability.subjectKind === subject.kind) {
                if (!rule.applicability.clusterGenesisHash || rule.applicability.clusterGenesisHash === subject.clusterGenesisHash) {
                    applicableRules.push(rule);
                }
            }
        }
        const missingRuleIds = [];
        const evaluatedRuleIds = [];
        let hasConflict = false;
        let hasIncomplete = false;
        for (const rule of applicableRules) {
            const summary = evaluations.get(rule.ruleId);
            if (!summary) {
                missingRuleIds.push(rule.ruleId);
                hasIncomplete = true;
            }
            else {
                evaluatedRuleIds.push(rule.ruleId);
                if (summary.status === 'CONFLICTED') {
                    hasConflict = true;
                }
                else if (summary.status === 'UNKNOWN' || summary.status === 'NOT_APPLICABLE') {
                    hasIncomplete = true;
                }
            }
        }
        let coverageState = 'COMPLETE';
        if (hasConflict) {
            coverageState = 'CONFLICTED';
        }
        else if (hasIncomplete || missingRuleIds.length > 0 || applicableRules.length === 0) {
            coverageState = 'INCOMPLETE';
        }
        const certificateId = `hrcc_${subject.mint}_${bank.slot}`;
        const unsigned = {
            certificateId,
            subject,
            bank,
            totalApplicableRules: applicableRules.length,
            evaluatedRuleIds: evaluatedRuleIds.sort(),
            coverageState,
            missingRuleIds: missingRuleIds.sort(),
            evaluatedAtSlot: bank.slot,
        };
        return Object.freeze({
            ...unsigned,
            certificateHash: sha256Hex(unsigned),
        });
    }
    /**
     * Asserts whether a subject is eligible for PASS.
     * PASS is valid ONLY IF coverage is COMPLETE and NO applicable rule is FAIL or CONFLICTED.
     */
    verifyPassEligibility(coverageCert, evaluations) {
        if (coverageCert.coverageState !== 'COMPLETE') {
            return {
                isEligibleForPass: false,
                reason: `Pass denied: Hard rule coverage is ${coverageCert.coverageState} (missing ${coverageCert.missingRuleIds.length} rules)`,
            };
        }
        for (const ruleId of coverageCert.evaluatedRuleIds) {
            const evalRes = evaluations.get(ruleId);
            if (!evalRes || evalRes.status !== 'PASS') {
                return {
                    isEligibleForPass: false,
                    reason: `Pass denied: Rule ${ruleId} evaluated to ${evalRes?.status ?? 'MISSING'}`,
                };
            }
        }
        return {
            isEligibleForPass: true,
            reason: 'Complete safety coverage proves no active hard violation across all applicable rules',
        };
    }
}
//# sourceMappingURL=totality.js.map