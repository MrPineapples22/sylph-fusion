/**
 * SOL-SYLPH Master Production Intelligence - Formal Safety Constitution
 * Specifications: Sections 57 (Formal Safety Constitution), 58 (Critical Invariants).
 *
 * Immutable rules across 10 safety categories:
 * CAPITAL, EXECUTION, POSITION, DATA, TEMPORAL, CHAIN, MODEL, PORTFOLIO, SECURITY, RECOVERY.
 */
export const SAFETY_CONSTITUTION_RULES = [
    {
        ruleId: 'SEC-001',
        category: 'SECURITY',
        description: 'NEVER trade tokens with active freeze authority or permanent delegate backdoors',
        isHardConstraint: true,
    },
    {
        ruleId: 'CAP-001',
        category: 'CAPITAL',
        description: 'NEVER execute without explicit independent risk engine capital authorization',
        isHardConstraint: true,
    },
    {
        ruleId: 'CAP-002',
        category: 'CAPITAL',
        description: 'NEVER breach the fundamental double-entry capital conservation identity',
        isHardConstraint: true,
    },
    {
        ruleId: 'POS-001',
        category: 'POSITION',
        description: 'NEVER exceed hard mandate position size or portfolio concentration ceilings',
        isHardConstraint: true,
    },
    {
        ruleId: 'DATA-001',
        category: 'DATA',
        description: 'NEVER treat UNKNOWN or missing provider observations as SAFE',
        isHardConstraint: true,
    },
    {
        ruleId: 'TEMP-001',
        category: 'TEMPORAL',
        description: 'NEVER allow future information or lookahead leakage into a point-in-time decision',
        isHardConstraint: true,
    },
    {
        ruleId: 'EXEC-001',
        category: 'EXECUTION',
        description: 'NEVER execute with stale quotes (> 1500 ms) or expired blockhashes',
        isHardConstraint: true,
    },
    {
        ruleId: 'EXEC-002',
        category: 'EXECUTION',
        description: 'NEVER allow strategy code direct access to raw private keys or transaction signers',
        isHardConstraint: true,
    },
    {
        ruleId: 'CHAIN-001',
        category: 'CHAIN',
        description: 'NEVER trust position balance before on-chain confirmation and reconciliation',
        isHardConstraint: true,
    },
    {
        ruleId: 'MOD-001',
        category: 'MODEL',
        description: 'NEVER allow unvalidated research models or extreme OOD signals direct capital authority',
        isHardConstraint: true,
    },
    {
        ruleId: 'PORT-001',
        category: 'PORTFOLIO',
        description: 'NEVER exceed aggregate portfolio risk capacity, tail loss, or concentration ceilings',
        isHardConstraint: true,
    },
    {
        ruleId: 'REC-001',
        category: 'RECOVERY',
        description: 'NEVER issue duplicate settlements or double-spend on process restart',
        isHardConstraint: true,
    },
];
export class SafetyConstitution {
    static getRules() {
        return SAFETY_CONSTITUTION_RULES;
    }
    static getConstitutionHash() {
        return 'sha256_constitution_v1_immutable_rules';
    }
}
//# sourceMappingURL=constitution.js.map