/**
 * SOL-SYLPH Master Production Intelligence - Multi-Agent Contract & Evidence Types
 * Specifications: Sections 24 (Multi-Agent Intelligence Fabric), 25 (Typed Agent Contract),
 * 28 (Skeptic), 29 (Evidence Council).
 */

export interface AgentAssessment {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly eventId?: string;
  readonly snapshotId?: string;
  readonly decisionId?: string;
  readonly claims: readonly string[];
  readonly evidence: readonly string[];
  readonly counterEvidence: readonly string[];
  readonly bullishProbability: number; // 0.0 to 1.0
  readonly confidence: number;         // 0.0 to 1.0
  readonly uncertainty: number;        // 0.0 to 1.0
  readonly assumptions: readonly string[];
  readonly violatedAssumptions: readonly string[];
  readonly freshnessMs: number;
  readonly isOod: boolean;
  readonly latencyMs: number;
  readonly inputHash: string;
  readonly outputHash: string;
}

export interface ChallengeReport {
  readonly skepticId: string;
  readonly thesisChallenged: string;
  readonly thesisVulnerable: boolean;
  readonly fatalFlawsDetected: readonly string[];
  readonly fragileAssumptions: readonly string[];
  readonly recommendedAction: 'PROCEED' | 'REDUCE_SIZE' | 'REQUIRE_CONFIRMATION' | 'ABSTAIN';
  readonly evaluatedAtMs: number;
}

export type EvidenceCouncilState =
  | 'STRONG_CONSENSUS'
  | 'WEAK_CONSENSUS'
  | 'CONFLICTED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'SYSTEM_DEGRADED';

export interface EvidenceCouncilVerdict {
  readonly state: EvidenceCouncilState;
  readonly effectiveEvidenceCount: number; // calculated from EvidenceDependencyGraph
  readonly rawAgentCount: number;
  readonly consensusProbability: number;
  readonly meanConfidence: number;
  readonly contradictionDetected: boolean;
  readonly contradictionDetails?: string;
  readonly hardVetoes: readonly string[];
  readonly authorizedToProceed: boolean;
  readonly evaluatedAtMs: number;
}
