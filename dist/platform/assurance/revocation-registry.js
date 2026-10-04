/**
 * SYLPH FUSION — ASSURANCE FABRIC: REVOCATION REGISTRY & TAINT PROPAGATION
 * Specifications: Master Blueprint Section XXXIV, Invariant 6 (INV_AUTH_006)
 *
 * Invariant: Any revoked proof immediately invalidates all dependent proofs and permits.
 */
import { createHash } from 'node:crypto';
export class AssuranceRevocationRegistry {
    currentRevocationEpoch = 1;
    revokedArtifacts = new Map();
    dependencyEdges = new Map(); // parent -> children
    cachedRevocationRoot = '0'.repeat(64);
    getEpoch() {
        return this.currentRevocationEpoch;
    }
    getRevocationRoot() {
        return this.cachedRevocationRoot;
    }
    registerDependency(parentArtifactId, childArtifactId) {
        if (!this.dependencyEdges.has(parentArtifactId)) {
            this.dependencyEdges.set(parentArtifactId, new Set());
        }
        this.dependencyEdges.get(parentArtifactId).add(childArtifactId);
    }
    revokeArtifact(artifactId, reason, reporter) {
        this.currentRevocationEpoch += 1;
        const record = {
            artifactId,
            revokedAtMs: Date.now(),
            revocationEpoch: this.currentRevocationEpoch,
            reason,
            reporter,
        };
        this.revokedArtifacts.set(artifactId, record);
        // Taint propagation: recursively mark all dependent children
        const queue = [artifactId];
        while (queue.length > 0) {
            const parent = queue.shift();
            const children = this.dependencyEdges.get(parent);
            if (children) {
                for (const child of children) {
                    if (!this.revokedArtifacts.has(child)) {
                        this.revokedArtifacts.set(child, {
                            artifactId: child,
                            revokedAtMs: Date.now(),
                            revocationEpoch: this.currentRevocationEpoch,
                            reason: `TAINT_PROPAGATION: Parent proof ${parent} was revoked (${reason})`,
                            reporter,
                        });
                        queue.push(child);
                    }
                }
            }
        }
        this.recomputeRevocationRoot();
        return this.currentRevocationEpoch;
    }
    isRevoked(artifactId) {
        return this.revokedArtifacts.has(artifactId);
    }
    getRevocationDetails(artifactId) {
        return this.revokedArtifacts.get(artifactId);
    }
    recomputeRevocationRoot() {
        const sorted = [...this.revokedArtifacts.keys()].sort();
        const payload = sorted.map((k) => `${k}:${this.revokedArtifacts.get(k).revocationEpoch}`).join(';');
        this.cachedRevocationRoot = createHash('sha256').update(payload).digest('hex');
    }
}
export const globalRevocationRegistry = new AssuranceRevocationRegistry();
//# sourceMappingURL=revocation-registry.js.map