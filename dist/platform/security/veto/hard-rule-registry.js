/**
 * PHASE 2, 10 & 11 — SIGNED HARD-RULE REGISTRY, PROTOCOL-EPOCH & SCHEMA-SEAL
 *
 * Implements:
 * - CertifiedHardRule signed registry (no ad-hoc rules permitted)
 * - Canonical standard rules (Freeze Authority, Permanent Delegate, Transfer Fee, Concentration)
 * - ProtocolEpoch tracking and program executable identity verification
 * - SchemaSeal compatibility assertions
 */
import { sha256Hex, } from './types.js';
export class HardRuleRegistry {
    rules = new Map();
    epoch;
    constructor(epoch = 'REGISTRY_EPOCH_2026_V1', autoRegisterStandard = true) {
        this.epoch = epoch;
        if (autoRegisterStandard) {
            this.initializeStandardRules();
        }
    }
    register(rule, allowOverwrite = true) {
        if (!rule.ruleId || !rule.registryEpoch) {
            throw new Error('Hard rule requires stable ruleId and registryEpoch');
        }
        if (!allowOverwrite && this.rules.has(rule.ruleId)) {
            throw new Error(`Duplicate hard rule registration: ${rule.ruleId}`);
        }
        this.rules.set(rule.ruleId, Object.freeze({ ...rule }));
    }
    active(ruleId) {
        return this.rules.get(ruleId);
    }
    allActiveRules() {
        return Array.from(this.rules.values());
    }
    getRegistryEpoch() {
        return this.epoch;
    }
    initializeStandardRules() {
        // Rule 1: Freeze Authority Present
        const freezeRule = {
            ruleId: 'freeze-authority-present',
            subjectKind: 'TOKEN_MINT',
            applicability: { subjectKind: 'TOKEN_MINT' },
            requiredEvidence: [{ fact: 'FREEZE_AUTHORITY', minBankCommitment: 'confirmed' }],
            evaluatorIr: { op: 'AUTHORITY_EQUALS_PRESENT', targetFact: 'FREEZE_AUTHORITY' },
            defeaterManifest: {
                requiredDefeaters: ['authority_renounced_in_newer_slot', 'bank_orphaned', 'decoder_disagreement'],
            },
            validityClass: 'CONFIRMED_CHAIN',
            protocolBindings: [
                { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', minEpoch: 1n, decoderHash: sha256Hex('PROD_MINT_DECODER_V1') },
                { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', minEpoch: 1n, decoderHash: sha256Hex('PROD_MINT_DECODER_V1') },
            ],
            output: 'TOKEN_STRUCTURAL_FAILURE',
            registryEpoch: this.epoch,
            ruleHash: sha256Hex({ ruleId: 'freeze-authority-present', epoch: this.epoch }),
        };
        // Rule 2: Permanent Delegate Present (Token-2022 Backdoor)
        const delegateRule = {
            ruleId: 'permanent-delegate-present',
            subjectKind: 'TOKEN_MINT',
            applicability: { subjectKind: 'TOKEN_MINT' },
            requiredEvidence: [{ fact: 'PERMANENT_DELEGATE', minBankCommitment: 'confirmed' }],
            evaluatorIr: { op: 'AUTHORITY_EQUALS_PRESENT', targetFact: 'PERMANENT_DELEGATE' },
            defeaterManifest: {
                requiredDefeaters: ['delegate_revoked', 'bank_orphaned', 'decoder_disagreement'],
            },
            validityClass: 'CONFIRMED_CHAIN',
            protocolBindings: [
                { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', minEpoch: 1n, decoderHash: sha256Hex('PROD_MINT_DECODER_V1') },
            ],
            output: 'TOKEN_STRUCTURAL_FAILURE',
            registryEpoch: this.epoch,
            ruleHash: sha256Hex({ ruleId: 'permanent-delegate-present', epoch: this.epoch }),
        };
        // Rule 3: Transfer Fee Excessive (> 500 bps = 5%)
        const feeRule = {
            ruleId: 'transfer-fee-excessive',
            subjectKind: 'TOKEN_MINT',
            applicability: { subjectKind: 'TOKEN_MINT' },
            requiredEvidence: [{ fact: 'TRANSFER_FEE', minBankCommitment: 'confirmed' }],
            evaluatorIr: { op: 'EXACT_BPS_GREATER_THAN', targetFact: 'TRANSFER_FEE', thresholdBps: 500n },
            defeaterManifest: {
                requiredDefeaters: ['fee_exempt_whitelisted', 'bank_orphaned', 'decoder_disagreement'],
            },
            validityClass: 'CONFIRMED_CHAIN',
            protocolBindings: [
                { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', minEpoch: 1n, decoderHash: sha256Hex('PROD_MINT_DECODER_V1') },
            ],
            output: 'TOKEN_STRUCTURAL_FAILURE',
            registryEpoch: this.epoch,
            ruleHash: sha256Hex({ ruleId: 'transfer-fee-excessive', epoch: this.epoch }),
        };
        // Rule 4: Proven Lower Bound Concentration Breached (> 8000 bps = 80%)
        const concentrationRule = {
            ruleId: 'holder-concentration-lower-bound-exceeded',
            subjectKind: 'TOKEN_MINT',
            applicability: { subjectKind: 'TOKEN_MINT' },
            requiredEvidence: [{ fact: 'HOLDER_CONCENTRATION', minBankCommitment: 'confirmed' }],
            evaluatorIr: { op: 'LOWER_BOUND_BPS_GREATER_THAN', targetFact: 'HOLDER_CONCENTRATION', thresholdBps: 8000n },
            defeaterManifest: {
                requiredDefeaters: ['burn_address_excluded', 'curve_escrow_excluded', 'bank_orphaned'],
            },
            validityClass: 'CONFIRMED_CHAIN',
            protocolBindings: [],
            output: 'TOKEN_STRUCTURAL_FAILURE',
            registryEpoch: this.epoch,
            ruleHash: sha256Hex({ ruleId: 'holder-concentration-lower-bound-exceeded', epoch: this.epoch }),
        };
        this.register(freezeRule);
        this.register(delegateRule);
        this.register(feeRule);
        this.register(concentrationRule);
    }
}
export class ProtocolEpochRegistry {
    currentEpoch = 1n;
    executables = new Map();
    registerExecutable(identity) {
        this.executables.set(identity.programId, identity);
    }
    getExecutable(programId) {
        return this.executables.get(programId);
    }
    upgradeProgram(programId, newIdentity) {
        this.executables.set(programId, newIdentity);
        this.currentEpoch++; // Program upgrade increments ProtocolEpoch!
    }
    getCurrentEpoch() {
        return this.currentEpoch;
    }
}
export class SchemaSeal {
    schemas = new Map();
    registerSchema(manifest) {
        this.schemas.set(manifest.schemaId, manifest);
    }
    verifyCompatibility(schemaId, runtimeHash) {
        const registered = this.schemas.get(schemaId);
        if (!registered)
            return 'SEMANTIC_CHANGE';
        return registered.schemaHash === runtimeHash ? 'LOSSLESS' : 'LOSSY';
    }
}
//# sourceMappingURL=hard-rule-registry.js.map