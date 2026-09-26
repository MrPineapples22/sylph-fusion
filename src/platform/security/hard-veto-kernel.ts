/**
 * The only in-process boundary permitted to issue a protected token VETO.
 *
 * Implements:
 * - Direct re-export of all modern VETO subsystems from ./veto/
 * - Complete backward compatibility for existing TokenSafetyAuthority & HardRuleRegistry
 * - Protected semantic invariant: VETO MEANS PROVEN VETO.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  AuthorityState,
  BankIdentity,
  CertifiedHardRule as VetoCertifiedHardRule,
  EvidenceRoot as VetoEvidenceRoot,
  FactKind,
  HardVetoProof as VetoHardVetoProof,
  MintIdentity,
} from './veto/types.js';
import { HardRuleRegistry } from './veto/hard-rule-registry.js';

export * from './veto/index.js';

export type LegacyCertifiedHardRule = {
  readonly ruleId: string;
  readonly subjectKind: 'TOKEN_MINT';
  readonly requiredFact?: FactKind | 'FREEZE_AUTHORITY' | 'MINT_AUTHORITY' | 'PERMANENT_DELEGATE';
  readonly violation?: 'AUTHORITY_PRESENT';
  readonly registryEpoch: string;
};

export type CertifiedHardRule = VetoCertifiedHardRule | LegacyCertifiedHardRule;

export interface EvidenceRoot {
  readonly evidenceId: string;
  readonly subject: MintIdentity;
  readonly bank: BankIdentity;
  readonly rawBytesHash: string;
  readonly decoderId: string;
  readonly decoderHash: string;
  readonly fact: FactKind | 'FREEZE_AUTHORITY' | 'MINT_AUTHORITY' | 'PERMANENT_DELEGATE';
  readonly state: AuthorityState;
}

export interface HardVetoProof {
  readonly proofId: string;
  readonly proofHash: string;
  readonly ruleId: string;
  readonly subject: MintIdentity;
  readonly evidenceIds: readonly string[];
  readonly bank: BankIdentity;
  readonly issuedAtSlot: bigint;
  readonly status: 'ACTIVE';
}

export type TokenSafetyResult =
  | { readonly tokenSafety: 'FAIL'; readonly proof: HardVetoProof }
  | { readonly tokenSafety: 'UNKNOWN' | 'CONFLICTED'; readonly reason: string }
  | { readonly tokenSafety: 'PASS'; readonly reason: string };

const stable = (value: unknown): string =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const digest = (value: unknown): string =>
  createHash('sha256').update(stable(value)).digest('hex');
const sameMint = (a: MintIdentity, b: MintIdentity) =>
  a.clusterGenesisHash === b.clusterGenesisHash && a.mint === b.mint;


/**
 * TokenSafetyAuthority: Formal evaluation boundary.
 */
export class TokenSafetyAuthority {
  constructor(private readonly registry: HardRuleRegistry) {}

  evaluate(subject: MintIdentity, ruleId: string, evidence: readonly EvidenceRoot[]): TokenSafetyResult {
    const rule = this.registry.active(ruleId);
    if (!rule) return { tokenSafety: 'UNKNOWN', reason: 'Hard rule is absent from the active registry' };
    if (rule.subjectKind !== subject.kind) return { tokenSafety: 'UNKNOWN', reason: 'Rule is not applicable to this subject kind' };

    const targetFact = (rule as LegacyCertifiedHardRule).requiredFact ?? (rule as VetoCertifiedHardRule).evaluatorIr?.targetFact;
    const supporting = evidence.filter((root) => root.fact === targetFact);
    if (!supporting.length) return { tokenSafety: 'UNKNOWN', reason: 'Required root evidence is missing' };
    if (supporting.some((root) => !sameMint(root.subject, subject))) {
      return { tokenSafety: 'CONFLICTED', reason: 'Cross-mint evidence cannot support a token proof' };
    }
    if (
      supporting.some(
        (root) => root.bank.clusterGenesisHash !== subject.clusterGenesisHash || root.bank.canonicality !== 'CANONICAL'
      )
    ) {
      return { tokenSafety: 'UNKNOWN', reason: 'Evidence is not bound to a canonical bank for this cluster' };
    }
    if (supporting.some((root) => !root.rawBytesHash || !root.decoderId || !root.decoderHash)) {
      return { tokenSafety: 'UNKNOWN', reason: 'Evidence lacks raw-byte decoder provenance' };
    }
    if (supporting.some((root) => root.state.kind === 'CONFLICTED')) {
      return { tokenSafety: 'CONFLICTED', reason: 'Authority decoders disagree' };
    }
    if (supporting.some((root) => root.state.kind === 'UNKNOWN' || root.state.kind === 'UNSUPPORTED')) {
      return { tokenSafety: 'UNKNOWN', reason: 'Authority state is incomplete or unsupported' };
    }
    const violating = supporting.filter((root) => root.state.kind === 'PRESENT');
    if (!violating.length) {
      return { tokenSafety: 'PASS', reason: 'Evaluated rule has no proven violation; complete-rule coverage is not asserted' };
    }
    const bank = violating[0].bank;
    const proofId = `hvp_${randomUUID()}`;
    const unsigned = {
      proofId,
      ruleId: rule.ruleId,
      subject,
      evidenceIds: violating.map((root) => root.evidenceId).sort(),
      bank,
      issuedAtSlot: bank.slot,
      status: 'ACTIVE' as const,
    };
    const proof: HardVetoProof = Object.freeze({ ...unsigned, proofHash: digest(unsigned) });
    return { tokenSafety: 'FAIL', proof };
  }
}
