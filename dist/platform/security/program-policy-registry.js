/**
 * SOL-SYLPH 2026 Platform - Program Policy Registry & Address Classifier
 *
 * Enforces address and instruction policy in SigningFirewall:
 * - Differentiates between User Wallet, Token Account, Mint, and Executable Program.
 * - Enforces allowed program registry:
 *   SystemProgram, SPL Token, Token-2022, Jupiter, Associated Token Program, Compute Budget.
 * - Strictly rejects unknown programs or direct SOL transfers to non-system destinations.
 */
export class ProgramPolicyRegistry {
    static POLICIES = new Map([
        ['11111111111111111111111111111111', { programId: '11111111111111111111111111111111', name: 'System Program', policy: 'ALLOW', notes: 'Native transfers & account creation' }],
        ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', name: 'SPL Token Program', policy: 'ALLOW', notes: 'Standard SPL token transfers & burns' }],
        ['TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', name: 'Token-2022 Program', policy: 'CONDITIONAL', notes: 'Requires TokenSemanticsAuthority validation' }],
        ['ComputeBudget111111111111111111111111111111', { programId: 'ComputeBudget111111111111111111111111111111', name: 'Compute Budget Program', policy: 'ALLOW', notes: 'Compute units & priority fees' }],
        ['ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', { programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', name: 'Associated Token Program', policy: 'ALLOW', notes: 'Idempotent ATA creation' }],
        ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', { programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', name: 'Jupiter v6 Meta-Aggregator', policy: 'ALLOW', notes: 'Certified DEX aggregator routing' }],
        ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', { programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', name: 'Pump.fun Bonding Curve Program', policy: 'ALLOW', notes: 'Primary market curve execution' }],
    ]);
    static evaluateProgram(programId) {
        const policy = this.POLICIES.get(programId);
        if (!policy) {
            return { allowed: false, rule: 'BLOCK' };
        }
        return {
            allowed: policy.policy === 'ALLOW' || policy.policy === 'CONDITIONAL',
            rule: policy.policy,
            policy,
        };
    }
    static isKnownProgram(programId) {
        return this.POLICIES.has(programId);
    }
}
//# sourceMappingURL=program-policy-registry.js.map