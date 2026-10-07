/**
 * SYLPH FUSION — CANONICAL REDUCER & MUTATION EXCLUSIVITY
 * Specifications: Frozen Architecture Execution Step 2 (Sections 23, 24, 25)
 *
 * Guarantees:
 * 1. Only CanonicalReducer may produce the next authoritative FusionStateRootV2.
 * 2. Pure determinism:
 *    Same (state, committed envelope, reducer version) => byte-for-byte identical (nextState, stateRoot, transitionHash).
 *    Zero Date.now(), zero Math.random(), zero network, zero mutable caches, zero unbound environment.
 * 3. Real Immutability:
 *    Nested collections protected. No external .set(), .delete(), mutation, mutable alias, or writable backing reference may escape.
 *    Object.freeze(new Map()) is forbidden; maps and sets are rejected in favor of deeply frozen immutable records.
 * 4. Cryptographic StateTransitionProof binds:
 *    journalSeq, envelopeHash, stateRootBefore, stateRootAfter, reducerVersion, transitionHash.
 */
import { createHash } from 'node:crypto';
import { FSYNC_COMMITTED } from '../ingress/types.js';
import { computeStateRootV2, } from '../pipeline/state-root-v2.js';
import { isValidTransition, } from '../pipeline/pipeline-state.js';
export const CANONICAL_REDUCER_VERSION = 'canonical-reducer/v2.0.0';
// Module-private runtime brand symbols (strictly unexported to prevent caller forging)
const _runtimeStateRootBrand = Symbol('CanonicalFusionStateRootV2Brand');
const _runtimeProofBrand = Symbol('CanonicalStateTransitionProofBrand');
/**
 * Deep recursive freeze ensuring true structural immutability.
 * Forbids Map/Set instances because Object.freeze(new Map()) leaves .set() and .delete() mutable.
 */
export function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (obj instanceof Map) {
        throw new Error('MUTABLE_MAP_FORBIDDEN: Map instances are forbidden in authoritative state. Use deeply frozen immutable records.');
    }
    if (obj instanceof Set) {
        throw new Error('MUTABLE_SET_FORBIDDEN: Set instances are forbidden in authoritative state. Use deeply frozen immutable arrays.');
    }
    Object.freeze(obj);
    for (const key of Object.getOwnPropertyNames(obj)) {
        const val = obj[key];
        if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
            deepFreeze(val);
        }
    }
    for (const sym of Object.getOwnPropertySymbols(obj)) {
        const val = obj[sym];
        if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
            deepFreeze(val);
        }
    }
    return obj;
}
/**
 * Computes deterministic transition hash over the 5 core proof components.
 */
export function computeTransitionHash(journalSeq, envelopeHash, stateRootBefore, stateRootAfter, reducerVersion) {
    return createHash('sha256')
        .update([
        journalSeq.toString(),
        envelopeHash,
        stateRootBefore,
        stateRootAfter,
        reducerVersion,
    ].join('\x1f'))
        .digest('hex');
}
/**
 * Validates evidence prerequisites for target state transitions.
 */
