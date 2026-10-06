import { createHash } from 'node:crypto';

/**
 * Research-only, append-only economic evidence spine.  It deliberately has
 * no dependency on execution, signing, transport, or capital-authority code.
 * It makes a paper/shadow decision reproducible before it can be evaluated.
 */
export type EconomicEventKind =
  | 'DECISION' | 'QUOTE' | 'PERMIT' | 'SUBMISSION' | 'LANDING'
  | 'CONFIRMATION' | 'FINALIZATION' | 'SETTLEMENT' | 'OPPORTUNITY_SET';

export interface EconomicProvenance {
  readonly source: string;
  readonly sourceEventId: string;
  readonly observedAtMs: number;
  readonly receivedAtMs: number;
  readonly revision: number;
}

export interface EconomicEventInput {
  readonly certificateId: string;
  readonly kind: EconomicEventKind;
  readonly occurredAtMs: number;
  readonly provenance: EconomicProvenance;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EconomicEvent extends EconomicEventInput {
  readonly sequence: number;
  readonly previousHash: string;
  readonly integrityHash: string;
}

export interface OpportunityCandidate {
  readonly candidateId: string;
  readonly certaintyEquivalentLamports: bigint;
  readonly requiredCapitalLamports: bigint;
  readonly expectedLockSeconds: number;
}

export interface OpportunitySetSnapshot {
  readonly certificateId: string;
  readonly decidedAtMs: number;
  readonly availableCapitalLamports: bigint;
  readonly candidateIds: readonly string[];
  readonly integrityHash: string;
}

const GENESIS_HASH = '0'.repeat(64);

const canonicalize = (value: unknown): string => JSON.stringify(value, (_, item) =>
  typeof item === 'bigint' ? item.toString() : item,
);

const hash = (value: unknown): string => createHash('sha256').update(canonicalize(value)).digest('hex');

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

const timestamp = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name}_MUST_BE_SAFE_POSITIVE_INTEGER`);
};

function assertProvenance(provenance: EconomicProvenance): void {
  if (!provenance.source || !provenance.sourceEventId) throw new Error('PROVENANCE_SOURCE_AND_EVENT_ID_REQUIRED');
  timestamp('OBSERVED_AT', provenance.observedAtMs);
  timestamp('RECEIVED_AT', provenance.receivedAtMs);
  if (!Number.isSafeInteger(provenance.revision) || provenance.revision < 0) throw new Error('PROVENANCE_REVISION_INVALID');
  if (provenance.receivedAtMs < provenance.observedAtMs) throw new Error('PROVENANCE_RECEIVED_BEFORE_OBSERVED');
}

export function createOpportunitySetSnapshot(params: {
  readonly certificateId: string;
  readonly decidedAtMs: number;
  readonly availableCapitalLamports: bigint;
  readonly candidates: readonly OpportunityCandidate[];
}): OpportunitySetSnapshot {
  if (!params.certificateId) throw new Error('CERTIFICATE_ID_REQUIRED');
  timestamp('DECIDED_AT', params.decidedAtMs);
  if (params.availableCapitalLamports < 0n) throw new Error('AVAILABLE_CAPITAL_MUST_BE_NON_NEGATIVE');
  const seen = new Set<string>();
  for (const candidate of params.candidates) {
    if (!candidate.candidateId || seen.has(candidate.candidateId)) throw new Error('OPPORTUNITY_CANDIDATE_ID_MUST_BE_UNIQUE');
    if (candidate.requiredCapitalLamports < 0n || !Number.isFinite(candidate.expectedLockSeconds) || candidate.expectedLockSeconds <= 0) {
      throw new Error('OPPORTUNITY_CANDIDATE_ECONOMICS_INVALID');
    }
    seen.add(candidate.candidateId);
  }
  const payload = {
    certificateId: params.certificateId,
    decidedAtMs: params.decidedAtMs,
    availableCapitalLamports: params.availableCapitalLamports.toString(),
    candidateIds: [...seen].sort(),
  };
  return { ...payload, availableCapitalLamports: params.availableCapitalLamports, integrityHash: hash(payload) };
}

export function verifyOpportunitySetSnapshot(snapshot: OpportunitySetSnapshot): boolean {
  const payload = {
    certificateId: snapshot.certificateId,
    decidedAtMs: snapshot.decidedAtMs,
    availableCapitalLamports: snapshot.availableCapitalLamports.toString(),
    candidateIds: [...snapshot.candidateIds].sort(),
  };
  return hash(payload) === snapshot.integrityHash;
}

export class EconomicEventSpine {
  private readonly eventsByCertificate = new Map<string, readonly EconomicEvent[]>();
  private readonly preparedEvents = new WeakSet<object>();

  public assertCanAppend(input: EconomicEventInput): void {
    if (!input.certificateId) throw new Error('CERTIFICATE_ID_REQUIRED');
    timestamp('OCCURRED_AT', input.occurredAtMs);
    assertProvenance(input.provenance);
    if (input.occurredAtMs < input.provenance.observedAtMs) throw new Error('EVENT_OCCURRED_BEFORE_OBSERVED');
    const existing = this.eventsByCertificate.get(input.certificateId) ?? [];
    const prior = existing.at(-1);
    if (prior && input.occurredAtMs < prior.occurredAtMs) throw new Error('NON_MONOTONIC_ECONOMIC_EVENT_TIME');
    const sequence = existing.length + 1;
    const previousHash = prior?.integrityHash ?? GENESIS_HASH;
    // Preflight serialization too, so composed journals cannot partially
    // commit when payload/provenance data is cyclic or otherwise unhashable.
    hash({ ...input, sequence, previousHash });
  }

  public prepareAppend(input: EconomicEventInput): EconomicEvent {
    const snapshot = deepFreeze(structuredClone(input));
    this.assertCanAppend(snapshot);
    const existing = this.eventsByCertificate.get(snapshot.certificateId) ?? [];
    const prior = existing.at(-1);
    const sequence = existing.length + 1;
    const previousHash = prior?.integrityHash ?? GENESIS_HASH;
    const payload = { ...snapshot, sequence, previousHash };
    const event: EconomicEvent = deepFreeze({ ...payload, integrityHash: hash(payload) });
    this.preparedEvents.add(event);
    return event;
  }

  public appendPrepared(event: EconomicEvent): EconomicEvent {
    if (typeof event !== 'object' || event === null || !this.preparedEvents.has(event)) {
      throw new Error('ECONOMIC_EVENT_NOT_PREPARED_BY_THIS_SPINE');
    }
    const existing = this.eventsByCertificate.get(event.certificateId) ?? [];
    const prior = existing.at(-1);
    const expectedSequence = existing.length + 1;
    const expectedPreviousHash = prior?.integrityHash ?? GENESIS_HASH;
    const { integrityHash, ...payload } = event;
    if (event.sequence !== expectedSequence || event.previousHash !== expectedPreviousHash || hash(payload) !== integrityHash) {
      throw new Error('PREPARED_ECONOMIC_EVENT_STALE_OR_INVALID');
    }
    this.assertCanAppend(event);
    const stored = this.eventsByCertificate.get(event.certificateId) ?? [];
    const committed = Object.freeze([...stored, event]);
    this.eventsByCertificate.set(event.certificateId, committed);
    return event;
  }

  public append(input: EconomicEventInput): EconomicEvent {
    const event = this.prepareAppend(input);
    return this.appendPrepared(event);
  }

  public list(certificateId: string): readonly EconomicEvent[] {
    return this.eventsByCertificate.get(certificateId) ?? [];
  }

  public verify(certificateId: string): boolean {
    let previousHash = GENESIS_HASH;
    let previousTime = 0;
    for (const event of this.list(certificateId)) {
      const { integrityHash, ...payload } = event;
      if (event.previousHash !== previousHash || event.sequence < 1 || event.occurredAtMs < previousTime || hash(payload) !== integrityHash) return false;
      previousHash = integrityHash;
      previousTime = event.occurredAtMs;
    }
    return true;
  }

  /** Returns only evidence received no later than a historical decision. */
  public visibleAt(certificateId: string, decisionAtMs: number): readonly EconomicEvent[] {
    timestamp('DECISION_AT', decisionAtMs);
    return this.list(certificateId).filter((event) => event.provenance.receivedAtMs <= decisionAtMs);
  }
}
