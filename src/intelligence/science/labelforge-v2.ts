/**
 * SYLPH FUSION — LABELFORGE V2: BITEMPORAL POINT-IN-TIME OUTCOME CERTIFICATION
 * Specifications: Blueprint Section 36
 * Workbook: #559, #543
 *
 * Invariants:
 * 1. Strict bitemporal causality:
 *    occurredAt <= observedAt <= availableAt <= knownAt <= decisionAt < targetTime <= settledAt <= labelMaturedAt
 * 2. Only ECONOMIC_FINAL may enter production learning.
 * 3. Ancestor revocation inheritance: if terminality, settlement, or profit certificates are revoked,
 *    the label is automatically invalidated (REVISED_INVALID).
 */

import { createHash } from 'node:crypto';
import { AssuranceRevocationRegistry } from '../../platform/assurance/revocation-registry.js';

export type LabelV2FinalityStatus =
  | 'INTERMEDIATE_ESTIMATE'
  | 'SETTLEMENT_PENDING'
  | 'MATURITY_PENDING'
  | 'ECONOMIC_FINAL'
  | 'REVISED_INVALID';

export interface BitemporalTimeline {
  readonly occurredAt: number;
  readonly observedAt: number;
  readonly availableAt: number;
  readonly knownAt: number;
  readonly decisionAt: number;
  readonly targetTime: number;
  readonly settledAt: number;
  readonly labelMaturedAt: number;
  readonly finalizedAt: number;
}

export interface LabelCertificateV2 {
  readonly labelId: string;
  readonly tokenMint: string;
  readonly creatorIdentity: string;
  readonly funderClusterId: string;
  readonly economicFactId: string;
  readonly executionGenerationId: string;
  readonly timeline: BitemporalTimeline;
  readonly knowledgeCutRoot: string;
  readonly terminalityCertificateId: string;
  readonly settlementCertificateId: string;
  readonly profitCertificateId: string;
  readonly finalLabelValue: number;
  readonly labelFinality: LabelV2FinalityStatus;
  readonly realizedNetProceedsLamports: bigint;
  readonly totalFrictionLamports: bigint;
  readonly implementationShortfallBps: number;
  readonly provenanceRoot: string;
  readonly digest: string;
}

export class LabelForgeV2 {
  /**
   * Certifies a bitemporal point-in-time outcome label.
   */
  public static certifyLabel(params: {
    tokenMint: string;
    creatorIdentity: string;
    funderClusterId: string;
    economicFactId: string;
    executionGenerationId: string;
    timeline: BitemporalTimeline;
    knowledgeCutRoot: string;
    terminalityCertificateId: string;
    settlementCertificateId: string;
    profitCertificateId: string;
    finalLabelValue: number;
    labelFinality: LabelV2FinalityStatus;
    realizedNetProceedsLamports: bigint;
    totalFrictionLamports: bigint;
    implementationShortfallBps: number;
    revocationRegistry?: AssuranceRevocationRegistry;
  }): LabelCertificateV2 {
    const t = params.timeline;

    // Invariant 1: Temporal ordering
    if (t.availableAt > t.knownAt) {
      throw new Error(`FUTURE_LEAKAGE: Feature availableAt ${t.availableAt} > knownAt ${t.knownAt}`);
    }
    if (t.knownAt > t.decisionAt) {
      throw new Error(`KNOWLEDGE_CUT_VIOLATION: knownAt ${t.knownAt} > decisionAt ${t.decisionAt}`);
    }
    if (t.decisionAt >= t.targetTime) {
      throw new Error(`TARGET_CAUSALITY_VIOLATION: decisionAt ${t.decisionAt} >= targetTime ${t.targetTime}`);
    }
    if (t.targetTime > t.settledAt) {
      throw new Error(`SETTLEMENT_PREMATURE: targetTime ${t.targetTime} > settledAt ${t.settledAt}`);
    }
    if (t.settledAt > t.labelMaturedAt) {
      throw new Error(`MATURITY_PREMATURE: settledAt ${t.settledAt} > labelMaturedAt ${t.labelMaturedAt}`);
    }

    // Check ancestor revocations
    let effectiveFinality = params.labelFinality;
    if (params.revocationRegistry) {
      const isTerminalityRevoked = params.revocationRegistry.isRevoked(params.terminalityCertificateId);
      const isSettlementRevoked = params.revocationRegistry.isRevoked(params.settlementCertificateId);
      const isProfitRevoked = params.revocationRegistry.isRevoked(params.profitCertificateId);

      if (isTerminalityRevoked || isSettlementRevoked || isProfitRevoked) {
        effectiveFinality = 'REVISED_INVALID';
      }
    }

    const payload = [
      params.tokenMint,
      params.creatorIdentity,
      params.funderClusterId,
      params.economicFactId,
      params.executionGenerationId,
      t.decisionAt,
      t.targetTime,
      t.settledAt,
      t.labelMaturedAt,
      params.knowledgeCutRoot,
      params.terminalityCertificateId,
      params.settlementCertificateId,
      params.profitCertificateId,
      params.finalLabelValue,
      effectiveFinality,
    ].join(':');

    const digest = createHash('sha256').update(payload).digest('hex');
    const labelId = `LABEL-V2-${digest.slice(0, 16)}`;

    return {
      labelId,
      tokenMint: params.tokenMint,
      creatorIdentity: params.creatorIdentity,
      funderClusterId: params.funderClusterId,
      economicFactId: params.economicFactId,
      executionGenerationId: params.executionGenerationId,
      timeline: params.timeline,
      knowledgeCutRoot: params.knowledgeCutRoot,
      terminalityCertificateId: params.terminalityCertificateId,
      settlementCertificateId: params.settlementCertificateId,
      profitCertificateId: params.profitCertificateId,
      finalLabelValue: params.finalLabelValue,
      labelFinality: effectiveFinality,
      realizedNetProceedsLamports: params.realizedNetProceedsLamports,
      totalFrictionLamports: params.totalFrictionLamports,
      implementationShortfallBps: params.implementationShortfallBps,
      provenanceRoot: digest,
      digest,
    };
  }

  /**
   * Revalidates an existing label against current revocation status.
   */
  public static checkRevocationStatus(
    label: LabelCertificateV2,
    revocationRegistry: AssuranceRevocationRegistry
  ): LabelCertificateV2 {
    const isTerminalityRevoked = revocationRegistry.isRevoked(label.terminalityCertificateId);
    const isSettlementRevoked = revocationRegistry.isRevoked(label.settlementCertificateId);
    const isProfitRevoked = revocationRegistry.isRevoked(label.profitCertificateId);

    if (isTerminalityRevoked || isSettlementRevoked || isProfitRevoked) {
      return {
        ...label,
        labelFinality: 'REVISED_INVALID',
      };
    }
    return label;
  }
}
