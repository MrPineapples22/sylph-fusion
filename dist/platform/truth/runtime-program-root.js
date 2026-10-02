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
export class EnvironmentCertificationEngine {
    /**
     * Constructs an authoritative RuntimeRoot binding execution era and feature set.
     */
    static createRuntimeRoot(params) {
        const cluster = params.cluster ?? 'mainnet-beta';
        const genesisHash = params.genesisHash ?? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
        const agaveVersion = params.agaveVersion ?? 'v4.3.0';
        const activeFeatures = params.activeFeatures ?? ['warp_core_v1', 'simd_0033', 'blake3_syscall'];
        const activeFeatureSetHash = createHash('sha256')
            .update(JSON.stringify([...activeFeatures].sort()))
            .digest('hex')
            .slice(0, 16);
        const resourcePolicyVersion = 'res_pol_2026_q4';
        const transactionVersionSupported = 'all';
        const runtimeRootHash = createHash('sha256')
            .update(JSON.stringify({
            cluster,
            genesisHash,
            epoch: params.epoch,
            contextSlot: params.contextSlot,
            agaveVersion,
            activeFeatureSetHash,
            resourcePolicyVersion,
        }))
            .digest('hex');
        return {
            cluster,
            genesisHash,
            epoch: params.epoch,
            contextSlot: params.contextSlot,
            agaveVersion,
            activeFeatureSetHash,
            transactionVersionSupported,
            resourcePolicyVersion,
            runtimeRootHash,
        };
    }
    /**
     * Constructs a certified ProgramRoot binding bytecode hash and upgradeability.
     */
    static createProgramRoot(params) {
        const isImmutable = !params.upgradeAuthority;
        const transitiveCpiProgramRoots = params.transitiveCpiProgramRoots ?? [];
        const programRootHash = createHash('sha256')
            .update(JSON.stringify({
            programId: params.programId,
            programDataAddress: params.programDataAddress,
            deploymentSlot: params.deploymentSlot,
            executableBytecodeHash: params.executableBytecodeHash,
            upgradeAuthority: params.upgradeAuthority ?? 'NONE',
            isImmutable,
            cpiHashes: transitiveCpiProgramRoots.map(c => c.programRootHash),
        }))
            .digest('hex');
        return {
            programId: params.programId,
            programDataAddress: params.programDataAddress,
            deploymentSlot: params.deploymentSlot,
            executableBytecodeHash: params.executableBytecodeHash,
            upgradeAuthority: params.upgradeAuthority,
            isImmutable,
            transitiveCpiProgramRoots: Object.freeze(transitiveCpiProgramRoots),
            programRootHash,
        };
    }
    /**
     * Detects whether program or runtime environment changes invalidate previous simulations.
     */
    static verifyCompatibility(currentRuntime, certifiedRuntime, currentPrograms, certifiedPrograms) {
        const reasons = [];
        if (currentRuntime.cluster !== certifiedRuntime.cluster) {
            reasons.push(`CLUSTER_MISMATCH: ${currentRuntime.cluster} vs certified ${certifiedRuntime.cluster}`);
        }
        if (currentRuntime.activeFeatureSetHash !== certifiedRuntime.activeFeatureSetHash) {
            reasons.push('FEATURE_SET_DRIFT: Runtime features have transitioned since certification');
        }
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