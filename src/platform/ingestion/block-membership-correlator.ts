import { createHash } from 'node:crypto';
import bs58 from 'bs58';

export type BlockCommitment = 'processed' | 'confirmed' | 'finalized';
export type MembershipStatus = 'PENDING' | 'MATCHED' | 'MISSING' | 'AMBIGUOUS' | 'RETRACTED' | 'EXPIRED' | 'OVERLOADED';

export interface TransactionMembershipObservation {
  readonly observationId: string;
  readonly providerId: string;
  readonly slot: number;
  readonly signature: string;
  readonly commitment: BlockCommitment;
  readonly observedAtMs: number;
  readonly rawPayloadHash: string;
}

/** `signatures` must come from a provider block update, not transaction `recentBlockhash`. */
export interface BlockMembershipObservation {
  readonly observationId: string;
  readonly providerId: string;
  readonly slot: number;
  readonly blockhash: string;
  readonly commitment: BlockCommitment;
  readonly observedAtMs: number;
  readonly rawPayloadHash: string;
  readonly signatures: readonly string[];
  /** False when the subscription omitted the complete block transaction list. */
  readonly transactionsComplete: boolean;
}

export interface BlockRetractionObservation {
  readonly observationId: string;
  readonly providerId: string;
  readonly slot: number;
  readonly blockhash: string;
  readonly observedAtMs: number;
  readonly rawPayloadHash: string;
}

export interface MembershipResolution {
  readonly transactionObservationId: string;
  readonly status: MembershipStatus;
  readonly reason: string;
  readonly resolvedAtMs: number;
  readonly providerId: string;
  readonly slot: number;
  readonly signature: string;
  readonly blockhashesObserved: readonly string[];
  readonly evidenceClass: 'SOURCE_REPORTED_BLOCK_MEMBERSHIP_ONLY';
  readonly canonicalStatus: 'UNVERIFIED';
  readonly bankIdStatus: 'UNAVAILABLE_IN_PINNED_YELLOWSTONE_V4';
  readonly evidenceHash?: string;
  readonly transactionPayloadHash: string;
  readonly blockPayloadHashes: readonly string[];
  readonly retractionObservationId?: string;
  readonly retractedBlockhash?: string;
  readonly retractionPayloadHash?: string;
}

export interface BlockObservationResult {
  readonly accepted: boolean;
  readonly disposition: 'ADDED' | 'DUPLICATE' | 'CONFLICT' | 'OVERLOADED';
  readonly reason: string;
  readonly providerId: string;
  readonly slot: number;
  readonly blockhash: string;
  readonly rawPayloadHash: string;
  readonly resolutions: readonly MembershipResolution[];
}

export interface BlockMembershipCorrelatorOptions {
  readonly maxPendingTransactions?: number;
  readonly maxRetainedBlocks?: number;
  readonly maxTotalSignatures?: number;
  readonly maxSignaturesPerBlock?: number;
  readonly maxRetainedConflictSlots?: number;
  readonly ttlMs?: number;
}

const HASH = /^[a-f0-9]{64}$/;
const LABEL = /^[A-Za-z0-9_.:/-]{1,192}$/;
const COMMITMENT_RANK: Record<BlockCommitment, number> = { processed: 0, confirmed: 1, finalized: 2 };

type StoredTx = { observation: TransactionMembershipObservation; firstSeenAtMs: number; lastResolution?: MembershipResolution; conflicted?: boolean };
type StoredBlock = { observation: BlockMembershipObservation; signatures: Set<string>; firstSeenAtMs: number };
type StoredRetraction = { observation: BlockRetractionObservation; transactionKeys: Set<string>; firstSeenAtMs: number; blockPayloadHash: string };

function isBase58Bytes(value: unknown, length: number): value is string {
  if (typeof value !== 'string') return false;
  try { return bs58.decode(value).byteLength === length; } catch { return false; }
}

function assertCommon(input: { observationId: string; providerId: string; slot: number; observedAtMs: number; rawPayloadHash: string }): void {
  if (typeof input.observationId !== 'string' || !LABEL.test(input.observationId) ||
      typeof input.providerId !== 'string' || !LABEL.test(input.providerId) ||
      !Number.isSafeInteger(input.slot) || input.slot < 0 ||
      !Number.isSafeInteger(input.observedAtMs) || input.observedAtMs < 0 ||
      typeof input.rawPayloadHash !== 'string' || !HASH.test(input.rawPayloadHash)) {
    throw new Error('BLOCK_MEMBERSHIP_INVALID_OBSERVATION');
  }
}

