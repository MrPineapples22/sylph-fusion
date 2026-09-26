/**
 * SYLPH TOKEN VETO SYSTEM — CORE TYPE DEFINITIONS
 *
 * Implements:
 * - Domain-isolated SubjectIdentity (MINTCELL)
 * - BankIdentity (BANKLOCK)
 * - AuthorityState (ONEFACT)
 * - Exact branded arithmetic units (UNITLOCK)
 * - CertifiedHardRule & Coverage types (VETO-KERNEL & VETO-TOTALITY)
 * - Proof, Notary, Defeater & Death contracts (DEFEATER-ZERO & PROOFVAULT)
 * - Target Multidomain Decision Outcome (DecisionOutcomeVNext)
 */

import { createHash } from 'node:crypto';

// --- Branded Units (UNITLOCK) ---
declare const BrandTag: unique symbol;
export type Branded<T, B> = T & { readonly [BrandTag]: B };

export type Lamports = Branded<bigint, 'Lamports'>;
export type RawTokenUnits = Branded<bigint, 'RawTokenUnits'>;
export type BasisPoints = Branded<bigint, 'BasisPoints'>;
export type Slot = Branded<bigint, 'Slot'>;
export type UnixMillis = Branded<bigint, 'UnixMillis'>;

export const lamports = (n: bigint | number): Lamports => BigInt(n) as Lamports;
export const rawTokens = (n: bigint | number): RawTokenUnits => BigInt(n) as RawTokenUnits;
export const basisPoints = (n: bigint | number): BasisPoints => BigInt(n) as BasisPoints;
export const slotUnit = (n: bigint | number): Slot => BigInt(n) as Slot;
export const unixMillis = (n: bigint | number): UnixMillis => BigInt(n) as UnixMillis;

// --- Subject Identity (MINTCELL / SUBJECTLOCK) ---
export interface MintIdentity {
  readonly kind: 'TOKEN_MINT';
  readonly clusterGenesisHash: string;
  readonly mint: string;
}

export interface PoolIdentity {
  readonly kind: 'POOL';
  readonly clusterGenesisHash: string;
  readonly poolAddress: string;
  readonly baseMint: string;
  readonly quoteMint: string;
}

export interface TokenAccountIdentity {
  readonly kind: 'TOKEN_ACCOUNT';
  readonly clusterGenesisHash: string;
  readonly address: string;
  readonly mint: string;
  readonly owner: string;
}

export interface WalletIdentity {
  readonly kind: 'WALLET';
  readonly clusterGenesisHash: string;
  readonly address: string;
}

export interface ProgramIdentity {
  readonly kind: 'PROGRAM';
  readonly clusterGenesisHash: string;
  readonly programId: string;
}

export interface CurveIdentity {
  readonly kind: 'BONDING_CURVE';
  readonly clusterGenesisHash: string;
  readonly curveAddress: string;
  readonly mint: string;
}

export interface VenueIdentity {
  readonly kind: 'VENUE';
  readonly clusterGenesisHash: string;
  readonly venueId: string;
}

export interface AuthorityIdentity {
  readonly kind: 'AUTHORITY';
  readonly clusterGenesisHash: string;
  readonly authorityAddress: string;
}

export type SubjectIdentity =
  | MintIdentity
  | PoolIdentity
  | TokenAccountIdentity
  | WalletIdentity
  | ProgramIdentity
  | CurveIdentity
  | VenueIdentity
  | AuthorityIdentity;

export interface IdentityRelationCertificate {
  readonly certificateId: string;
  readonly sourceSubject: SubjectIdentity;
  readonly targetSubject: SubjectIdentity;
  readonly relationKind: 'POOL_BASE_MINT' | 'ACCOUNT_OWNER' | 'CURVE_MINT' | 'PROGRAM_AUTHORITY';
  readonly attestedAtSlot: bigint;
  readonly attestedBy: string;
  readonly signature: string;
}

// --- Bank Identity (BANKLOCK) ---
export interface BankIdentity {
  readonly clusterGenesisHash: string;
  readonly slot: bigint;
  readonly blockhash: string;
  readonly parentSlot?: bigint;
  readonly commitment: 'processed' | 'confirmed' | 'finalized';
  readonly canonicality: 'CANONICAL' | 'ORPHANED' | 'UNKNOWN';
}

