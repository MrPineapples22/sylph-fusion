/**
 * SYLPH FUSION — ASSURANCE FABRIC: REVOCATION REGISTRY & TAINT PROPAGATION
 * Specifications: Master Blueprint Section XXXIV, Invariant 6 (INV_AUTH_006)
 *
 * Invariant: Any revoked proof immediately invalidates all dependent proofs and permits.
 */

import { createHash } from 'node:crypto';

export interface RevocationRecord {
  readonly artifactId: string;
  readonly revokedAtMs: number;
  readonly revocationEpoch: number;
  readonly reason: string;
  readonly reporter: string;
}

export class AssuranceRevocationRegistry {
  private currentRevocationEpoch = 1;
  private revokedArtifacts = new Map<string, RevocationRecord>();
  private dependencyEdges = new Map<string, Set<string>>(); // parent -> children
  private cachedRevocationRoot: string = '0'.repeat(64);

  public getEpoch(): number {
    return this.currentRevocationEpoch;
  }

  public getRevocationRoot(): string {
    return this.cachedRevocationRoot;
  }

  public registerDependency(parentArtifactId: string, childArtifactId: string): void {
    if (!this.dependencyEdges.has(parentArtifactId)) {
      this.dependencyEdges.set(parentArtifactId, new Set());
    }
    this.dependencyEdges.get(parentArtifactId)!.add(childArtifactId);
  }

  public revokeArtifact(artifactId: string, reason: string, reporter: string): number {
    this.currentRevocationEpoch += 1;
    const record: RevocationRecord = {
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
      const parent = queue.shift()!;
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

  public isRevoked(artifactId: string): boolean {
    return this.revokedArtifacts.has(artifactId);
  }

  public getRevocationDetails(artifactId: string): RevocationRecord | undefined {
    return this.revokedArtifacts.get(artifactId);
  }

  private recomputeRevocationRoot(): void {
    const sorted = [...this.revokedArtifacts.keys()].sort();
    const payload = sorted.map((k) => `${k}:${this.revokedArtifacts.get(k)!.revocationEpoch}`).join(';');
    this.cachedRevocationRoot = createHash('sha256').update(payload).digest('hex');
  }
}

export const globalRevocationRegistry = new AssuranceRevocationRegistry();