export function validateStateEvidencePrerequisites(targetState, fields) {
    const isZero = (s) => !s || s.trim() === '' || /^0+$/.test(s);
    switch (targetState) {
        case 'EVIDENCE_CERTIFIED':
            if (isZero(fields.coverageCertificateRoot)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to EVIDENCE_CERTIFIED without coverageCertificateRoot');
            }
            if (isZero(fields.evidenceRoot)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to EVIDENCE_CERTIFIED without evidenceRoot');
            }
            break;
        case 'TEMPORALLY_VALID':
            if (!fields.observedSlot || fields.observedSlot <= 0n) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to TEMPORALLY_VALID without observedSlot > 0');
            }
            if (isZero(fields.bankFingerprint)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to TEMPORALLY_VALID without bankFingerprint');
            }
            break;
        case 'SEMANTICALLY_RESOLVED':
            if (isZero(fields.semanticStateRoot)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to SEMANTICALLY_RESOLVED without semanticStateRoot');
            }
            break;
        case 'AUTHENTICATED_MARKET':
            if (isZero(fields.authenticityRoot)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to AUTHENTICATED_MARKET without authenticityRoot');
            }
            break;
        case 'FEATURED':
            if (isZero(fields.featureSnapshotRoot)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to FEATURED without featureSnapshotRoot');
            }
            break;
        case 'HYPOTHESIS_READY':
            if (isZero(fields.hypothesisRoot)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to HYPOTHESIS_READY without hypothesisRoot');
            }
            break;
        case 'RISK_APPROVED':
            if (isZero(fields.portfolioRiskRoot)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to RISK_APPROVED without portfolioRiskRoot');
            }
            break;
        case 'RESOURCE_ADMITTED':
            if (isZero(fields.safetyCapacityRoot)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to RESOURCE_ADMITTED without safetyCapacityRoot');
            }
            if (isZero(fields.resourceReservationId)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to RESOURCE_ADMITTED without resourceReservationId');
            }
            break;
        case 'CAPITAL_RESERVED':
            if (isZero(fields.capitalStateRoot)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to CAPITAL_RESERVED without capitalStateRoot');
            }
            if (isZero(fields.capitalReservationId)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to CAPITAL_RESERVED without capitalReservationId');
            }
            break;
        case 'AUTHORIZED':
            if (isZero(fields.executionPermitId)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to AUTHORIZED without executionPermitId');
            }
            break;
        case 'TRANSACTION_VERIFIED':
            if (isZero(fields.effectSpecHash)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to TRANSACTION_VERIFIED without effectSpecHash');
            }
            if (isZero(fields.messageHash)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to TRANSACTION_VERIFIED without messageHash');
            }
            break;
        case 'SIGNED':
            if (isZero(fields.transactionSignature)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to SIGNED without transactionSignature');
            }
            break;
        case 'ECONOMIC_RECONCILED':
            if (isZero(fields.economicOutcomeRoot)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to ECONOMIC_RECONCILED without economicOutcomeRoot');
            }
            break;
        case 'SETTLED':
            if (isZero(fields.terminalityCertificateRoot) || isZero(fields.economicOutcomeRoot)) {
                throw new Error('EVIDENCE_DEFICIT: Cannot advance to SETTLED without terminalityCertificateRoot and economicOutcomeRoot');
            }
            break;
        default:
            break;
    }
}
export const GENESIS_STATE_ROOT_FIELDS_V2 = deepFreeze({
    economicFactId: 'fact_genesis_0000',
    traceId: 'trace_genesis_0000',
    state: 'OBSERVED',
    revision: 0n,
    cluster: 'mainnet-beta',
    observedSlot: 0n,
    bankFingerprint: '0000000000000000000000000000000000000000000000000000000000000000',
    blockhash: '11111111111111111111111111111111',
    lastValidBlockHeight: 0n,
    evidenceRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    coverageCertificateRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    sourceIndependenceRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    semanticStateRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    tokenSemanticsRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    programEpochRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    accountResolutionRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    marketStateRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    authenticityRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    actorGraphRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    featureSnapshotRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    hypothesisRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    alphaRealityRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    portfolioRiskRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    exitabilityRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    systemicRiskRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    survivalRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    evacuationRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    safetyCapacityRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    resourceReservationId: '0000000000000000000000000000000000000000000000000000000000000000',
    capitalStateRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    capitalReservationId: '0000000000000000000000000000000000000000000000000000000000000000',
    authorityEpoch: 0,
    fenceEpoch: 0,
    revocationEpoch: 0,
    executionGenerationId: '0000000000000000000000000000000000000000000000000000000000000000',
    executionPermitId: '0000000000000000000000000000000000000000000000000000000000000000',
    effectSpecHash: '0000000000000000000000000000000000000000000000000000000000000000',
    messageHash: '0000000000000000000000000000000000000000000000000000000000000000',
    transactionSignature: '0000000000000000000000000000000000000000000000000000000000000000',
    transportAttemptRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    chainOutcomeRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    terminalityCertificateRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    economicOutcomeRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    configRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    policyRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    releaseRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    proofGraphRoot: '0000000000000000000000000000000000000000000000000000000000000000',
});
/**
 * The Canonical Reducer is the ONLY writer and producer of authoritative FusionStateRootV2.
 * Enforces pure determinism, strict state-machine valid transitions, and complete cryptographic binding.
 */