// --- Canonical Authority State (ONEFACT) ---
export type AuthorityState =
  | { readonly kind: 'PRESENT'; readonly authority: string }
  | { readonly kind: 'ABSENT_PROVEN' }
  | { readonly kind: 'UNKNOWN' }
  | { readonly kind: 'CONFLICTED'; readonly candidates: readonly string[] }
  | { readonly kind: 'UNSUPPORTED'; readonly reason: string };

// --- Four-Valued Truth & Evidence States ---
export type FourValuedTruth = 'TRUE' | 'FALSE' | 'UNKNOWN' | 'CONFLICTED';
export type EvidenceCondition =
  | 'KNOWN'
  | 'MISSING'
  | 'STALE'
  | 'CONFLICTING'
  | 'UNAVAILABLE'
  | 'UNSUPPORTED'
  | 'INVALID';

export type EvidenceValidityClass =
  | 'FINALIZED_CHAIN'
  | 'CONFIRMED_CHAIN'
  | 'PROCESSED_CHAIN'
  | 'EXTERNAL_ATTESTATION';

export type FactKind =
  | 'FREEZE_AUTHORITY'
  | 'MINT_AUTHORITY'
  | 'PERMANENT_DELEGATE'
  | 'TRANSFER_HOOK'
  | 'TRANSFER_FEE'
  | 'CLOSE_AUTHORITY'
  | 'DEFAULT_ACCOUNT_STATE'
  | 'HOLDER_CONCENTRATION'
  | 'TOKEN_SUPPLY';

// --- Evidence Root (EVIDENCE GENOME) ---
export interface EvidenceRoot {
  readonly evidenceId: string;
  readonly subject: SubjectIdentity;
  readonly bank: BankIdentity;
  readonly rawBytesHash: string;
  readonly rawAccountLength: number;
  readonly ownerProgram: string;
  readonly decoderId: string;
  readonly decoderVersion: string;
  readonly decoderHash: string;
  readonly schemaHash: string;
  readonly fact: FactKind;
  readonly state: AuthorityState;
  readonly numericValue?: bigint; // exact BigInt value for quantitative rules
  readonly intervalBound?: { readonly lower: bigint; readonly upper: bigint };
  readonly observedAtMonotonicMs: number;
  readonly ancestorEvidenceIds: readonly string[];
}

// --- Hard Rule IR & Applicability ---
export type HardRuleOperator =
  | 'AUTHORITY_EQUALS_PRESENT'
  | 'AUTHORITY_NOT_ABSENT_PROVEN'
  | 'EXACT_BPS_GREATER_THAN'
  | 'LOWER_BOUND_BPS_GREATER_THAN';

export interface HardRuleIR {
  readonly op: HardRuleOperator;
  readonly targetFact: FactKind;
  readonly thresholdBps?: bigint;
}

export interface ApplicabilitySpec {
  readonly subjectKind: 'TOKEN_MINT';
  readonly clusterGenesisHash?: string;
  readonly protocolProgramIds?: readonly string[];
}

export interface EvidenceRequirement {
  readonly fact: FactKind;
  readonly minBankCommitment: 'confirmed' | 'finalized';
  readonly maxAgeSlots?: bigint;
}

export interface HardRuleDefeaterManifest {
  readonly requiredDefeaters: readonly string[];
}

export interface ProtocolBinding {
  readonly programId: string;
  readonly minEpoch: bigint;
  readonly maxEpoch?: bigint;
  readonly decoderHash: string;
}

export interface CertifiedHardRule {
  readonly ruleId: string;
  readonly subjectKind: 'TOKEN_MINT';
  readonly applicability: ApplicabilitySpec;
  readonly requiredEvidence: readonly EvidenceRequirement[];
  readonly evaluatorIr: HardRuleIR;
  readonly defeaterManifest: HardRuleDefeaterManifest;
  readonly validityClass: EvidenceValidityClass;
  readonly protocolBindings: readonly ProtocolBinding[];
  readonly output: 'TOKEN_STRUCTURAL_FAILURE';
  readonly registryEpoch: string;
  readonly ruleHash: string;
}

