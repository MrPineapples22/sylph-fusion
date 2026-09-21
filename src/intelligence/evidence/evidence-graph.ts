/**
 * SOL-SYLPH Evidence Graph Engine
 * Part III — Provenance Lineage, Revision Tracking & Cascade Retraction
 */

import { createHash } from 'node:crypto';
import type {
  Evidence,
  EvidenceGroup,
  EvidenceDependency,
  EvidenceRevision,
  EvidenceRetraction,
  EvidenceRelation,
} from '../contracts/scientific-contracts.js';
import type { EpistemicType, FactStatus } from './evidence-registry.js';

export class EvidenceGraphEngine {
  private readonly evidenceNodes = new Map<string, Evidence>();
  private readonly dependencies: EvidenceDependency[] = [];
  private readonly groups = new Map<string, EvidenceGroup>();
  private readonly revisions: EvidenceRevision[] = [];
  private readonly retractions = new Map<string, EvidenceRetraction>();

  /**
   * Register or update an evidence node with cryptographic digest.
   */
  public registerEvidence(params: {
    evidence_id: string;
    claim: string;
    epistemic_type: EpistemicType;
    fact_status: FactStatus;
    confidence: number;
    observed_at_ms: number;
    known_at_ms: number;
    provider: string;
    slot: number;
    dependencies?: readonly string[];
    source_event_id?: string;
  }): Evidence {
    const deps = params.dependencies || [];
    const hash = createHash('sha256')
      .update(`${params.evidence_id}:${params.claim}:${params.slot}:${params.provider}:${params.confidence}`)
      .digest('hex')
      .slice(0, 16);

    const existing = this.evidenceNodes.get(params.evidence_id);
    let revisionNumber = 1;
    if (existing) {
      revisionNumber = existing.revision_number + 1;
      this.revisions.push({
        revision_id: `rev_${params.evidence_id}_${revisionNumber}`,
        evidence_id: params.evidence_id,
        prior_version: existing.revision_number,
        new_version: revisionNumber,
        reason: 'Updated observation claims or confidence calibration',
        modified_by: params.provider,
        timestamp_ms: Date.now(),
      });
    }

    const evidence: Evidence = {
      evidence_id: params.evidence_id,
      claim: params.claim,
      epistemic_type: params.epistemic_type,
      fact_status: params.fact_status,
      confidence: Math.max(0, Math.min(1.0, params.confidence)),
      observed_at_ms: params.observed_at_ms,
      known_at_ms: params.known_at_ms,
      provider: params.provider,
      source_event_id: params.source_event_id,
      slot: params.slot,
      dependencies: deps,
      is_retracted: false,
      revision_number: revisionNumber,
      content_hash: hash,
    };

    this.evidenceNodes.set(params.evidence_id, evidence);

    for (const parentId of deps) {
      this.dependencies.push({
        parent_evidence_id: parentId,
        child_evidence_id: params.evidence_id,
        relationship: 'SUPPORTS',
        weight: 1.0,
      });
    }

    return evidence;
  }

  /**
   * Link explicit relationship between evidence nodes.
   */
  public linkDependency(parent_id: string, child_id: string, relationship: EvidenceRelation, weight = 1.0): void {
    this.dependencies.push({
      parent_evidence_id: parent_id,
      child_evidence_id: child_id,
      relationship,
      weight,
    });
  }

  /**
   * Group related evidence under an EvidenceRoot for a token opportunity.
   */
  public createEvidenceGroup(group_id: string, target_mint: string, evidence_ids: readonly string[]): EvidenceGroup {
    let totalConf = 0;
    const providers = new Set<string>();

    for (const eid of evidence_ids) {
      const e = this.evidenceNodes.get(eid);
      if (e) {
        totalConf += e.confidence;
        providers.add(e.provider);
      }
    }

    const group: EvidenceGroup = {
      group_id,
      root_id: `root_${group_id}`,
      target_mint,
      evidence_ids,
      aggregate_confidence: evidence_ids.length > 0 ? Number((totalConf / evidence_ids.length).toFixed(3)) : 0,
      is_corroborated: providers.size >= 2,
      primary_provider: Array.from(providers)[0] || 'UNKNOWN_PROVIDER',
      created_at: Date.now(),
    };

    this.groups.set(group_id, group);
    return group;
  }

  /**
   * Trace complete backward lineage of an evidence node.
   */
  public traceLineage(evidence_id: string): {
    evidence: Evidence | undefined;
    ancestors: Evidence[];
    providers: string[];
    max_age_ms: number;
    is_fully_active: boolean;
  } {
    const target = this.evidenceNodes.get(evidence_id);
    const ancestors: Evidence[] = [];
    const providers = new Set<string>();
    const visited = new Set<string>();
    const queue = [evidence_id];
    let maxAge = 0;
    const now = Date.now();
    let fullyActive = target ? !target.is_retracted : false;

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);

      const node = this.evidenceNodes.get(curr);
      if (node) {
        if (curr !== evidence_id) ancestors.push(node);
        providers.add(node.provider);
        maxAge = Math.max(maxAge, now - node.observed_at_ms);
        if (node.is_retracted) fullyActive = false;

        for (const dep of node.dependencies) {
          queue.push(dep);
        }
      }
    }

    return {
      evidence: target,
      ancestors,
      providers: Array.from(providers),
      max_age_ms: maxAge,
      is_fully_active: fullyActive,
    };
  }

  /**
   * Retract invalid or poisoned evidence, cascading down to all dependents.
   */
  public retractEvidence(evidence_id: string, reason: string, current_slot: number): EvidenceRetraction {
    const target = this.evidenceNodes.get(evidence_id);
    if (target) {
      (target as any).is_retracted = true;
      (target as any).retraction_reason = reason;
      (target as any).fact_status = 'INVALID';
    }

    // Traverse downward to find all dependent evidence
    const affected = new Set<string>();
    const queue = [evidence_id];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dep of this.dependencies) {
        if (dep.parent_evidence_id === current && !affected.has(dep.child_evidence_id)) {
          affected.add(dep.child_evidence_id);
          queue.push(dep.child_evidence_id);

          const childNode = this.evidenceNodes.get(dep.child_evidence_id);
          if (childNode) {
            (childNode as any).fact_status = 'INVALID';
            (childNode as any).confidence = 0.0;
          }
        }
      }
    }

    const retraction: EvidenceRetraction = {
      retraction_id: `retract_${evidence_id}_${Date.now()}`,
      evidence_id,
      reason,
      invalidated_downstream_evidence: Array.from(affected),
      slot: current_slot,
      timestamp_ms: Date.now(),
    };

    this.retractions.set(evidence_id, retraction);
    return retraction;
  }

  public getEvidence(id: string): Evidence | undefined {
    return this.evidenceNodes.get(id);
  }

  public getGroup(id: string): EvidenceGroup | undefined {
    return this.groups.get(id);
  }

  public getRevisions(): readonly EvidenceRevision[] {
    return this.revisions;
  }
}