function slotKey(providerId: string, slot: number): string { return JSON.stringify([providerId, slot]); }
function txKey(providerId: string, slot: number, signature: string): string { return JSON.stringify([providerId, slot, signature]); }
function blockKey(providerId: string, slot: number, blockhash: string): string { return JSON.stringify([providerId, slot, blockhash]); }

/**
 * Bounded, observation-only join for a transaction notification and a same-provider
 * block notification. It does not create a FusionEnvelope or an execution authority.
 */
export class BlockMembershipCorrelator {
  private readonly options: Required<BlockMembershipCorrelatorOptions>;
  private readonly transactions = new Map<string, StoredTx>();
  private readonly blocks = new Map<string, StoredBlock>();
  private readonly blocksBySlot = new Map<string, Set<string>>();
  private readonly retractions = new Map<string, StoredRetraction>();
  private readonly slotConflicts = new Map<string, number>();
  private conflictOverflowUntil = 0;
  private totalSignatures = 0;
  private lastNowMs = 0;

  constructor(options: BlockMembershipCorrelatorOptions = {}) {
    this.options = {
      maxPendingTransactions: options.maxPendingTransactions ?? 4096,
      maxRetainedBlocks: options.maxRetainedBlocks ?? 16,
      maxTotalSignatures: options.maxTotalSignatures ?? 200_000,
      maxSignaturesPerBlock: options.maxSignaturesPerBlock ?? 100_000,
      maxRetainedConflictSlots: options.maxRetainedConflictSlots ?? 1024,
      ttlMs: options.ttlMs ?? 15_000,
    };
    if (!Number.isSafeInteger(this.options.maxPendingTransactions) || this.options.maxPendingTransactions < 1 || this.options.maxPendingTransactions > 100_000 ||
        !Number.isSafeInteger(this.options.maxRetainedBlocks) || this.options.maxRetainedBlocks < 1 || this.options.maxRetainedBlocks > 1024 ||
        !Number.isSafeInteger(this.options.maxTotalSignatures) || this.options.maxTotalSignatures < 1 || this.options.maxTotalSignatures > 2_000_000 ||
        !Number.isSafeInteger(this.options.maxSignaturesPerBlock) || this.options.maxSignaturesPerBlock < 1 || this.options.maxSignaturesPerBlock > this.options.maxTotalSignatures ||
        !Number.isSafeInteger(this.options.maxRetainedConflictSlots) || this.options.maxRetainedConflictSlots < 1 || this.options.maxRetainedConflictSlots > 100_000 ||
        !Number.isSafeInteger(this.options.ttlMs) || this.options.ttlMs < 1 || this.options.ttlMs > 300_000) {
      throw new Error('BLOCK_MEMBERSHIP_INVALID_BOUNDS');
    }
  }

  observeTransaction(input: TransactionMembershipObservation, nowMs = Date.now()): MembershipResolution {
    this.validateTransaction(input);
    this.advanceTime(nowMs);
    this.expire(nowMs);

    const key = txKey(input.providerId, input.slot, input.signature);
    const existing = this.transactions.get(key);
    if (existing) {
      const same = existing.observation.observationId === input.observationId &&
        existing.observation.rawPayloadHash === input.rawPayloadHash && existing.observation.commitment === input.commitment;
      if (!same) {
        existing.conflicted = true;
        return this.resolve(existing, nowMs);
      }
      return this.resolve(existing, nowMs);
    }
    if (this.transactions.size >= this.options.maxPendingTransactions) {
      return this.makeResolution(input, 'OVERLOADED', 'TRANSACTION_QUEUE_CAPACITY', nowMs, []);
    }
    const stored: StoredTx = { observation: Object.freeze({ ...input }), firstSeenAtMs: nowMs };
    this.transactions.set(key, stored);
    return this.resolve(stored, nowMs);
  }

