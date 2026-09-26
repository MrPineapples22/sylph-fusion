/**
 * PHASE 22 — DEFEATER-ZERO: MANDATORY FALSIFICATION CLOSURE ENGINE
 *
 * Implements:
 * - Active search for Rebutting, Undermining, and Undercutting defeaters
 * - DefeaterClosureCertificate generation
 * - VETO finalization gate: ONLY status === 'CLOSED' may proceed to VETO.
 */

import {
  BankIdentity,
  CertifiedHardRule,
  DefeaterClosureCertificate,
  EvidenceRoot,
  MintIdentity,
  sha256Hex,
} from './types.js';

export interface DefeaterSearchContext {
  readonly subject: MintIdentity;
  readonly rule: CertifiedHardRule;
  readonly bank: BankIdentity;
  readonly evidenceRoots: readonly EvidenceRoot[];
  readonly newerEvidenceRoots?: readonly EvidenceRoot[];
  readonly currentProtocolEpoch: bigint;
  readonly requiredProtocolEpoch: bigint;
}

export class DefeaterZeroEngine {
  /**
   * Conducts exhaustive defeater closure search against a candidate rule violation.
   */
  public searchDefeaters(context: DefeaterSearchContext): DefeaterClosureCertificate {
    const testedDefeaters: string[] = [];
    let activeDefeaterFound: string | undefined = undefined;

    // 1. Undermining Defeater 1: Bank is orphaned or non-canonical
    testedDefeaters.push('bank_canonicality_check');
    if (context.bank.canonicality !== 'CANONICAL') {
      activeDefeaterFound = `Undermining defeater: Supporting bank ${context.bank.blockhash} is ${context.bank.canonicality}`;
    }

    // 2. Undermining Defeater 2: Subject mismatch in evidence roots
    testedDefeaters.push('subject_identity_integrity_check');
    if (!activeDefeaterFound) {
      for (const root of context.evidenceRoots) {
        if (
          root.subject.kind !== context.subject.kind ||
          (root.subject as MintIdentity).mint !== context.subject.mint ||
          root.subject.clusterGenesisHash !== context.subject.clusterGenesisHash
        ) {
          activeDefeaterFound = `Undermining defeater: Evidence ${root.evidenceId} belongs to different subject`;
          break;
        }
      }
    }

    // 3. Undermining Defeater 3: Decoder disagreement
    testedDefeaters.push('decoder_agreement_check');
    if (!activeDefeaterFound) {
      for (const root of context.evidenceRoots) {
        if (root.state.kind === 'CONFLICTED') {
          activeDefeaterFound = `Undermining defeater: Evidence ${root.evidenceId} has decoder disagreement`;
          break;
        }
        if (root.state.kind === 'UNSUPPORTED' || root.state.kind === 'UNKNOWN') {
          activeDefeaterFound = `Undermining defeater: Evidence ${root.evidenceId} has incomplete/unsupported state`;
          break;
        }
      }
    }

    // 4. Undercutting Defeater 1: Protocol Epoch Drift
    testedDefeaters.push('protocol_epoch_drift_check');
    if (!activeDefeaterFound) {
      if (context.currentProtocolEpoch !== context.requiredProtocolEpoch) {
        activeDefeaterFound = `Undercutting defeater: Protocol epoch changed from ${context.requiredProtocolEpoch} to ${context.currentProtocolEpoch}`;
      }
    }

    // 5. Rebutting Defeater: Newer evidence in a higher slot revokes or contradicts the finding
    testedDefeaters.push('rebutting_newer_evidence_check');
    if (!activeDefeaterFound && context.newerEvidenceRoots) {
      for (const newer of context.newerEvidenceRoots) {
        if (newer.fact === context.rule.evaluatorIr.targetFact && newer.bank.slot > context.bank.slot) {
          if (newer.state.kind === 'ABSENT_PROVEN') {
            activeDefeaterFound = `Rebutting defeater: Newer evidence in slot ${newer.bank.slot} proves authority is ABSENT_PROVEN`;
            break;
          }
        }
      }
    }

    const certificateId = `dcc_${context.subject.mint}_${context.rule.ruleId}_${context.bank.slot}`;
    const status: 'CLOSED' | 'DEFEATED' = activeDefeaterFound ? 'DEFEATED' : 'CLOSED';

    const unsigned = {
      certificateId,
      ruleId: context.rule.ruleId,
      subject: context.subject,
      bank: context.bank,
      testedDefeaterIds: testedDefeaters,
      status,
      activeDefeaterFound,
      evaluatedAtSlot: context.bank.slot,
    };

    return Object.freeze({
      ...unsigned,
      certificateHash: sha256Hex(unsigned),
    });
  }
}
