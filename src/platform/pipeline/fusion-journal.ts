/**
 * SYLPH FUSION — HASH-CHAINED FUSION JOURNAL
 * Specifications: Prompt 2, Prompt 9, Prompt 52
 *
 * Append-only, hash-chained journal for canonical pipeline state transitions.
 * References canonicalEventId/checksum and economicJournalRoot without duplicating them.
 *
 * Invariants:
 * 1. Monotonic sequence.
 * 2. Hash-chain continuity: entryHash = H(canonical(entry_without_entryHash)).
 * 3. Idempotency protection: duplicate journalEntryId with identical content is idempotent;
 *    duplicate with conflicting content is rejected.
 * 4. Immutable returned entries.
 * 5. Journal root = latest entry hash.
 */

import { hashCanonical } from './canonical-hashing.js';
import type { FusionPipelineState } from './pipeline-state.js';

export const GENESIS_JOURNAL_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export interface FusionJournalEntry {
  readonly sequence: bigint;
  readonly journalEntryId: string;
  readonly envelopeId: string;
  readonly economicFactId: string;
  readonly fromState: FusionPipelineState;
  readonly toState: FusionPipelineState;
  readonly previousStateRoot: string;
  readonly nextStateRoot: string;
  readonly envelopeRoot: string;
  readonly certificateHash: string;
  readonly canonicalEventId?: string;
  readonly canonicalEventChecksum?: string;
  readonly economicJournalRoot?: string;
  readonly observedAt: string;
  readonly previousEntryHash: string;
  readonly entryHash: string;
}

export type FusionJournalEntryInput = Omit<FusionJournalEntry, 'sequence' | 'previousEntryHash' | 'entryHash'>;

/**
 * Computes deterministic entry hash excluding entryHash itself.
 */
export function computeJournalEntryHash(
  entry: Omit<FusionJournalEntry, 'entryHash'>
): string {
  return hashCanonical({
    sequence: entry.sequence,
    journalEntryId: entry.journalEntryId,
    envelopeId: entry.envelopeId,
    economicFactId: entry.economicFactId,
    fromState: entry.fromState,
    toState: entry.toState,
    previousStateRoot: entry.previousStateRoot,
    nextStateRoot: entry.nextStateRoot,
    envelopeRoot: entry.envelopeRoot,
    certificateHash: entry.certificateHash,
    canonicalEventId: entry.canonicalEventId,
    canonicalEventChecksum: entry.canonicalEventChecksum,
    economicJournalRoot: entry.economicJournalRoot,
    observedAt: entry.observedAt,
    previousEntryHash: entry.previousEntryHash,
  });
}

export class FusionJournal {
  private readonly entries: FusionJournalEntry[] = [];
  private readonly entriesById = new Map<string, FusionJournalEntry>();
  private sequenceCounter = 0n;
  private lastEntryHash = GENESIS_JOURNAL_HASH;

  /**
   * Returns current latest entry hash (or genesis 64-zero hash if empty).
   */
  public root(): string {
    return this.lastEntryHash;
  }

  /**
   * Current journal length.
   */
  public length(): number {
    return this.entries.length;
  }

  /**
   * Appends an entry to the journal with hash chaining and idempotency validation.
   */
  public append(input: FusionJournalEntryInput): FusionJournalEntry {
    // Idempotency check: if journalEntryId already exists
    const existing = this.entriesById.get(input.journalEntryId);
    if (existing) {
      // Validate that content is identical
      const candidateHash = computeJournalEntryHash({
        ...input,
        sequence: existing.sequence,
        previousEntryHash: existing.previousEntryHash,
      });
      if (candidateHash === existing.entryHash) {
        return existing;
      }
      throw new Error(
        `JOURNAL_CONFLICT_ERROR: Duplicate journalEntryId ${input.journalEntryId} with conflicting content`
      );
    }

    this.sequenceCounter += 1n;
    const sequence = this.sequenceCounter;
    const previousEntryHash = this.lastEntryHash;

    const entryToHash: Omit<FusionJournalEntry, 'entryHash'> = {
      ...input,
      sequence,
      previousEntryHash,
    };

    const entryHash = computeJournalEntryHash(entryToHash);

    const fullEntry: FusionJournalEntry = Object.freeze({
      ...entryToHash,
      entryHash,
    });

    this.entries.push(fullEntry);
    this.entriesById.set(fullEntry.journalEntryId, fullEntry);
    this.lastEntryHash = entryHash;

    return fullEntry;
  }

  /**
   * Returns all entries as an immutable list.
   */
  public all(): readonly FusionJournalEntry[] {
    return Object.freeze([...this.entries]);
  }

  /**
   * Verifies the cryptographic hash-chain integrity of the journal.
   */
  public verify(): { valid: boolean; error?: string } {
    let expectedPrevious = GENESIS_JOURNAL_HASH;
    let expectedSequence = 1n;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      // 1. Sequence monotonicity check
      if (entry.sequence !== expectedSequence) {
        return {
          valid: false,
          error: `SEQUENCE_NON_MONOTONIC: Entry at index ${i} has sequence ${entry.sequence} != expected ${expectedSequence}`,
        };
      }

      // 2. Previous hash link check
      if (entry.previousEntryHash !== expectedPrevious) {
        return {
          valid: false,
          error: `BROKEN_HASH_CHAIN: Entry ${entry.journalEntryId} previousEntryHash ${entry.previousEntryHash} != expected ${expectedPrevious}`,
        };
      }

      // 3. Entry hash integrity check
      const computedHash = computeJournalEntryHash(entry);
      if (entry.entryHash !== computedHash) {
        return {
          valid: false,
          error: `TAMPER_DETECTED: Entry ${entry.journalEntryId} hash ${entry.entryHash} != computed ${computedHash}`,
        };
      }

      expectedPrevious = entry.entryHash;
      expectedSequence += 1n;
    }

    return { valid: true };
  }
}