  observeBlock(input: BlockMembershipObservation, nowMs = Date.now()): BlockObservationResult {
    const overPerBlockLimit = this.validateBlock(input);
    this.advanceTime(nowMs);
    this.expire(nowMs);
    if (overPerBlockLimit || this.totalSignatures + input.signatures.length > this.options.maxTotalSignatures) {
      return this.blockResult(input, false, 'OVERLOADED', 'BLOCK_SIGNATURE_BUDGET',
        this.resolutionsForSlot(input.providerId, input.slot, nowMs, 'OVERLOADED', 'BLOCK_SIGNATURE_BUDGET'));
    }

    const key = blockKey(input.providerId, input.slot, input.blockhash);
    const old = this.blocks.get(key);
    if (old) {
      const same = old.observation.rawPayloadHash === input.rawPayloadHash &&
        old.observation.transactionsComplete === input.transactionsComplete && old.signatures.size === input.signatures.length &&
        input.signatures.every(signature => old.signatures.has(signature));
      if (!same) {
        this.markSlotConflict(slotKey(input.providerId, input.slot), nowMs);
        return this.blockResult(input, false, 'CONFLICT', 'CONFLICTING_BLOCK_OBSERVATIONS', this.resolutionsForSlot(input.providerId, input.slot, nowMs));
      }
      return this.blockResult(input, true, 'DUPLICATE', 'IDEMPOTENT_BLOCK_OBSERVATION', this.resolutionsForSlot(input.providerId, input.slot, nowMs));
    }

    const signatures = new Set(input.signatures);
    if (signatures.size !== input.signatures.length) {
      this.markSlotConflict(slotKey(input.providerId, input.slot), nowMs);
      return this.blockResult(input, false, 'CONFLICT', 'DUPLICATE_SIGNATURE_IN_BLOCK', this.resolutionsForSlot(input.providerId, input.slot, nowMs));
    }
    const frozen = Object.freeze({ ...input, signatures: Object.freeze([...input.signatures]) });
    this.blocks.set(key, { observation: frozen, signatures, firstSeenAtMs: nowMs });
    const bySlotKey = slotKey(input.providerId, input.slot);
    const slotBlocks = this.blocksBySlot.get(bySlotKey) ?? new Set<string>();
    slotBlocks.add(key);
    this.blocksBySlot.set(bySlotKey, slotBlocks);
    this.totalSignatures += signatures.size;
    if (slotBlocks.size > 1) this.markSlotConflict(bySlotKey, nowMs);
    while (this.blocks.size > this.options.maxRetainedBlocks || this.totalSignatures > this.options.maxTotalSignatures) this.evictOldestBlock();
    return this.blockResult(input, true, 'ADDED', 'BLOCK_OBSERVATION_RETAINED', this.resolutionsForSlot(input.providerId, input.slot, nowMs));
  }

  retractBlock(input: BlockRetractionObservation, nowMs = Date.now()): readonly MembershipResolution[] {
    assertCommon(input);
    this.advanceTime(nowMs);
    this.expire(nowMs);
    if (!isBase58Bytes(input.blockhash, 32)) throw new Error('BLOCK_MEMBERSHIP_INVALID_BLOCKHASH');
    const key = blockKey(input.providerId, input.slot, input.blockhash);
    const existing = this.blocks.get(key);
    if (!existing) return Object.freeze([]);
    const transactionKeys = new Set<string>();
    for (const [txIdentity, tx] of this.transactions) {
      if (tx.observation.providerId === input.providerId && tx.observation.slot === input.slot && existing.signatures.has(tx.observation.signature)) {
        transactionKeys.add(txIdentity);
      }
    }
    this.evictBlock(key);
    this.retractions.set(key, { observation: Object.freeze({ ...input }), transactionKeys, firstSeenAtMs: nowMs, blockPayloadHash: existing.observation.rawPayloadHash });
    while (this.retractions.size > this.options.maxRetainedBlocks) this.retractions.delete(this.retractions.keys().next().value!);
    return this.resolutionsForSlot(input.providerId, input.slot, nowMs);
  }

  /** Expires old observations and returns explicit expiry resolutions for queued transactions. */
  sweep(nowMs = Date.now()): readonly MembershipResolution[] {
    this.advanceTime(nowMs);
    return Object.freeze(this.expire(nowMs));
  }

  getStats(): Readonly<{ pendingTransactions: number; retainedBlocks: number; retainedSignatures: number; maxPendingTransactions: number; maxRetainedBlocks: number; maxTotalSignatures: number }> {
    return Object.freeze({
      pendingTransactions: this.transactions.size,
      retainedBlocks: this.blocks.size,
      retainedSignatures: this.totalSignatures,
      maxPendingTransactions: this.options.maxPendingTransactions,
      maxRetainedBlocks: this.options.maxRetainedBlocks,
      maxTotalSignatures: this.options.maxTotalSignatures,
    });
  }

  private validateTransaction(input: TransactionMembershipObservation): void {
    assertCommon(input);
    if (!isBase58Bytes(input.signature, 64) ||
        !['processed', 'confirmed', 'finalized'].includes(input.commitment)) throw new Error('BLOCK_MEMBERSHIP_INVALID_TRANSACTION');
  }

