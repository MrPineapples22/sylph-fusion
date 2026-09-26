/**
 * PHASE 25 & 26 — VETO-TXN & VETO-LINEARIZER
 *
 * Implements:
 * - Atomic decision transactions (Capture -> Evaluate -> Revalidate Preconditions -> Commit)
 * - Single authoritative current decision pointer per mint
 * - Compare-And-Swap (CAS) semantics on decisionGeneration
 * - Writer fencing tokens to reject stale leaders/workers
 */

import { BankIdentity, DecisionOutcomeVNext, MintIdentity, sha256Hex } from './types.js';

export interface LinearizerPreconditions {
  readonly expectedGeneration: bigint;
  readonly expectedParentHash?: string;
  readonly bankSlot: bigint;
  readonly protocolEpoch: bigint;
  readonly writerFencingToken: string;
}

export type CasCommitResult =
  | { readonly success: true; readonly committedGeneration: bigint; readonly decision: DecisionOutcomeVNext }
  | { readonly success: false; readonly failureReason: 'STALE_GENERATION' | 'FENCING_TOKEN_REJECTED' | 'PRECONDITION_FAILED'; readonly currentGeneration: bigint };

export class VetoLinearizer {
  private readonly currentDecisions = new Map<
    string,
    { decision: DecisionOutcomeVNext; generation: bigint; fencingToken: string }
  >();

  private mintKey(subject: MintIdentity): string {
    return `${subject.clusterGenesisHash}:${subject.mint}`;
  }

  public getCurrentDecision(subject: MintIdentity): DecisionOutcomeVNext | undefined {
    return this.currentDecisions.get(this.mintKey(subject))?.decision;
  }

  public getCurrentGeneration(subject: MintIdentity): bigint {
    return this.currentDecisions.get(this.mintKey(subject))?.generation ?? 0n;
  }

  /**
   * Compare-and-Swap (CAS) Commit:
   * Commits the new DecisionOutcomeVNext only if the expected generation and writer fencing token match.
   */
  public commitDecisionCAS(
    decision: DecisionOutcomeVNext,
    preconditions: LinearizerPreconditions
  ): CasCommitResult {
    const key = this.mintKey(decision.subject);
    const existing = this.currentDecisions.get(key);

    const currentGen = existing?.generation ?? 0n;
    if (preconditions.expectedGeneration !== currentGen) {
      return {
        success: false,
        failureReason: 'STALE_GENERATION',
        currentGeneration: currentGen,
      };
    }

    if (existing && existing.fencingToken > preconditions.writerFencingToken) {
      return {
        success: false,
        failureReason: 'FENCING_TOKEN_REJECTED',
        currentGeneration: currentGen,
      };
    }

    if (preconditions.expectedParentHash && existing && existing.decision.decisionHash !== preconditions.expectedParentHash) {
      return {
        success: false,
        failureReason: 'PRECONDITION_FAILED',
        currentGeneration: currentGen,
      };
    }

    const nextGeneration = currentGen + 1n;
    const finalDecision: DecisionOutcomeVNext = {
      ...decision,
      decisionGeneration: nextGeneration,
      decisionHash: sha256Hex({ ...decision, decisionGeneration: nextGeneration }),
    };

    this.currentDecisions.set(key, {
      decision: finalDecision,
      generation: nextGeneration,
      fencingToken: preconditions.writerFencingToken,
    });

    return {
      success: true,
      committedGeneration: nextGeneration,
      decision: finalDecision,
    };
  }
}
