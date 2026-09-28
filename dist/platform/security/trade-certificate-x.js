/**
 * Research-only Section 47 certificate consistency checks.
 * Hashes detect mutation; they do not establish provenance, quorum, parser
 * certification, lease ownership, chain truth, or signer authority. No signing
 * implementation is present here. The legacy authorization entry point denies.
 */
import { createHash } from 'node:crypto';
import { types } from 'node:util';
const hashPattern = /^[a-f0-9]{64}$/;
const textValue = (v) => typeof v === 'string' && v.trim().length > 0;
const hashValue = (v) => typeof v === 'string' && hashPattern.test(v);
const integer = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const finite = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const probability = (v) => finite(v) && v <= 1;
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function requireValue(condition, reason) {
    if (!condition)
        throw new Error(reason);
}
/** Inspect descriptors without invoking caller code; proxies are rejected first. */
function plainDescriptors(value) {
    requireValue(record(value) && !types.isProxy(value), 'UNSAFE_OBJECT');
    const prototype = Object.getPrototypeOf(value);
    requireValue(prototype === Object.prototype || prototype === null, 'UNSAFE_OBJECT_PROTOTYPE');
    requireValue(Object.getOwnPropertySymbols(value).length === 0, 'SYMBOL_PROPERTIES_UNSUPPORTED');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
        requireValue(Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true, 'ACCESSOR_OR_HIDDEN_PROPERTY');
    }
    return descriptors;
}
/** Copy plain data once so hashing and validation observe the same values. */
function snapshotData(value, ancestors = new Set(), depth = 0) {
    requireValue(depth <= 64, 'SNAPSHOT_DEPTH_EXCEEDED');
    if (value === null || ['undefined', 'boolean', 'string', 'number', 'bigint'].includes(typeof value))
        return value;
    requireValue(typeof value === 'object' && !types.isProxy(value), 'UNSAFE_OBJECT');
    requireValue(!ancestors.has(value), 'CYCLIC_CERTIFICATE');
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            requireValue(Object.getPrototypeOf(value) === Array.prototype && Object.getOwnPropertySymbols(value).length === 0, 'UNSAFE_ARRAY');
            const descriptors = Object.getOwnPropertyDescriptors(value);
            requireValue(Object.keys(descriptors).length === value.length + 1, 'SPARSE_OR_EXTENDED_ARRAY');
            const copy = [];
            for (let i = 0; i < value.length; i++) {
                const descriptor = descriptors[String(i)];
                requireValue(!!descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true, 'ACCESSOR_OR_HIDDEN_PROPERTY');
                copy.push(snapshotData(descriptor.value, ancestors, depth + 1));
            }
            return Object.freeze(copy);
        }
        const descriptors = plainDescriptors(value);
        const copy = Object.create(null);
        for (const [key, descriptor] of Object.entries(descriptors))
            copy[key] = snapshotData(descriptor.value, ancestors, depth + 1);
        return Object.freeze(copy);
    }
    finally {
        ancestors.delete(value);
    }
}
function snapshotInput(input) {
    const descriptors = plainDescriptors(input);
    const { programFirewall, frozenMessageBytes, ...data } = descriptors;
    requireValue(!!programFirewall && !!frozenMessageBytes, 'INVALID_INSPECTION_CONTEXT');
    const registry = programFirewall.value;
    requireValue(registry !== null && typeof registry === 'object' && !types.isProxy(registry) && Object.getPrototypeOf(registry) === ProgramIdentityFirewallX.prototype && Reflect.ownKeys(registry).length === 0, 'UNSAFE_PROGRAM_REGISTRY');
    const bytes = frozenMessageBytes.value;
    requireValue(types.isUint8Array(bytes) && !types.isProxy(bytes) && (Object.getPrototypeOf(bytes) === Uint8Array.prototype || Object.getPrototypeOf(bytes) === Buffer.prototype), 'INVALID_MESSAGE');
    const byteDescriptors = Object.getOwnPropertyDescriptors(bytes);
    requireValue(Object.getOwnPropertySymbols(bytes).length === 0 && Object.entries(byteDescriptors).every(([key, d]) => /^(0|[1-9][0-9]*)$/.test(key) && Object.hasOwn(d, 'value')), 'UNSAFE_MESSAGE_PROPERTIES');
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    const buffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get.call(bytes);
    const length = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength').get.call(bytes);
    requireValue(!types.isSharedArrayBuffer(buffer) && length > 0, 'UNSAFE_MESSAGE_BUFFER');
    const frozenBytes = new Uint8Array(length);
    Uint8Array.prototype.set.call(frozenBytes, bytes);
    const values = Object.create(null);
    for (const [key, descriptor] of Object.entries(data))
        values[key] = descriptor.value;
    return Object.freeze({ ...snapshotData(values), frozenMessageBytes: frozenBytes, programFirewall: registry });
}
function canonical(value) {
    if (typeof value === 'bigint')
        return `{"$bigint":"${value.toString()}"}`;
    if (value === null || typeof value === 'boolean' || typeof value === 'string')
        return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value))
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (record(value))
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    throw new Error('INVALID_HASH_PAYLOAD');
}
function digest(domain, payload) {
    return createHash('sha256').update(`${domain}\n${canonical(payload)}`).digest('hex');
}
function capabilityPayload(e) {
    return { mint: e.mint, epochIndex: e.epochIndex, isFreezeAuthorityRevoked: e.isFreezeAuthorityRevoked,
        isMintAuthorityRevoked: e.isMintAuthorityRevoked, isPermanentDelegateRevoked: e.isPermanentDelegateRevoked,
        transferFeeBps: e.transferFeeBps, isPaused: e.isPaused };
}
export class TokenCapabilityFirewallX {
    /** Describes supplied properties; this cannot attest to on-chain state. */
    static certifyCapabilityEpoch(mint, epochIndex, properties) {
        properties = snapshotData(properties);
        requireValue(textValue(mint) && integer(epochIndex) && record(properties), 'INVALID_CAPABILITY_INPUT');
        for (const key of ['freezeAuthority', 'mintAuthority', 'permanentDelegate']) {
            requireValue(Object.hasOwn(properties, key) && (properties[key] === null || textValue(properties[key])), 'AUTHORITY_EVIDENCE_MISSING');
        }
        requireValue(integer(properties.transferFeeBps) && properties.transferFeeBps <= 10_000 && typeof properties.isPaused === 'boolean', 'CAPABILITY_EVIDENCE_MISSING');
        const payload = { mint, epochIndex, isFreezeAuthorityRevoked: properties.freezeAuthority === null,
            isMintAuthorityRevoked: properties.mintAuthority === null, isPermanentDelegateRevoked: properties.permanentDelegate === null,
            transferFeeBps: properties.transferFeeBps, isPaused: properties.isPaused };
        return Object.freeze({ ...payload, hash: digest('sylph/capability/v1', payload) });
    }
    /** Conservative ratio estimate for research; not a verified executable exit. */
    static generateExitabilityProof(mint, poolLiquidityDepthSol, positionSizeSol) {
        requireValue(textValue(mint) && finite(poolLiquidityDepthSol) && poolLiquidityDepthSol > 0 && finite(positionSizeSol) && positionSizeSol > 0, 'INVALID_EXIT_INPUT');
        const maxExitImpactBps = Math.ceil((positionSizeSol / poolLiquidityDepthSol) * 10_000);
        requireValue(integer(maxExitImpactBps), 'INVALID_EXIT_IMPACT');
        const payload = { mint, poolLiquidityDepthSol, positionSizeSol, maxExitImpactBps,
            isExitable: poolLiquidityDepthSol >= 5 && maxExitImpactBps <= 500 };
        const hash = digest('sylph/exit-estimate/v1', payload);
        return Object.freeze({ ...payload, hash, proofId: `exit_proof_${hash}` });
    }
}
function validProgram(p) {
    return record(p) && textValue(p.programId) && hashValue(p.executableHash) && integer(p.codeEpoch) && typeof p.isCertified === 'boolean';
}
/** Local research registry. Registration is not external program certification. */
export class ProgramIdentityFirewallX {
    #certifiedPrograms = new Map();
    certifyProgram(record) {
        record = snapshotData(record);
        requireValue(validProgram(record), 'INVALID_PROGRAM_RECORD');
        const old = this.#certifiedPrograms.get(record.programId);
        requireValue(!old || record.codeEpoch >= old.codeEpoch, 'PROGRAM_EPOCH_ROLLBACK');
        requireValue(!old || record.codeEpoch !== old.codeEpoch || record.executableHash === old.executableHash, 'PROGRAM_EPOCH_HASH_CONFLICT');
        requireValue(!old || record.codeEpoch !== old.codeEpoch || old.isCertified || !record.isCertified, 'PROGRAM_EPOCH_REVOKED');
        this.#certifiedPrograms.set(record.programId, Object.freeze({ ...record }));
    }
    isProgramEpochCertified(programId, executableHash, codeEpoch) {
        const p = this.#certifiedPrograms.get(programId);
        return !!p && p.isCertified === true && p.executableHash === executableHash && p.codeEpoch === codeEpoch;
    }
}
export class AstraSigningFirewallX {
    /** Binds every supplied field; a self-consistent digest is not a signature. */
    static hashCertificate(certificate) {
        const { certificate_hash: _ignored, ...payload } = snapshotData(certificate);
        return digest('sylph/research-trade-certificate/v1', payload);
    }
    static inspectCertificate(input) {
        try {
            input = snapshotInput(input);
            requireValue(record(input) && record(input.certificate), 'INVALID_CERTIFICATE');
            const c = input.certificate;
            requireValue(input.frozenMessageBytes instanceof Uint8Array && input.frozenMessageBytes.byteLength > 0, 'INVALID_MESSAGE');
            requireValue(integer(input.currentSlot) && integer(input.currentTimeMs) && integer(input.expectedCapabilityEpoch) && integer(input.expectedExecutionGeneration), 'INVALID_INSPECTION_CONTEXT');
            requireValue([c.snapshot_hash, c.quote_hash, c.intent_hash, c.message_hash, c.certificate_hash, input.messageHash].every(hashValue), 'INVALID_HASH');
            const messageHash = createHash('sha256').update(input.frozenMessageBytes).digest('hex');
            requireValue(messageHash === input.messageHash && messageHash === c.message_hash, 'MESSAGE_HASH_MISMATCH');
            requireValue(c.certificate_hash === AstraSigningFirewallX.hashCertificate(c), 'CERTIFICATE_HASH_MISMATCH');
            requireValue([c.fork_lineage, c.opportunity_certificate, c.simulation_certificate, c.capital_lease, c.risk_reservation, c.account_lease].every(textValue), 'MISSING_EVIDENCE_OR_RESERVATION');
            requireValue(integer(c.root_watermark) && c.root_watermark <= input.currentSlot && integer(c.expires_at_slot) && c.expires_at_slot > input.currentSlot, 'TRANSACTION_EXPIRED_OR_INVALID_SLOT');
            requireValue(integer(c.alpha_expiry) && integer(c.execution_deadline) && input.currentTimeMs < c.execution_deadline && c.execution_deadline <= c.alpha_expiry, 'INVALID_OR_EXPIRED_DEADLINE');
            requireValue(c.parser_certification === true && c.evidence_quorum === true, 'PARSER_OR_QUORUM_CLAIM_MISSING');
            requireValue(integer(c.execution_generation) && c.execution_generation === input.expectedExecutionGeneration, 'EXECUTION_GENERATION_MISMATCH');
            requireValue(finite(c.settlement_reserve) && c.settlement_reserve > 0, 'INVALID_SETTLEMENT_RESERVE');
            requireValue(record(c.resource_envelope) && integer(c.resource_envelope.compute_limit) && c.resource_envelope.compute_limit > 0 && c.resource_envelope.compute_limit <= 1_400_000 && typeof c.resource_envelope.priority_fee_micro_lamports === 'bigint' && c.resource_envelope.priority_fee_micro_lamports >= 0n && c.resource_envelope.priority_fee_micro_lamports <= 18446744073709551615n, 'INVALID_RESOURCE_ENVELOPE');
            requireValue(record(c.multiplier_distribution) && record(c.competing_risk_distribution), 'INVALID_RISK_DISTRIBUTION');
            const probabilities = ['p2x', 'p5x', 'p10x', 'p20x', 'p50x', 'p100x'].map(key => c.multiplier_distribution[key]);
            requireValue(probabilities.every(probability) && probabilities.every((v, i) => i === 0 || v <= probabilities[i - 1]) && probability(c.competing_risk_distribution.dev_dump_hazard) && probability(c.competing_risk_distribution.rug_hazard), 'INVALID_RISK_DISTRIBUTION');
            const e = c.capability_epoch;
            requireValue(record(e) && textValue(e.mint) && integer(e.epochIndex) && e.epochIndex === input.expectedCapabilityEpoch && integer(e.transferFeeBps) && e.transferFeeBps <= 10_000 && typeof e.isPaused === 'boolean' && [e.isFreezeAuthorityRevoked, e.isMintAuthorityRevoked, e.isPermanentDelegateRevoked].every(v => typeof v === 'boolean') && hashValue(e.hash), 'INVALID_CAPABILITY_EPOCH');
            requireValue(e.hash === digest('sylph/capability/v1', capabilityPayload(e)), 'CAPABILITY_HASH_MISMATCH');
            requireValue(!e.isPaused && e.isFreezeAuthorityRevoked && e.isMintAuthorityRevoked && e.isPermanentDelegateRevoked && e.transferFeeBps === 0, 'UNSAFE_OR_UNSUPPORTED_CAPABILITY');
            requireValue(Array.isArray(c.program_epochs) && c.program_epochs.length > 0 && input.programFirewall instanceof ProgramIdentityFirewallX, 'PROGRAM_EPOCHS_MISSING');
            const programs = new Set();
            for (const p of c.program_epochs) {
                requireValue(validProgram(p) && p.isCertified === true && !programs.has(p.programId) && ProgramIdentityFirewallX.prototype.isProgramEpochCertified.call(input.programFirewall, p.programId, p.executableHash, p.codeEpoch), 'PROGRAM_EPOCH_UNCERTIFIED');
                programs.add(p.programId);
            }
            const proof = c.exitability_proof;
            requireValue(record(proof) && proof.mint === e.mint, 'EXIT_MINT_MISMATCH');
            const expected = TokenCapabilityFirewallX.generateExitabilityProof(proof.mint, proof.poolLiquidityDepthSol, proof.positionSizeSol);
            requireValue(hashValue(proof.hash) && proof.hash === expected.hash && proof.proofId === expected.proofId && proof.isExitable === expected.isExitable && proof.maxExitImpactBps === expected.maxExitImpactBps && proof.isExitable === true, 'INVALID_EXIT_PROOF');
            return { isStructurallyValid: true, isAuthorized: false };
        }
        catch (error) {
            return { isStructurallyValid: false, isAuthorized: false, rejectionReason: error instanceof Error ? error.message : 'INVALID_CERTIFICATE' };
        }
    }
    /** Compatibility deny gate. No bytes are signed and no authority is granted. */
    static authorizeAndSign(input) {
        const result = this.inspectCertificate(input);
        return { isAuthorized: false, rejectionReason: result.rejectionReason ?? 'LIVE_SIGNING_UNAVAILABLE: Trusted evidence, lease ownership, intent/message semantics and signer integration are not implemented.' };
    }
}
// Exported static helpers and registry methods are part of the verification
// boundary. Prevent same-realm monkey-patching from changing their semantics.
Object.freeze(TokenCapabilityFirewallX.prototype);
Object.freeze(TokenCapabilityFirewallX);
Object.freeze(ProgramIdentityFirewallX.prototype);
Object.freeze(ProgramIdentityFirewallX);
Object.freeze(AstraSigningFirewallX.prototype);
Object.freeze(AstraSigningFirewallX);
//# sourceMappingURL=trade-certificate-x.js.map