/**
 * SYLPH FUSION — AUTHORITATIVE DECISION & PROVENANCE FACTORY
 * Specifications: Frozen Architecture Execution Prompt (Section 26, 27, 28)
 *
 * Invariant: Every authoritative decision binds:
 *   journalSeq, envelopeHash, stateRootBefore, stateRootAfter, featureRoot,
 *   decisionId, decisionHash, releaseRoot, controlRoot, reducerVersion, intelligenceVersion.
 *
 * No optional provenance. Sequence zero (0n) is explicitly valid.
 */
import { createHash } from 'node:crypto';
import { isIntelligenceInput } from './intelligence-input.js';
const DECISION_PROVENANCE_BRAND = Symbol('__decisionProvenanceBrand__');
const AUTHORITATIVE_DECISION_BRAND = Symbol('__authoritativeDecisionBrand__');
export const CURRENT_INTELLIGENCE_VERSION = 'sylph-intelligence/v3.0.0';
export function isDecisionProvenance(obj) {
    return (typeof obj === 'object' &&
        obj !== null &&
        obj[DECISION_PROVENANCE_BRAND] === true);
}
export function isAuthoritativeDecision(obj) {
    return (typeof obj === 'object' &&
        obj !== null &&
        obj[AUTHORITATIVE_DECISION_BRAND] === true);
}
export function computeDecisionHash(params) {
    const parts = [
        params.decisionId,
        params.decisionTimeMs.toString(),
        params.targetMint,
        params.action,
        params.journalSeq.toString(),
        params.envelopeHash,
        params.stateRootBefore,
        params.stateRootAfter,
        params.featureRoot,
        params.releaseRoot,
        params.controlRoot,
        params.reducerVersion,
        params.intelligenceVersion,
        params.evaluationJson,
    ].join(':');
    return createHash('sha256').update(parts).digest('hex');
}
export function createAuthoritativeDecision(params) {
    if (!params || typeof params !== 'object') {
        throw new Error('INVALID_PARAMS: Parameters must be a non-null object');
    }
    // 1. Validate IntelligenceInput
    if (!isIntelligenceInput(params.input)) {
        throw new Error('UNAUTHORIZED_INTELLIGENCE_INPUT: input lacks authoritative IntelligenceInput brand');
    }
    // 2. Validate Decision Identity & Target Mint
    if (!params.decisionId || typeof params.decisionId !== 'string') {
        throw new Error('INVALID_DECISION_ID: decisionId must be non-empty string');
    }
    if (!params.targetMint || typeof params.targetMint !== 'string') {
        throw new Error('INVALID_TARGET_MINT: targetMint must be non-empty string');
    }
    const validActions = ['BUY', 'SELL', 'HOLD', 'REJECT'];
    if (!validActions.includes(params.action)) {
        throw new Error(`INVALID_DECISION_ACTION: action must be one of ${validActions.join(', ')}`);
    }
    // 3. Validate Release and Control Roots
    if (typeof params.releaseRoot !== 'string' ||
        params.releaseRoot.length !== 64 ||
        !/^[0-9a-fA-F]{64}$/.test(params.releaseRoot)) {
        throw new Error('INVALID_RELEASE_ROOT: releaseRoot must be a 64-character hex string');
    }
    if (typeof params.controlRoot !== 'string' ||
        params.controlRoot.length !== 64 ||
        !/^[0-9a-fA-F]{64}$/.test(params.controlRoot)) {
        throw new Error('INVALID_CONTROL_ROOT: controlRoot must be a 64-character hex string');
    }
    const intelligenceVersion = params.intelligenceVersion ?? CURRENT_INTELLIGENCE_VERSION;
    const evaluation = Object.freeze({ ...(params.evaluation ?? {}) });
    const evaluationJson = JSON.stringify(evaluation);
    const proof = params.input.proof;
    const snapshot = params.input.snapshot;
    const decisionTimeMs = params.input.decisionTimeMs;
    // Invariant check: Sequence 0n is explicitly valid! Check typeof and >= 0n
    if (typeof proof.journalSeq !== 'bigint' || proof.journalSeq < 0n) {
        throw new Error('INVALID_JOURNAL_SEQUENCE: proof.journalSeq must be non-negative bigint');
    }
    // 4. Derive deterministic Decision Hash
    const decisionHash = computeDecisionHash({
        decisionId: params.decisionId,
        decisionTimeMs,
        targetMint: params.targetMint,
        action: params.action,
        journalSeq: proof.journalSeq,
        envelopeHash: proof.envelopeHash,
        stateRootBefore: proof.stateRootBefore,
        stateRootAfter: proof.stateRootAfter,
        featureRoot: snapshot.featureRoot,
        releaseRoot: params.releaseRoot.toLowerCase(),
        controlRoot: params.controlRoot.toLowerCase(),
        reducerVersion: proof.reducerVersion,
        intelligenceVersion,
        evaluationJson,
    });
    // 5. Construct Branded Provenance
    const provenanceObj = {
        [DECISION_PROVENANCE_BRAND]: true,
        journalSeq: proof.journalSeq,
        envelopeHash: proof.envelopeHash,
        stateRootBefore: proof.stateRootBefore,
        stateRootAfter: proof.stateRootAfter,
        featureRoot: snapshot.featureRoot,
        decisionId: params.decisionId,
        decisionHash,
        releaseRoot: params.releaseRoot.toLowerCase(),
        controlRoot: params.controlRoot.toLowerCase(),
        reducerVersion: proof.reducerVersion,
        intelligenceVersion,
    };
    const provenance = Object.freeze(provenanceObj);
    // 6. Construct Branded Authoritative Decision
    const decisionObj = {
        [AUTHORITATIVE_DECISION_BRAND]: true,
        decisionId: params.decisionId,
        decisionTimeMs,
        targetMint: params.targetMint,
        action: params.action,
        provenance,
        evaluation,
        decisionHash,
    };
    return Object.freeze(decisionObj);
}
//# sourceMappingURL=decision-provenance.js.map