  private validateBlock(input: BlockMembershipObservation): boolean {
    assertCommon(input);
    if (!isBase58Bytes(input.blockhash, 32) ||
        !['processed', 'confirmed', 'finalized'].includes(input.commitment) || !Array.isArray(input.signatures) ||
        typeof input.transactionsComplete !== 'boolean') {
      throw new Error('BLOCK_MEMBERSHIP_INVALID_BLOCK');
    }
    if (input.signatures.length > this.options.maxSignaturesPerBlock) return true;
    if (input.signatures.some(signature => !isBase58Bytes(signature, 64))) throw new Error('BLOCK_MEMBERSHIP_INVALID_BLOCK');
    return false;
  }

  private advanceTime(nowMs: number): void {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs < this.lastNowMs) throw new Error('BLOCK_MEMBERSHIP_INVALID_TIME');
    this.lastNowMs = nowMs;
  }

  private expire(nowMs: number): MembershipResolution[] {
    const expired: MembershipResolution[] = [];
    for (const [key, tx] of this.transactions) {
      if (nowMs - tx.firstSeenAtMs < this.options.ttlMs) continue;
      expired.push(this.makeResolution(tx.observation, 'EXPIRED', 'OBSERVATION_TTL_EXPIRED', nowMs, []));
      this.transactions.delete(key);
    }
    for (const [key, block] of this.blocks) if (nowMs - block.firstSeenAtMs >= this.options.ttlMs) this.evictBlock(key);
    for (const [key, r] of this.retractions) if (nowMs - r.firstSeenAtMs >= this.options.ttlMs) this.retractions.delete(key);
    for (const [key, until] of this.slotConflicts) if (nowMs >= until) this.slotConflicts.delete(key);
    if (nowMs >= this.conflictOverflowUntil) this.conflictOverflowUntil = 0;
    return expired;
  }

  private resolve(tx: StoredTx, nowMs: number): MembershipResolution {
    const input = tx.observation;
    const candidates = [...(this.blocksBySlot.get(slotKey(input.providerId, input.slot)) ?? [])]
      .map(key => this.blocks.get(key)!)
      .filter(block => block && block.signatures.has(input.signature));
    const allSlotBlocks = this.blocksBySlot.get(slotKey(input.providerId, input.slot));
    const hashes = [...(allSlotBlocks ?? [])].map(key => this.blocks.get(key)?.observation.blockhash).filter((hash): hash is string => Boolean(hash)).sort();
    const payloadHashes = [...(allSlotBlocks ?? [])].map(key => this.blocks.get(key)?.observation.rawPayloadHash).filter((hash): hash is string => Boolean(hash)).sort();

    let status: MembershipStatus = 'PENDING';
    let reason = 'AWAITING_BLOCK_MEMBERSHIP';
    let matched: StoredBlock | undefined;
    const identity = txKey(input.providerId, input.slot, input.signature);
    const retracted = [...this.retractions.values()].find(record => record.transactionKeys.has(identity));
    const conflict = tx.conflicted || (this.slotConflicts.get(slotKey(input.providerId, input.slot)) ?? -1) > nowMs || this.conflictOverflowUntil > nowMs;
    if (conflict || candidates.length > 1 || (hashes.length > 1 && candidates.length > 0)) {
      status = 'AMBIGUOUS'; reason = tx.conflicted ? 'CONFLICTING_TRANSACTION_OBSERVATIONS' : 'MULTIPLE_BLOCK_CONTEXTS_FOR_SLOT_OR_SIGNATURE';
    } else if (candidates.length === 1) {
      const candidate = candidates[0];
      if (COMMITMENT_RANK[candidate.observation.commitment] < COMMITMENT_RANK[input.commitment]) {
        status = 'PENDING'; reason = 'BLOCK_COMMITMENT_BELOW_TRANSACTION';
      } else if (hashes.length > 1) {
        status = 'AMBIGUOUS'; reason = 'COMPETING_BLOCKHASHES_AT_SLOT';
      } else {
        status = 'MATCHED'; reason = 'EXACT_SIGNATURE_MEMBERSHIP'; matched = candidate;
      }
    } else if (hashes.length > 1) {
      status = 'AMBIGUOUS'; reason = 'COMPETING_BLOCKHASHES_AT_SLOT';
    } else if (allSlotBlocks?.size && [...allSlotBlocks].some(key => {
      const block = this.blocks.get(key)?.observation;
      return block?.transactionsComplete && COMMITMENT_RANK[block.commitment] >= COMMITMENT_RANK[input.commitment];
    })) {
      status = 'MISSING'; reason = 'SIGNATURE_ABSENT_FROM_OBSERVED_COMPLETE_BLOCK';
    } else if (retracted) {
      status = 'RETRACTED'; reason = 'BLOCK_CONTEXT_RETRACTED';
    }

    const result = this.makeResolution(input, status, reason, nowMs, hashes, payloadHashes, matched,
      retracted?.observation.observationId, retracted?.observation.blockhash,
      retracted?.observation.rawPayloadHash, retracted?.blockPayloadHash);
    tx.lastResolution = result;
    return result;
  }

  private resolutionsForSlot(providerId: string, slot: number, nowMs: number, forcedStatus?: MembershipStatus, forcedReason?: string): readonly MembershipResolution[] {
    const outputs: MembershipResolution[] = [];
    for (const [key, tx] of this.transactions) {
      if (tx.observation.providerId !== providerId || tx.observation.slot !== slot) continue;
      if (forcedStatus) {
        const result = this.makeResolution(tx.observation, forcedStatus, forcedReason ?? forcedStatus, nowMs, []);
        if (forcedStatus !== 'OVERLOADED') tx.lastResolution = result;
        outputs.push(result);
      } else outputs.push(this.resolve(tx, nowMs));
    }
    return Object.freeze(outputs);
  }

  private makeResolution(
    input: TransactionMembershipObservation,
    status: MembershipStatus,
    reason: string,
    nowMs: number,
    blockhashes: readonly string[],
    blockPayloadHashes: readonly string[] = [],
    matched?: StoredBlock,
    retractionObservationId?: string,
    retractedBlockhash?: string,
    retractionPayloadHash?: string,
    retractedBlockPayloadHash?: string,
  ): MembershipResolution {
    const evidenceHash = matched ? createHash('sha256').update(JSON.stringify({
      transactionObservationId: input.observationId,
      transactionPayloadHash: input.rawPayloadHash,
      blockObservationId: matched.observation.observationId,
      blockPayloadHash: matched.observation.rawPayloadHash,
      providerId: input.providerId,
      slot: input.slot,
      signature: input.signature,
      blockhash: matched.observation.blockhash,
      commitment: matched.observation.commitment,
    })).digest('hex') : undefined;
    return Object.freeze({
      transactionObservationId: input.observationId,
      status,
      reason,
      resolvedAtMs: nowMs,
      providerId: input.providerId,
      slot: input.slot,
      signature: input.signature,
      blockhashesObserved: Object.freeze([...blockhashes]),
      evidenceClass: 'SOURCE_REPORTED_BLOCK_MEMBERSHIP_ONLY',
      canonicalStatus: 'UNVERIFIED',
      bankIdStatus: 'UNAVAILABLE_IN_PINNED_YELLOWSTONE_V4',
      evidenceHash,
      transactionPayloadHash: input.rawPayloadHash,
      blockPayloadHashes: Object.freeze(retractedBlockPayloadHash ? [...blockPayloadHashes, retractedBlockPayloadHash] : [...blockPayloadHashes]),
      retractionObservationId,
      retractedBlockhash,
      retractionPayloadHash,
    });
  }

  private blockResult(input: BlockMembershipObservation, accepted: boolean, disposition: BlockObservationResult['disposition'], reason: string, resolutions: readonly MembershipResolution[]): BlockObservationResult {
    return Object.freeze({ accepted, disposition, reason, providerId: input.providerId, slot: input.slot,
      blockhash: input.blockhash, rawPayloadHash: input.rawPayloadHash, resolutions });
  }

  private markSlotConflict(key: string, nowMs: number): void {
    if (!this.slotConflicts.has(key) && this.slotConflicts.size >= this.options.maxRetainedConflictSlots) {
      // Never evict live ambiguity and resume confident joins. A saturated conflict
      // table temporarily makes all joins ambiguous until the bounded window expires.
      this.conflictOverflowUntil = Math.max(this.conflictOverflowUntil, nowMs + this.options.ttlMs);
      return;
    }
    this.slotConflicts.delete(key);
    this.slotConflicts.set(key, nowMs + this.options.ttlMs);
  }

  private evictOldestBlock(): void {
    const oldest = this.blocks.entries().next().value as [string, StoredBlock] | undefined;
    if (oldest) this.evictBlock(oldest[0]);
  }

  private evictBlock(key: string): void {
    const block = this.blocks.get(key);
    if (!block) return;
    this.blocks.delete(key);
    this.totalSignatures -= block.signatures.size;
    const bySlot = this.blocksBySlot.get(slotKey(block.observation.providerId, block.observation.slot));
    bySlot?.delete(key);
    if (bySlot?.size === 0) this.blocksBySlot.delete(slotKey(block.observation.providerId, block.observation.slot));
  }
}