// --- Coverage Certificate (VETO-TOTALITY) ---
export interface HardRuleCoverageCertificate {
  readonly certificateId: string;
  readonly subject: MintIdentity;
  readonly bank: BankIdentity;
  readonly totalApplicableRules: number;
  readonly evaluatedRuleIds: readonly string[];
  readonly coverageState: 'COMPLETE' | 'INCOMPLETE' | 'CONFLICTED';
  readonly missingRuleIds: readonly string[];
  readonly evaluatedAtSlot: bigint;
  readonly certificateHash: string;
}

// --- Defeater Closure Certificate (DEFEATER-ZERO) ---
export interface DefeaterClosureCertificate {
  readonly certificateId: string;
  readonly ruleId: string;
  readonly subject: MintIdentity;
  readonly bank: BankIdentity;
  readonly testedDefeaterIds: readonly string[];
  readonly status: 'CLOSED' | 'DEFEATED' | 'INDETERMINATE';
  readonly activeDefeaterFound?: string;
  readonly evaluatedAtSlot: bigint;
  readonly certificateHash: string;
}

// --- Hard VETO Proof ---
export interface HardVetoProof {
  readonly proofId: string;
  readonly proofHash: string;
  readonly ruleId: string;
  readonly subject: MintIdentity;
  readonly evidenceIds: readonly string[];
  readonly minimalWitnessIds: readonly string[];
  readonly bank: BankIdentity;
  readonly defeaterCertificateHash: string;
  readonly microkernelVerificationHash: string;
  readonly notaryAttestationHash?: string;
  readonly issuedAtSlot: bigint;
  readonly status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED' | 'EXPIRED' | 'DEAD';
}

// --- Proof Death Certificate (PHASE 6 & 30) ---
export interface ProofDeathCertificate {
  readonly deathCertificateId: string;
  readonly deadProofId: string;
  readonly deadProofHash: string;
  readonly subject: MintIdentity;
  readonly deathReason:
    | 'BANK_ORPHANED'
    | 'DEFEATER_SURFACED'
    | 'REVALIDATION_FAILED'
    | 'RULE_REVOKED'
    | 'PROTOCOL_EPOCH_CHANGED'
    | 'SCHEMA_INVALIDATED';
  readonly causalWitnessEvidenceId?: string;
  readonly killedAtSlot: bigint;
  readonly certificateHash: string;
}

// --- Multidomain Decision Target (RULEMESH / DECISION-VNEXT) ---
export interface DomainDisposition {
  readonly state: 'PASS' | 'WARN' | 'FAIL' | 'ABSTAIN' | 'BLOCK' | 'DEGRADED';
  readonly reason: string;
}

export type EvidenceCoverageState = 'COMPLETE' | 'PARTIAL' | 'STALE' | 'MISSING' | 'CONFLICTED';

export interface DecisionOutcomeVNext {
  readonly subject: MintIdentity;
  readonly decisionId: string;
  readonly decisionGeneration: bigint;
  readonly tokenSafety: 'PASS' | 'FAIL' | 'UNKNOWN' | 'CONFLICTED';
  readonly market: DomainDisposition;
  readonly actor: DomainDisposition;
  readonly policy: DomainDisposition;
  readonly portfolio: DomainDisposition;
  readonly execution: DomainDisposition;
  readonly system: DomainDisposition;
  readonly coverage: EvidenceCoverageState;
  readonly action:
    | 'ALLOW'
    | 'WAIT'
    | 'ABSTAIN'
    | 'LIMIT'
    | 'QUARANTINE'
    | 'POLICY_EXCLUDED'
    | 'BLOCK_NEW_ENTRY'
    | 'REDUCE_ONLY'
    | 'SYSTEM_BLOCKED'
    | 'EXECUTION_BLOCKED';
  readonly hardVetoProofId?: string;
  readonly hardVetoProofHash?: string;
  readonly coverageCertificateHash?: string;
  readonly decidedAtSlot: bigint;
  readonly decisionHash: string;
}

// Helper functions
export const stableJson = (val: unknown): string =>
  JSON.stringify(val, (_, v) => (typeof v === 'bigint' ? v.toString() : v));

export const sha256Hex = (val: unknown): string =>
  createHash('sha256').update(stableJson(val)).digest('hex');
