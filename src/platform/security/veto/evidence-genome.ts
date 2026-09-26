/**
 * PHASE 13, 14 & 21 — EVIDENCE GENOME, ACYCLOPS & VETO-WITNESS
 *
 * Implements:
 * - Immutable Directed Acyclic Graph (DAG) for proof evidence
 * - Strict cycle detection (Tarjan SCC / DFS) to prevent circular provenance
 * - Self-reference defense: decisions can never become evidence for themselves
 * - Minimal causal witness extraction (unsat-core reduction)
 */

import { EvidenceRoot, MintIdentity, sha256Hex } from './types.js';

export interface ProvenanceNode {
  readonly evidenceId: string;
  readonly root: EvidenceRoot;
  readonly parentEvidenceIds: readonly string[];
}

export class EvidenceGenomeDAG {
  private readonly nodes = new Map<string, ProvenanceNode>();

  public addRoot(root: EvidenceRoot): void {
    if (this.nodes.has(root.evidenceId)) {
      // Idempotent insertion if identical
      const existing = this.nodes.get(root.evidenceId)!;
      if (existing.root.rawBytesHash !== root.rawBytesHash) {
        throw new Error(`Equivocating evidence root insertion for ${root.evidenceId}`);
      }
      return;
    }
    this.nodes.set(root.evidenceId, {
      evidenceId: root.evidenceId,
      root,
      parentEvidenceIds: [...root.ancestorEvidenceIds],
    });
  }

  public getNode(evidenceId: string): ProvenanceNode | undefined {
    return this.nodes.get(evidenceId);
  }

  /**
   * ACYCLOPS: Verifies that the proof graph reachable from evidenceIds has NO CYCLES.
   * Uses 3-color DFS traversal (0: UNVISITED, 1: VISITING, 2: VISITED).
   */
  public verifyAcyclic(entryEvidenceIds: readonly string[]): {
    readonly isAcyclic: boolean;
    readonly cyclePath?: readonly string[];
  } {
    const visited = new Map<string, number>(); // 0=unvisited, 1=visiting, 2=visited
    const currentPath: string[] = [];

    const dfs = (id: string): string[] | null => {
      const state = visited.get(id) ?? 0;
      if (state === 1) {
        // Cycle detected!
        const cycleStartIndex = currentPath.indexOf(id);
        return [...currentPath.slice(cycleStartIndex), id];
      }
      if (state === 2) return null;

      visited.set(id, 1);
      currentPath.push(id);

      const node = this.nodes.get(id);
      if (node) {
        for (const parentId of node.parentEvidenceIds) {
          const cycle = dfs(parentId);
          if (cycle) return cycle;
        }
      }

      currentPath.pop();
      visited.set(id, 2);
      return null;
    };

    for (const id of entryEvidenceIds) {
      const cycle = dfs(id);
      if (cycle) {
        return { isAcyclic: false, cyclePath: cycle };
      }
    }

    return { isAcyclic: true };
  }

  /**
   * VETO-WITNESS: Extracts the minimal causal witness for a proof.
   * Filters the supporting evidence roots to the exact minimal set such that
   * removing any single root leaves the violation unproven.
   */
  public extractMinimalWitness(
    subject: MintIdentity,
    evidenceIds: readonly string[],
    predicate: (subset: readonly EvidenceRoot[]) => boolean
  ): { readonly minimalWitnessIds: readonly string[]; readonly isMinimal: boolean } {
    const roots: EvidenceRoot[] = [];
    for (const id of evidenceIds) {
      const node = this.nodes.get(id);
      if (node && node.root.subject.kind === subject.kind && (node.root.subject as MintIdentity).mint === subject.mint) {
        roots.push(node.root);
      }
    }

    if (!predicate(roots)) {
      return { minimalWitnessIds: [], isMinimal: false };
    }

    // Unsat-core reduction: try greedily removing elements while predicate still holds
    let currentSubset = [...roots];
    for (let i = currentSubset.length - 1; i >= 0; i--) {
      const candidateSubset = currentSubset.filter((_, idx) => idx !== i);
      if (candidateSubset.length > 0 && predicate(candidateSubset)) {
        currentSubset = candidateSubset;
      }
    }

    return {
      minimalWitnessIds: currentSubset.map((r) => r.evidenceId).sort(),
      isMinimal: true,
    };
  }

  /**
   * Computes the Merkle provenance root hash for a set of evidence roots.
   */
  public computeProvenanceHash(evidenceIds: readonly string[]): string {
    const sorted = [...evidenceIds].sort();
    return sha256Hex(sorted.map((id) => this.nodes.get(id)?.root.rawBytesHash ?? id));
  }
}