export class CanonicalReducer {
    static VERSION = CANONICAL_REDUCER_VERSION;
    /**
     * Internal brand verification for FusionStateRootV2.
     */
    static isStateRootV2(candidate) {
        if (!candidate || typeof candidate !== 'object')
            return false;
        return candidate[_runtimeStateRootBrand] === true;
    }
    /**
     * Internal brand verification for StateTransitionProof.
     */
    static isStateTransitionProof(candidate) {
        if (!candidate || typeof candidate !== 'object')
            return false;
        return candidate[_runtimeProofBrand] === true;
    }
    /**
     * Creates the authoritative genesis state.
     */
    static createGenesisState(initialOverrides = {}) {
        const fields = {
            ...GENESIS_STATE_ROOT_FIELDS_V2,
            ...initialOverrides,
            revision: 0n,
            state: initialOverrides.state ?? 'OBSERVED',
        };
        const stateRoot = computeStateRootV2(fields);
        const stateObj = {
            ...fields,
            stateRoot,
            [_runtimeStateRootBrand]: true,
        };
        return deepFreeze(stateObj);
    }
    /**
     * Pure deterministic state transition reduction.
     *
     * Target signature:
     * CanonicalReducer.reduce(
     *   current: FusionStateRootV2,
     *   envelope: CommittedEnvelope
     * ): ReductionResult
     */
    static reduce(current, envelope) {
        // 1. Verify current state authority brand and integrity
        if (!CanonicalReducer.isStateRootV2(current)) {
            throw new Error('REDUCER_UNAUTHORIZED_STATE: Current state lacks authoritative FusionStateRootV2 brand');
        }
        const expectedCurrentRoot = computeStateRootV2(current);
        if (current.stateRoot !== expectedCurrentRoot) {
            throw new Error(`REDUCER_CORRUPT_STATE_ROOT: Stored root ${current.stateRoot} !== calculated ${expectedCurrentRoot}`);
        }
        // 2. Verify committed envelope authority and durability barrier
        if (!envelope || typeof envelope !== 'object') {
            throw new Error('REDUCER_INVALID_ENVELOPE: Envelope must be a non-null object');
        }
        if (envelope.durability !== FSYNC_COMMITTED) {
            throw new Error(`DURABILITY_BARRIER_VIOLATION: Durability must be FSYNC_COMMITTED, received ${envelope.durability}`);
        }
        if (typeof envelope.journalSeq !== 'bigint' || envelope.journalSeq <= 0n) {
            throw new Error(`INVALID_JOURNAL_SEQUENCE: Journal sequence must be a positive bigint, received ${envelope.journalSeq}`);
        }
        // Monotonicity check: Sequence must not regress
        if (current.revision > 0n && envelope.journalSeq < current.revision + 1n) {
            throw new Error(`STALE_JOURNAL_SEQUENCE: Received journal sequence ${envelope.journalSeq} but current state revision is ${current.revision}`);
        }
        if (!envelope.envelopeHash || !/^[0-9a-f]{64}$/.test(envelope.envelopeHash)) {
            throw new Error(`REDUCER_INVALID_ENVELOPE_HASH: Invalid envelope hash ${envelope.envelopeHash}`);
        }
        // 3. Extract deterministic inputs from committed envelope
        const val = envelope.validatedEnvelope;
        if (!val || !val.compiledEnvelope || !val.compiledEnvelope.observation) {
            throw new Error('REDUCER_INVALID_ENVELOPE: Envelope missing validated compiled observation');
        }
        const obs = val.compiledEnvelope.observation;
        // Deterministically inspect payload for transition directives
        let payloadDirective = null;
        if (obs.rawPayload && obs.rawPayload.length > 0) {
            try {
                const text = Buffer.from(obs.rawPayload).toString('utf8');
                if (text.startsWith('{') && text.endsWith('}')) {
                    payloadDirective = JSON.parse(text);
                }
            }
            catch {
                // Raw byte payload, not a JSON directive
            }
        }
        // 4. Resolve next target state
        let targetState = current.state;
        if (payloadDirective && typeof payloadDirective.targetState === 'string') {
            targetState = payloadDirective.targetState;
        }
        else if (obs.processingIntent && obs.processingIntent in isValidTransition) {
            targetState = obs.processingIntent;
        }
        // Verify legal state transition
        if (targetState !== current.state) {
            if (!isValidTransition(current.state, targetState)) {
                throw new Error(`ILLEGAL_STATE_TRANSITION: Cannot transition from ${current.state} to ${targetState}`);
            }
        }
        // 5. Assemble candidate next fields (pure deterministic transformation)
        const nextRevision = current.revision + 1n;
        const isSafeSlot = (s) => {
            if (typeof s === 'bigint')
                return s >= 0n;
            if (typeof s === 'number')
                return Number.isSafeInteger(s) && s >= 0;
            return false;
        };
        if (obs.slot !== null && obs.slot !== undefined && !isSafeSlot(obs.slot)) {
            throw new Error('COMMITTED_OBSERVATION_SLOT_INVALID');
        }
        const nextSlot = obs.slot !== null && obs.slot !== undefined && BigInt(obs.slot) > 0n
            ? BigInt(obs.slot)
            : current.observedSlot;
        const nextFields = {
            economicFactId: payloadDirective?.economicFactId || obs.observationId || current.economicFactId,
            traceId: payloadDirective?.traceId || (obs.signature ? `trace_${obs.signature.slice(0, 16)}` : current.traceId),
            state: targetState,
            revision: nextRevision,
            cluster: payloadDirective?.cluster || current.cluster,
            observedSlot: nextSlot,
            bankFingerprint: payloadDirective?.bankFingerprint || current.bankFingerprint,
            blockhash: payloadDirective?.blockhash || current.blockhash,
            lastValidBlockHeight: typeof payloadDirective?.lastValidBlockHeight === 'string'
                ? BigInt(payloadDirective.lastValidBlockHeight)
                : (typeof payloadDirective?.lastValidBlockHeight === 'bigint' ? payloadDirective.lastValidBlockHeight : current.lastValidBlockHeight),
            evidenceRoot: payloadDirective?.evidenceRoot || envelope.envelopeHash,
            coverageCertificateRoot: payloadDirective?.coverageCertificateRoot || current.coverageCertificateRoot,
            sourceIndependenceRoot: payloadDirective?.sourceIndependenceRoot || current.sourceIndependenceRoot,
            semanticStateRoot: payloadDirective?.semanticStateRoot || current.semanticStateRoot,
            tokenSemanticsRoot: payloadDirective?.tokenSemanticsRoot || current.tokenSemanticsRoot,
            programEpochRoot: payloadDirective?.programEpochRoot || current.programEpochRoot,
            accountResolutionRoot: payloadDirective?.accountResolutionRoot || current.accountResolutionRoot,
            marketStateRoot: payloadDirective?.marketStateRoot || current.marketStateRoot,
            authenticityRoot: payloadDirective?.authenticityRoot || current.authenticityRoot,
            actorGraphRoot: payloadDirective?.actorGraphRoot || current.actorGraphRoot,
            featureSnapshotRoot: payloadDirective?.featureSnapshotRoot || current.featureSnapshotRoot,
            hypothesisRoot: payloadDirective?.hypothesisRoot || current.hypothesisRoot,
            alphaRealityRoot: payloadDirective?.alphaRealityRoot || current.alphaRealityRoot,
            portfolioRiskRoot: payloadDirective?.portfolioRiskRoot || current.portfolioRiskRoot,
            exitabilityRoot: payloadDirective?.exitabilityRoot || current.exitabilityRoot,
            systemicRiskRoot: payloadDirective?.systemicRiskRoot || current.systemicRiskRoot,
            survivalRoot: payloadDirective?.survivalRoot || current.survivalRoot,
            evacuationRoot: payloadDirective?.evacuationRoot || current.evacuationRoot,
            safetyCapacityRoot: payloadDirective?.safetyCapacityRoot || current.safetyCapacityRoot,
            resourceReservationId: payloadDirective?.resourceReservationId || current.resourceReservationId,
            capitalStateRoot: payloadDirective?.capitalStateRoot || current.capitalStateRoot,
            capitalReservationId: payloadDirective?.capitalReservationId || current.capitalReservationId,
            authorityEpoch: typeof payloadDirective?.authorityEpoch === 'number' ? payloadDirective.authorityEpoch : current.authorityEpoch,
            fenceEpoch: typeof payloadDirective?.fenceEpoch === 'number' ? payloadDirective.fenceEpoch : current.fenceEpoch,
            revocationEpoch: typeof payloadDirective?.revocationEpoch === 'number' ? payloadDirective.revocationEpoch : current.revocationEpoch,
            executionGenerationId: payloadDirective?.executionGenerationId || current.executionGenerationId,
            executionPermitId: payloadDirective?.executionPermitId || current.executionPermitId,
            effectSpecHash: payloadDirective?.effectSpecHash || current.effectSpecHash,
            messageHash: payloadDirective?.messageHash || current.messageHash,
            transactionSignature: obs.signature || payloadDirective?.transactionSignature || current.transactionSignature,
            transportAttemptRoot: payloadDirective?.transportAttemptRoot || current.transportAttemptRoot,
            chainOutcomeRoot: payloadDirective?.chainOutcomeRoot || current.chainOutcomeRoot,
            terminalityCertificateRoot: payloadDirective?.terminalityCertificateRoot || current.terminalityCertificateRoot,
            economicOutcomeRoot: payloadDirective?.economicOutcomeRoot || current.economicOutcomeRoot,
            configRoot: payloadDirective?.configRoot || current.configRoot,
            policyRoot: payloadDirective?.policyRoot || current.policyRoot,
            releaseRoot: payloadDirective?.releaseRoot || current.releaseRoot,
            proofGraphRoot: payloadDirective?.proofGraphRoot || current.proofGraphRoot,
        };
        // 6. Validate evidence prerequisites for target state
        validateStateEvidencePrerequisites(targetState, nextFields);
        // 7. Compute deterministic next state root
        const nextStateRoot = computeStateRootV2(nextFields);
        // 8. Compute deterministic transition hash
        const transitionHash = computeTransitionHash(envelope.journalSeq, envelope.envelopeHash, current.stateRoot, nextStateRoot, CANONICAL_REDUCER_VERSION);
        // 9. Build deeply frozen StateTransitionProof
        const proofObj = {
            journalSeq: envelope.journalSeq,
            envelopeHash: envelope.envelopeHash,
            stateRootBefore: current.stateRoot,
            stateRootAfter: nextStateRoot,
            reducerVersion: CANONICAL_REDUCER_VERSION,
            transitionHash,
            [_runtimeProofBrand]: true,
        };
        const proof = deepFreeze(proofObj);
        // 10. Build deeply frozen FusionStateRootV2
        const nextStateObj = {
            ...nextFields,
            stateRoot: nextStateRoot,
            [_runtimeStateRootBrand]: true,
        };
        const nextState = deepFreeze(nextStateObj);
        return {
            nextState,
            proof,
        };
    }
    reduce(current, envelope) {
        return CanonicalReducer.reduce(current, envelope);
    }
}
//# sourceMappingURL=canonical-reducer.js.map