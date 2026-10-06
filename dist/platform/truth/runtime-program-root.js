/**
 * SOL-SYLPH Platform - Runtime Root & Program Root Certification
 * Specifications: Master Blueprint Sections 35 & 36 (Priority Item 5).
 *
 * Implements:
 * 1. RuntimeRoot: Canonical environment fingerprint binding cluster genesis, epoch, Agave runtime version,
 *    and feature activation set.
 * 2. ProgramRoot: Cryptographic binding for on-chain programs, binding programdata account, executable hash,
 *    upgrade authority, immutability status, and transitive CPI program roots.
 * 3. Invalidation: Automatically detects when a program deployment or runtime epoch upgrade invalidates cached evidence.
 */
import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
const MAX_RUNTIME_TEXT_CHARS = 4096;
const MAX_RUNTIME_FEATURES = 4096;
const MAX_RUNTIME_FEATURE_CHARS = 1024;
const RESOURCE_POLICY_VERSION = 'res_pol_2026_q4';
const RUNTIME_REQUIRED_KEYS = ['cluster', 'genesisHash', 'epoch', 'contextSlot', 'agaveVersion', 'activeFeatureSetHash', 'transactionVersionSupported', 'resourcePolicyVersion', 'runtimeRootHash'];
const PROGRAM_REQUIRED_KEYS = ['programId', 'deploymentSlot', 'executableBytecodeHash', 'isImmutable', 'transitiveCpiProgramRoots', 'programRootHash'];
const PROGRAM_OPTIONAL_KEYS = ['programDataAddress', 'upgradeAuthority'];
const MAX_PROGRAM_ROOTS = 512;
const MAX_PROGRAM_DEPTH = 32;
function dataRecord(value, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value))
        return undefined;
    try {
        if (Object.getPrototypeOf(value) !== Object.prototype)
            return undefined;
        const keys = Reflect.ownKeys(value);
        if (keys.some(key => typeof key !== 'string' || (!required.includes(key) && !optional.includes(key))) ||
            required.some(key => !Object.prototype.hasOwnProperty.call(value, key)))
            return undefined;
        const result = Object.create(null);
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
                return undefined;
            result[key] = descriptor.value;
        }
        return result;
    }
    catch {
        return undefined;
    }
}
function runtimeHash(root, version) {
    const fields = {
        cluster: root.cluster, genesisHash: root.genesisHash, epoch: root.epoch, contextSlot: root.contextSlot,
        agaveVersion: root.agaveVersion, activeFeatureSetHash: root.activeFeatureSetHash,
    };
    const preimage = version === 1
        ? { ...fields, resourcePolicyVersion: root.resourcePolicyVersion }
        : { runtimeRootHashSchemaVersion: 2, ...fields, transactionVersionSupported: root.transactionVersionSupported, resourcePolicyVersion: root.resourcePolicyVersion };
    return createHash('sha256').update(JSON.stringify(preimage)).digest('hex');
}
function programHash(root, childHashes) {
    return createHash('sha256').update(JSON.stringify({
        programId: root.programId, programDataAddress: root.programDataAddress, deploymentSlot: root.deploymentSlot,
        executableBytecodeHash: root.executableBytecodeHash, upgradeAuthority: root.upgradeAuthority ?? 'NONE',
        isImmutable: root.isImmutable, cpiHashes: childHashes,
    })).digest('hex');
}
/** Pure validation of the exact legacy-v1 or schema-v2 RuntimeRoot commitment. */
export function verifyRuntimeRootIntegrity(value) {
    const root = dataRecord(value, RUNTIME_REQUIRED_KEYS, ['runtimeRootHashSchemaVersion']);
    if (!root)
        return false;
    const version = Object.prototype.hasOwnProperty.call(root, 'runtimeRootHashSchemaVersion') ? root.runtimeRootHashSchemaVersion : 1;
    if ((version !== 1 && version !== 2) || typeof root.cluster !== 'string' ||
        !['mainnet-beta', 'devnet', 'testnet', 'localnet'].includes(root.cluster) ||
        typeof root.genesisHash !== 'string' || root.genesisHash.length < 1 || root.genesisHash.length > MAX_RUNTIME_TEXT_CHARS ||
        typeof root.agaveVersion !== 'string' || root.agaveVersion.length < 1 || root.agaveVersion.length > MAX_RUNTIME_TEXT_CHARS ||
        typeof root.resourcePolicyVersion !== 'string' || root.resourcePolicyVersion.length < 1 || root.resourcePolicyVersion.length > MAX_RUNTIME_TEXT_CHARS ||
        typeof root.runtimeRootHash !== 'string' || !/^[a-f0-9]{64}$/.test(root.runtimeRootHash) ||
        typeof root.activeFeatureSetHash !== 'string' || !(version === 1 ? /^[a-f0-9]{16}$/ : /^[a-f0-9]{64}$/).test(root.activeFeatureSetHash) ||
        (version === 2 && (typeof root.transactionVersionSupported !== 'string' ||
            !['legacy', 'v0', 'all'].includes(root.transactionVersionSupported))) ||
        // The historical creator always emitted `all`; v1 did not hash this field, so accepting another value would trust an unauthenticated edit.
        (version === 1 && root.transactionVersionSupported !== 'all') ||
        !Number.isSafeInteger(root.epoch) || Number(root.epoch) < 0 || !Number.isSafeInteger(root.contextSlot) || Number(root.contextSlot) < 0)
        return false;
    try {
        return runtimeHash(root, version) === root.runtimeRootHash;
    }
    catch {
        return false;
    }
}
/** Pure recursive ProgramRoot commitment validation with bounded depth/size and no accessor execution. */
export function verifyProgramRootIntegrity(value, runtimeContextSlot) {
    if (runtimeContextSlot !== undefined && (!Number.isSafeInteger(runtimeContextSlot) || runtimeContextSlot < 0))
        return false;
    const active = new Set();
    let count = 0;
    const visit = (node, depth) => {
        if (++count > MAX_PROGRAM_ROOTS || depth > MAX_PROGRAM_DEPTH || !node || typeof node !== 'object' || utilTypes.isProxy(node) || active.has(node))
            return false;
        active.add(node);
        try {
            const root = dataRecord(node, PROGRAM_REQUIRED_KEYS, PROGRAM_OPTIONAL_KEYS);
            if (!root || typeof root.programId !== 'string' || !root.programId || root.programId.length > MAX_RUNTIME_TEXT_CHARS ||
                typeof root.executableBytecodeHash !== 'string' || !root.executableBytecodeHash || root.executableBytecodeHash.length > MAX_RUNTIME_TEXT_CHARS ||
                typeof root.programRootHash !== 'string' || !/^[a-f0-9]{64}$/.test(root.programRootHash) ||
                typeof root.isImmutable !== 'boolean' || !Number.isSafeInteger(root.deploymentSlot) || Number(root.deploymentSlot) < 0 ||
                (runtimeContextSlot !== undefined && Number(root.deploymentSlot) > runtimeContextSlot) ||
                (root.programDataAddress !== undefined && (typeof root.programDataAddress !== 'string' || root.programDataAddress.length > MAX_RUNTIME_TEXT_CHARS)) ||
                (root.upgradeAuthority !== undefined && (typeof root.upgradeAuthority !== 'string' || root.upgradeAuthority.length > MAX_RUNTIME_TEXT_CHARS)) ||
                root.isImmutable !== !(root.upgradeAuthority ?? ''))
                return false;
            const children = root.transitiveCpiProgramRoots;
            if (!Array.isArray(children) || utilTypes.isProxy(children) || Object.getPrototypeOf(children) !== Array.prototype || children.length > 64)
                return false;
            const childKeys = Reflect.ownKeys(children);
            if (childKeys.length !== children.length + 1 || childKeys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= children.length)))
                return false;
            const hashes = [];
            for (let i = 0; i < children.length; i += 1) {
                const descriptor = Object.getOwnPropertyDescriptor(children, String(i));
                if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || !visit(descriptor.value, depth + 1))
                    return false;
                const child = dataRecord(descriptor.value, PROGRAM_REQUIRED_KEYS, PROGRAM_OPTIONAL_KEYS);
                if (!child || typeof child.programRootHash !== 'string')
                    return false;
                hashes.push(child.programRootHash);
            }
            return programHash(root, hashes) === root.programRootHash;
        }
        catch {
            return false;
        }
        finally {
            active.delete(node);
        }
    };
    return visit(value, 0);
}
/** Validate a bounded top-level forest and every recursively committed child. */
export function verifyProgramRootForestIntegrity(value, runtimeContextSlot) {
    if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_PROGRAM_ROOTS)
        return false;
    try {
        const keys = Reflect.ownKeys(value);
        if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))
            return false;
        let total = 0;
        const seen = new Set();
        const countTree = (node) => {
            if (!node || typeof node !== 'object')
                return false;
            if (seen.has(node))
                return true;
            seen.add(node);
            if (++total > MAX_PROGRAM_ROOTS)
                return false;
            const record = dataRecord(node, PROGRAM_REQUIRED_KEYS, PROGRAM_OPTIONAL_KEYS);
            if (!record || !Array.isArray(record.transitiveCpiProgramRoots))
                return false;
            for (let index = 0; index < record.transitiveCpiProgramRoots.length; index += 1) {
                const descriptor = Object.getOwnPropertyDescriptor(record.transitiveCpiProgramRoots, String(index));
                if (!descriptor || !('value' in descriptor) || !countTree(descriptor.value))
                    return false;
            }
            return true;
        };
        const programIds = new Set();
        for (let i = 0; i < value.length; i += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || !verifyProgramRootIntegrity(descriptor.value, runtimeContextSlot) || !countTree(descriptor.value))
                return false;
            const root = dataRecord(descriptor.value, PROGRAM_REQUIRED_KEYS, PROGRAM_OPTIONAL_KEYS);
            if (!root || typeof root.programId !== 'string' || programIds.has(root.programId))
                return false;
            programIds.add(root.programId);
        }
        return true;
    }
    catch {
        return false;
    }
}
function snapshotRuntimeRootParams(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new TypeError('RUNTIME_ROOT_PARAMS_INVALID');
    }
    const allowed = new Set(['cluster', 'genesisHash', 'epoch', 'contextSlot', 'agaveVersion', 'activeFeatures', 'transactionVersionSupported', 'resourcePolicyVersion']);
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string' || !allowed.has(key)))
        throw new TypeError('RUNTIME_ROOT_PARAMS_INVALID');
    const input = Object.create(null);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
            throw new TypeError('RUNTIME_ROOT_PARAMS_INVALID');
        input[key] = descriptor.value;
    }
    if (!Number.isSafeInteger(input.epoch) || Number(input.epoch) < 0 ||
        !Number.isSafeInteger(input.contextSlot) || Number(input.contextSlot) < 0) {
        throw new TypeError('RUNTIME_ROOT_SLOT_OR_EPOCH_INVALID');
    }
    if (input.cluster !== undefined && (typeof input.cluster !== 'string' ||
        !['mainnet-beta', 'devnet', 'testnet', 'localnet'].includes(input.cluster))) {
        throw new TypeError('RUNTIME_ROOT_CLUSTER_INVALID');
    }
    if ((input.genesisHash !== undefined && (typeof input.genesisHash !== 'string' || input.genesisHash.length < 1 || input.genesisHash.length > MAX_RUNTIME_TEXT_CHARS)) ||
        (input.agaveVersion !== undefined && (typeof input.agaveVersion !== 'string' || input.agaveVersion.length < 1 || input.agaveVersion.length > MAX_RUNTIME_TEXT_CHARS)) ||
        (input.resourcePolicyVersion !== undefined && (typeof input.resourcePolicyVersion !== 'string' || input.resourcePolicyVersion.length < 1 ||
            input.resourcePolicyVersion.length > MAX_RUNTIME_TEXT_CHARS))) {
        throw new TypeError('RUNTIME_ROOT_TEXT_FIELD_INVALID');
    }
    if (input.transactionVersionSupported !== undefined &&
        input.transactionVersionSupported !== 'legacy' && input.transactionVersionSupported !== 'v0' && input.transactionVersionSupported !== 'all') {
        throw new TypeError('RUNTIME_ROOT_TRANSACTION_VERSION_INVALID');
    }
    let activeFeatures;
    if (input.activeFeatures !== undefined) {
        const candidate = input.activeFeatures;
        if (!Array.isArray(candidate) || utilTypes.isProxy(candidate) || Object.getPrototypeOf(candidate) !== Array.prototype ||
            candidate.length > MAX_RUNTIME_FEATURES) {
            throw new TypeError('RUNTIME_ROOT_FEATURES_INVALID');
        }
        const arrayKeys = Reflect.ownKeys(candidate);
        if (arrayKeys.length !== candidate.length + 1 || arrayKeys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= candidate.length))) {
            throw new TypeError('RUNTIME_ROOT_FEATURES_INVALID');
        }
        const copy = [];
        const seen = new Set();
        for (let index = 0; index < candidate.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'string' ||
                descriptor.value.length < 1 || descriptor.value.length > MAX_RUNTIME_FEATURE_CHARS || seen.has(descriptor.value)) {
                throw new TypeError('RUNTIME_ROOT_FEATURES_INVALID');
            }
            seen.add(descriptor.value);
            copy.push(descriptor.value);
        }
        activeFeatures = Object.freeze(copy);
    }
    return {
        cluster: input.cluster,
        genesisHash: input.genesisHash,
        epoch: Number(input.epoch),
        contextSlot: Number(input.contextSlot),
        agaveVersion: input.agaveVersion,
        activeFeatures,
        transactionVersionSupported: input.transactionVersionSupported,
        resourcePolicyVersion: input.resourcePolicyVersion,
    };
}
export class EnvironmentCertificationEngine {
    /**
     * Creates a hash-consistent RuntimeRoot from validated inputs and local defaults.
     * It does not authenticate an RPC observation or prove runtime feature activation.
     */
    static createRuntimeRoot(params) {
        const snapshot = snapshotRuntimeRootParams(params);
        const cluster = snapshot.cluster ?? 'mainnet-beta';
        const genesisHash = snapshot.genesisHash ?? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
        const agaveVersion = snapshot.agaveVersion ?? 'v4.3.0';
        const activeFeatures = snapshot.activeFeatures ?? ['warp_core_v1', 'simd_0033', 'blake3_syscall'];
        const epoch = snapshot.epoch;
        const contextSlot = snapshot.contextSlot;
        const activeFeatureSetHash = createHash('sha256')
            .update(JSON.stringify([...activeFeatures].sort()))
            .digest('hex');
        const resourcePolicyVersion = snapshot.resourcePolicyVersion ?? RESOURCE_POLICY_VERSION;
        const transactionVersionSupported = snapshot.transactionVersionSupported ?? 'all';
        const runtimeRootHashSchemaVersion = 2;
        if (RESOURCE_POLICY_VERSION.length < 1 || RESOURCE_POLICY_VERSION.length > MAX_RUNTIME_TEXT_CHARS) {
            throw new TypeError('RUNTIME_ROOT_RESOURCE_POLICY_INVALID');
        }
        const runtimeRootHash = createHash('sha256')
            .update(JSON.stringify({
            runtimeRootHashSchemaVersion,
            cluster,
            genesisHash,
            epoch,
            contextSlot,
            agaveVersion,
            activeFeatureSetHash,
            transactionVersionSupported,
            resourcePolicyVersion,
        }))
            .digest('hex');
        return Object.freeze({
            cluster,
            genesisHash,
            epoch,
            contextSlot,
            agaveVersion,
            activeFeatureSetHash,
            transactionVersionSupported,
            resourcePolicyVersion,
            runtimeRootHash,
            runtimeRootHashSchemaVersion,
        });
    }
    /**
     * Constructs a certified ProgramRoot binding bytecode hash and upgradeability.
     */
    static createProgramRoot(params) {
        const input = dataRecord(params, ['programId', 'deploymentSlot', 'executableBytecodeHash'], ['programDataAddress', 'upgradeAuthority', 'transitiveCpiProgramRoots']);
        if (!input || typeof input.programId !== 'string' || !input.programId || input.programId.length > MAX_RUNTIME_TEXT_CHARS ||
            !Number.isSafeInteger(input.deploymentSlot) || Number(input.deploymentSlot) < 0 ||
            typeof input.executableBytecodeHash !== 'string' || !input.executableBytecodeHash || input.executableBytecodeHash.length > MAX_RUNTIME_TEXT_CHARS ||
            (input.programDataAddress !== undefined && (typeof input.programDataAddress !== 'string' || input.programDataAddress.length > MAX_RUNTIME_TEXT_CHARS)) ||
            (input.upgradeAuthority !== undefined && (typeof input.upgradeAuthority !== 'string' || input.upgradeAuthority.length > MAX_RUNTIME_TEXT_CHARS))) {
            throw new TypeError('PROGRAM_ROOT_PARAMS_INVALID');
        }
        if (input.transitiveCpiProgramRoots !== undefined && !Array.isArray(input.transitiveCpiProgramRoots)) {
            throw new TypeError('PROGRAM_ROOT_CHILDREN_INVALID');
        }
        const rawChildren = input.transitiveCpiProgramRoots === undefined ? [] : input.transitiveCpiProgramRoots;
        if (!verifyProgramRootForestIntegrity(rawChildren))
            throw new TypeError('PROGRAM_ROOT_CHILDREN_INVALID');
        const copyTree = (node) => Object.freeze({
            programId: node.programId,
            ...(Object.prototype.hasOwnProperty.call(node, 'programDataAddress') ? { programDataAddress: node.programDataAddress } : {}),
            deploymentSlot: node.deploymentSlot,
            executableBytecodeHash: node.executableBytecodeHash,
            ...(Object.prototype.hasOwnProperty.call(node, 'upgradeAuthority') ? { upgradeAuthority: node.upgradeAuthority } : {}),
            isImmutable: node.isImmutable,
            transitiveCpiProgramRoots: Object.freeze(node.transitiveCpiProgramRoots.map(copyTree)),
            programRootHash: node.programRootHash,
        });
        const transitiveCpiProgramRoots = Object.freeze(rawChildren.map(copyTree));
        const isImmutable = !input.upgradeAuthority;
        const fields = {
            programId: input.programId, deploymentSlot: input.deploymentSlot,
            executableBytecodeHash: input.executableBytecodeHash,
            isImmutable,
            transitiveCpiProgramRoots,
        };
        if (Object.prototype.hasOwnProperty.call(input, 'programDataAddress'))
            fields.programDataAddress = input.programDataAddress;
        if (Object.prototype.hasOwnProperty.call(input, 'upgradeAuthority'))
            fields.upgradeAuthority = input.upgradeAuthority;
        const programRootHash = programHash(fields, transitiveCpiProgramRoots.map(root => root.programRootHash));
        return Object.freeze({ ...fields, programRootHash });
    }
    /**
     * Detects whether program or runtime environment changes invalidate previous simulations.
     */
    static verifyCompatibility(currentRuntime, certifiedRuntime, currentPrograms, certifiedPrograms) {
        const reasons = [];
        if (!verifyRuntimeRootIntegrity(currentRuntime))
            reasons.push('CURRENT_RUNTIME_ROOT_INVALID: RuntimeRoot fields do not match a supported committed schema');
        if (!verifyRuntimeRootIntegrity(certifiedRuntime))
            reasons.push('CERTIFIED_RUNTIME_ROOT_INVALID: certified RuntimeRoot fields do not match a supported committed schema');
        if (reasons.length > 0)
            return { isCompatible: false, invalidatedReasons: Object.freeze(reasons) };
        if (!verifyProgramRootForestIntegrity(currentPrograms, currentRuntime.contextSlot))
            reasons.push('CURRENT_PROGRAM_ROOT_INVALID: current ProgramRoot forest is malformed, future-dated, or has invalid commitments');
        if (!verifyProgramRootForestIntegrity(certifiedPrograms, certifiedRuntime.contextSlot))
            reasons.push('CERTIFIED_PROGRAM_ROOT_INVALID: certified ProgramRoot forest is malformed, future-dated, or has invalid commitments');
        if (reasons.length > 0)
            return { isCompatible: false, invalidatedReasons: Object.freeze(reasons) };
        if (currentRuntime.cluster !== certifiedRuntime.cluster) {
            reasons.push(`CLUSTER_MISMATCH: ${currentRuntime.cluster} vs certified ${certifiedRuntime.cluster}`);
        }
        if (currentRuntime.genesisHash !== certifiedRuntime.genesisHash) {
            reasons.push('GENESIS_HASH_MISMATCH: Runtime chain identity differs from certification');
        }
        if (currentRuntime.activeFeatureSetHash !== certifiedRuntime.activeFeatureSetHash) {
            reasons.push('FEATURE_SET_DRIFT: Runtime features have transitioned since certification');
        }
        if (currentRuntime.transactionVersionSupported !== certifiedRuntime.transactionVersionSupported) {
            reasons.push('TRANSACTION_VERSION_SUPPORT_DRIFT: Runtime transaction-version support differs from certification');
        }
        if (currentRuntime.agaveVersion !== certifiedRuntime.agaveVersion) {
            reasons.push('AGAVE_VERSION_DRIFT: Runtime software version differs from certification');
        }
        if (currentRuntime.resourcePolicyVersion !== certifiedRuntime.resourcePolicyVersion) {
            reasons.push('RESOURCE_POLICY_DRIFT: Runtime resource policy differs from certification');
        }
        // A newer observation is normal, but an older one cannot establish compatibility with a later certificate.
        if (currentRuntime.contextSlot < certifiedRuntime.contextSlot) {
            reasons.push(`CURRENT_CONTEXT_BEHIND_CERTIFICATE: Current runtime slot ${currentRuntime.contextSlot} precedes certified slot ${certifiedRuntime.contextSlot}`);
        }
        // Certificate construction separately enforces its min-context/simulation slot bounds.
        // Epoch drift retains the existing one-epoch grace below, while identity and runtime-policy fields require exact match.
        if (currentRuntime.epoch > certifiedRuntime.epoch + 1) {
            reasons.push(`EPOCH_DRIFT: Simulation is from epoch ${certifiedRuntime.epoch}, current is ${currentRuntime.epoch}`);
        }
        const currentMap = new Map(currentPrograms.map(p => [p.programId, p]));
        for (const certP of certifiedPrograms) {
            const currP = currentMap.get(certP.programId);
            if (!currP) {
                reasons.push(`PROGRAM_DEPARTED: Program ${certP.programId} is no longer available in current context`);
            }
            else if (currP.programRootHash !== certP.programRootHash) {
                reasons.push(`PROGRAM_BYTECODE_MUTATED: Program ${certP.programId} was upgraded at slot ${currP.deploymentSlot} (hash divergence)`);
            }
        }
        return {
            isCompatible: reasons.length === 0,
            invalidatedReasons: Object.freeze(reasons),
        };
    }
}
//# sourceMappingURL=runtime-program-root.js.map