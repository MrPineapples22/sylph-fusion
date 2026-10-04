/**
 * SYLPH FUSION — CAPITAL ORCHESTRATOR-X: CONTROL ENGINE
 * Specifications: Master Blueprint Section XXXII (Capital Orchestrator-X)
 *
 * Invariant: Emits exactly NEXT ActionIntent using deterministic priority ladder:
 * 0 truth / reconciliation
 * 1 survival
 * 2 maneuverability
 * 3 robust growth
 * 4 information
 * 5 efficiency
 */

import { createHash } from 'node:crypto';
import type { ActionIntent, OrchestratorAction } from './action-intent.js';
import type { ProofCarryingBid } from '../../opportunity-market/proof-carrying-bid.js';

export interface OrchestrationInputContext {
  readonly currentSlot: bigint;
  readonly unknownSettlementCount: number;
  readonly survivalDeficitUsd: number;
  readonly criticalMintToEvacuate?: string;
  readonly emergencyExitReserveLamports: bigint;
  readonly availableCashLamports: bigint;
  readonly clearedBids: readonly ProofCarryingBid[];
  readonly candidateProofRoot: string;
}

export class CapitalOrchestratorX {
  public computeNextIntent(ctx: OrchestrationInputContext): ActionIntent {
    const emittedAtMs = Date.now();
    const validUntilSlot = ctx.currentSlot + 100n;

    // Priority 0: Truth / Reconciliation
    if (ctx.unknownSettlementCount > 0) {
      return this.buildIntent(
        'RECONCILE',
        undefined,
        0,
        0,
        `Reconciliation priority: ${ctx.unknownSettlementCount} unknown executions pending final truth`,
        ctx.candidateProofRoot,
        emittedAtMs,
        validUntilSlot
      );
    }

    // Priority 1: Survival
    if (ctx.survivalDeficitUsd > 0 && ctx.criticalMintToEvacuate) {
      return this.buildIntent(
        'EVACUATE',
        ctx.criticalMintToEvacuate,
        0,
        1,
        `Survival priority: deficit of $${ctx.survivalDeficitUsd.toFixed(2)} requires immediate evacuation`,
        ctx.candidateProofRoot,
        emittedAtMs,
        validUntilSlot
      );
    }

    // Priority 2: Maneuverability
    if (ctx.availableCashLamports < ctx.emergencyExitReserveLamports) {
      return this.buildIntent(
        'RESERVE_FOR_EXIT',
        undefined,
        0,
        2,
        'Maneuverability priority: cash below emergency exit reserve floor',
        ctx.candidateProofRoot,
        emittedAtMs,
        validUntilSlot
      );
    }

    // Priority 3: Robust Growth (Top Cleared Bid from Opportunity Market)
    if (ctx.clearedBids.length > 0) {
      const topBid = ctx.clearedBids[0]!;
      return this.buildIntent(
        'OPEN',
        topBid.mint,
        topBid.resourceDemands.CAPITAL,
        3,
        `Growth priority: cleared bid ${topBid.bidId} with surplus $${topBid.expectedSurplusUsd.toFixed(2)}`,
        topBid.proofArtifactRoot,
        emittedAtMs,
        validUntilSlot
      );
    }

    // Priority 5: Efficiency (Hold Cash)
    return this.buildIntent(
      'HOLD_CASH',
      undefined,
      0,
      5,
      'Efficiency priority: no clearing bids pass hurdle threshold; preserving capital',
      ctx.candidateProofRoot,
      emittedAtMs,
      validUntilSlot
    );
  }

  private buildIntent(
    action: OrchestratorAction,
    subjectMint: string | undefined,
    allocationSol: number,
    objectivePriority: number,
    rationale: string,
    proofRoot: string,
    emittedAtMs: number,
    validUntilSlot: bigint
  ): ActionIntent {
    const rawId = `${action}:${subjectMint ?? 'NONE'}:${objectivePriority}:${emittedAtMs}`;
    const intentId = `intent_${createHash('sha256').update(rawId).digest('hex').slice(0, 16)}`;

    return {
      intentId,
      action,
      subjectMint,
      allocationSol,
      objectivePriority,
      rationale,
      proofArtifactRoot: proofRoot,
      emittedAtMs,
      validUntilSlot,
    };
  }
}
