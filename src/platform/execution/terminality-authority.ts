/**
 * SYLPH FUSION — CANONICAL TERMINALITY AUTHORITY
 * Specifications: Blueprint Section 24 (Terminality Authority)
 *
 * Invariant: Exactly one authority may issue terminal verdicts:
 *   LANDED_SUCCESS, LANDED_FAILED, CERTIFIED_NOLAND, EXPIRED_UNRESOLVED, DISPUTED.
 *
 * Witnesses (RPC, Janus, Jito, TRUTH-X, Archive) provide evidence; they cannot
 * self-certify terminality.
 */

import { createHash } from 'node:crypto';
import type { ExecutionTerminalityState, BlockHeight, Slot } from './execution-types.js';
import type { NoLandProofCertificate } from './no-land-certificate.js';

export interface TerminalityEvidenceWitness {
  readonly witnessId: string;
  readonly witnessRole: 'RPC_PROVIDER' | 'TRUTH_X' | 'JANUS_RECONCILER' | 'JITO_RELAY' | 'ARCHIVE_INDEXER';
  readonly slot: Slot;
  readonly observedStatus: 'CONFIRMED' | 'FINALIZED' | 'NOT_FOUND' | 'DROPPED';
  readonly blockhashSeen: boolean;
  readonly timestampMs: number;
}

export interface TerminalityVerdict {
  readonly verdictId: string;
  readonly economicFactId: string;
  readonly executionGenerationId: string;
  readonly terminalityState: ExecutionTerminalityState;
  readonly finalizedSlot?: Slot;
  readonly finalizedBlockHeight?: BlockHeight;
  readonly witnesses: readonly TerminalityEvidenceWitness[];
  readonly noLandCertificate?: NoLandProofCertificate;
  readonly verdictDigest: string;
  readonly issuedAtMs: number;
}

export class TerminalityAuthority {
  private readonly issuedVerdicts = new Map<string, TerminalityVerdict>();

  public evaluateTerminality(params: {
    economicFactId: string;
    executionGenerationId: string;
    witnesses: readonly TerminalityEvidenceWitness[];
    lastValidBlockHeight?: BlockHeight;
    currentBlockHeight?: BlockHeight;
    noLandCertificate?: NoLandProofCertificate;
  }): TerminalityVerdict {
    const { economicFactId, executionGenerationId, witnesses, noLandCertificate } = params;

    let terminalityState: ExecutionTerminalityState = 'UNKNOWN';
    let finalizedSlot: Slot | undefined;

    // 1. Check for confirmed/finalized landing
    const landedWitnesses = witnesses.filter((w) => w.observedStatus === 'FINALIZED' || w.observedStatus === 'CONFIRMED');
    if (landedWitnesses.length >= 2) {
      terminalityState = 'LANDED_SUCCESS';
      finalizedSlot = landedWitnesses[0].slot;
    } else if (noLandCertificate && noLandCertificate.conclusion === 'CERTIFIED_NOLAND') {
      terminalityState = 'CERTIFIED_NOLAND';
    } else if (
      params.lastValidBlockHeight !== undefined &&
      params.currentBlockHeight !== undefined &&
      params.currentBlockHeight > params.lastValidBlockHeight + 150n &&
      witnesses.every((w) => w.observedStatus === 'NOT_FOUND')
    ) {
      // Historical absence without certified NoLand proof remains UNRESOLVED, NEVER assumed NoLand
      terminalityState = 'EXPIRED_UNRESOLVED';
    }

    const digest = createHash('sha256')
      .update(`${economicFactId}:${executionGenerationId}:${terminalityState}:${finalizedSlot?.toString() ?? 'none'}`)
      .digest('hex');

    const verdict: TerminalityVerdict = {
      verdictId: `term_verdict_${digest.slice(0, 16)}`,
      economicFactId,
      executionGenerationId,
      terminalityState,
      finalizedSlot,
      finalizedBlockHeight: params.currentBlockHeight,
      witnesses,
      noLandCertificate,
      verdictDigest: digest,
      issuedAtMs: Date.now(),
    };

    this.issuedVerdicts.set(executionGenerationId, verdict);
    return verdict;
  }

  public getVerdict(executionGenerationId: string): TerminalityVerdict | undefined {
    return this.issuedVerdicts.get(executionGenerationId);
  }
}
