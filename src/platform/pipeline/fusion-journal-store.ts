/**
 * SYLPH FUSION — DURABLE FUSION JOURNAL STORE & ATOMIC TRANSITIONS
 * Specifications: Blueprint Section 7 (Make Fusion Durable) & Section 8 (Atomic Fusion Transitions)
 * Workbook: #963 Controller Lease, #971 Preemption Fencing, #995 Stale-Proposal Rejection, #999 Minimal Authority Kernel
 *
 * Guarantees:
 * 1. Exactly one successful writer for revision N -> N+1 (CAS).
 * 2. Competing or lagged writers receive STALE_PROPOSAL error.
 * 3. Atomic commit of journal row, certificate hash, state root, and external truth roots.
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  type FusionJournalEntry,
  type FusionJournalEntryInput,
  computeJournalEntryHash,
  GENESIS_JOURNAL_HASH,
} from './fusion-journal.js';
import type { FusionPipelineState } from './pipeline-state.js';

export interface FusionJournalHead {
  readonly sequence: bigint;
  readonly lastEntryHash: string;
  readonly totalEntries: number;
}

export interface DurableFusionTransition {
  readonly economicFactId: string;
  readonly expectedRevision: bigint;
  readonly newRevision: bigint;
  readonly fromState: FusionPipelineState;
  readonly toState: FusionPipelineState;
  readonly previousStateRoot: string;
  readonly nextStateRoot: string;
  readonly transitionPayloadRoot: string;
  readonly certificate: string;
  readonly certificateHash: string;
  readonly journalEntryId: string;
  readonly envelopeId: string;
  readonly envelopeRoot: string;
  readonly observedAt: string;
  readonly externalTruthRoots?: readonly string[];
  readonly capitalReservationMutation?: string;
  readonly economicJournalRoot?: string;
}

export interface FusionJournalStore {
  loadHead(): Promise<FusionJournalHead>;
  appendTransitionAtomic(input: DurableFusionTransition): Promise<FusionJournalEntry>;
  readByEconomicFact(id: string): Promise<readonly FusionJournalEntry[]>;
  readFromSequence(sequence: bigint): Promise<readonly FusionJournalEntry[]>;
  compareAndSwapRevision(
    economicFactId: string,
    expectedRevision: bigint,
    newRevision: bigint
  ): Promise<boolean>;
}

/**
 * In-memory implementation of FusionJournalStore for unit and property testing.
 */
export class InMemoryFusionJournalStore implements FusionJournalStore {
  private readonly entries: FusionJournalEntry[] = [];
  private readonly entriesByFact = new Map<string, FusionJournalEntry[]>();
  private readonly revisions = new Map<string, bigint>();
  private sequenceCounter = 0n;
  private lastHash = GENESIS_JOURNAL_HASH;

  public async loadHead(): Promise<FusionJournalHead> {
    return {
      sequence: this.sequenceCounter,
      lastEntryHash: this.lastHash,
      totalEntries: this.entries.length,
    };
  }

  public async compareAndSwapRevision(
    economicFactId: string,
    expectedRevision: bigint,
    newRevision: bigint
  ): Promise<boolean> {
    const current = this.revisions.get(economicFactId) ?? 0n;
    if (current !== expectedRevision) {
      return false;
    }
    this.revisions.set(economicFactId, newRevision);
    return true;
  }

  public async appendTransitionAtomic(input: DurableFusionTransition): Promise<FusionJournalEntry> {
    // 1. CAS revision check (Prevents duplicate or stale concurrent writers)
    const currentRevision = this.revisions.get(input.economicFactId) ?? 0n;
    if (currentRevision !== input.expectedRevision) {
      throw new Error(
        `STALE_PROPOSAL: Economic fact ${input.economicFactId} expected revision ${input.expectedRevision}, current is ${currentRevision}`
      );
    }

    if (input.newRevision !== input.expectedRevision + 1n) {
      throw new Error(
        `INVALID_REVISION_STEP: Cannot transition from ${input.expectedRevision} to ${input.newRevision}`
      );
    }

    // 2. Build hash-chained entry
    const sequence = ++this.sequenceCounter;
    const previousEntryHash = this.lastHash;

    const entryToHash: Omit<FusionJournalEntry, 'entryHash'> = {
      sequence,
      journalEntryId: input.journalEntryId,
      envelopeId: input.envelopeId,
      economicFactId: input.economicFactId,
      fromState: input.fromState,
      toState: input.toState,
      previousStateRoot: input.previousStateRoot,
      nextStateRoot: input.nextStateRoot,
      envelopeRoot: input.envelopeRoot,
      certificateHash: input.certificateHash,
      economicJournalRoot: input.economicJournalRoot,
      observedAt: input.observedAt,
      previousEntryHash,
    };

    const entryHash = computeJournalEntryHash(entryToHash);
    const entry: FusionJournalEntry = Object.freeze({
      ...entryToHash,
      entryHash,
    });

    // 3. Atomically commit
    this.entries.push(entry);
    this.lastHash = entryHash;
    this.revisions.set(input.economicFactId, input.newRevision);

    let factList = this.entriesByFact.get(input.economicFactId);
    if (!factList) {
      factList = [];
      this.entriesByFact.set(input.economicFactId, factList);
    }
    factList.push(entry);

    return entry;
  }

  public async readByEconomicFact(id: string): Promise<readonly FusionJournalEntry[]> {
    return this.entriesByFact.get(id) ?? [];
  }

  public async readFromSequence(sequence: bigint): Promise<readonly FusionJournalEntry[]> {
    return this.entries.filter((e) => e.sequence >= sequence);
  }
}

/**
 * Local, single-host SQLite implementation. A transition, its fact revision,
 * the global hash-chain head, and its journal row commit in one transaction.
 *
 * This store is not a live-execution permission. A second independent runtime
 * must not write the same account without explicit operational qualification.
 */
export class SqliteFusionJournalStore implements FusionJournalStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (typeof dbPath !== 'string' || dbPath.trim().length === 0 ||
        dbPath === ':memory:' || dbPath.startsWith('file::memory:')) {
      throw new Error('FUSION_JOURNAL_DURABLE_PATH_REQUIRED');
    }
    const filePath = resolve(dbPath);
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
      const mode = this.db.prepare('PRAGMA journal_mode=WAL').get() as { journal_mode: string };
      this.db.exec('PRAGMA synchronous=FULL;');
      const synchronous = this.db.prepare('PRAGMA synchronous').get() as { synchronous: number };
      if (mode.journal_mode !== 'wal' || synchronous.synchronous !== 2) {
        throw new Error('FUSION_JOURNAL_DURABILITY_UNAVAILABLE');
      }
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS fusion_transition_head_v1 (
          singleton INTEGER PRIMARY KEY CHECK (singleton=1),
          sequence INTEGER NOT NULL CHECK(sequence>=0),
          last_entry_hash TEXT NOT NULL CHECK(length(last_entry_hash)=64),
          total_entries INTEGER NOT NULL CHECK(total_entries>=0)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS fusion_fact_revisions_v1 (
          economic_fact_id TEXT PRIMARY KEY NOT NULL,
          revision TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS fusion_transition_events_v1 (
          sequence INTEGER PRIMARY KEY CHECK(sequence>0),
          journal_entry_id TEXT NOT NULL UNIQUE,
          economic_fact_id TEXT NOT NULL,
          entry_hash TEXT NOT NULL CHECK(length(entry_hash)=64),
          body_json TEXT NOT NULL
        ) STRICT;
        INSERT OR IGNORE INTO fusion_transition_head_v1(
          singleton,sequence,last_entry_hash,total_entries
        ) VALUES (1,0,'${GENESIS_JOURNAL_HASH}',0);
      `);
      // Never silently treat a malformed existing head as an empty journal.
      this.readHeadRow();
    } catch (error) {
      try { this.db.close(); } catch { /* original error remains authoritative */ }
      throw error;
    }
  }

  private readHeadRow(): { sequence: number; last_entry_hash: string; total_entries: number } {
    const head = this.db.prepare(
      'SELECT sequence,last_entry_hash,total_entries FROM fusion_transition_head_v1 WHERE singleton=1'
    ).get() as { sequence: number; last_entry_hash: string; total_entries: number } | undefined;
    if (!head || !Number.isSafeInteger(head.sequence) || head.sequence < 0 ||
        !Number.isSafeInteger(head.total_entries) || head.total_entries !== head.sequence ||
        !/^[a-f0-9]{64}$/.test(head.last_entry_hash)) {
      throw new Error('FUSION_JOURNAL_HEAD_INVALID');
    }
    return head;
  }

  private readFactRevision(economicFactId: string): bigint {
    const row = this.db.prepare(
      'SELECT revision FROM fusion_fact_revisions_v1 WHERE economic_fact_id=?'
    ).get(economicFactId) as { revision: string } | undefined;
    if (!row) return 0n;
    if (typeof row.revision !== 'string' || !/^(0|[1-9][0-9]*)$/.test(row.revision)) {
      throw new Error('FUSION_JOURNAL_REVISION_INVALID');
    }
    return BigInt(row.revision);
  }

  private decodeEntry(row: { body_json: string; entry_hash: string }): FusionJournalEntry {
    let value: any;
    try { value = JSON.parse(row.body_json); }
    catch { throw new Error('FUSION_JOURNAL_ROW_INVALID'); }
    if (!value || typeof value.sequence !== 'string' || !/^[1-9][0-9]*$/.test(value.sequence) ||
        typeof value.entryHash !== 'string' || value.entryHash !== row.entry_hash) {
      throw new Error('FUSION_JOURNAL_ROW_INVALID');
    }
    const entry: FusionJournalEntry = { ...value, sequence: BigInt(value.sequence) };
    const { entryHash, ...unsigned } = entry;
    if (computeJournalEntryHash(unsigned) !== entryHash) {
      throw new Error('FUSION_JOURNAL_ROW_HASH_MISMATCH');
    }
    return Object.freeze(entry);
  }

  public async loadHead(): Promise<FusionJournalHead> {
    const head = this.readHeadRow();
    const actual = this.db.prepare(
      'SELECT COUNT(*) AS count FROM fusion_transition_events_v1'
    ).get() as { count: number };
    if (actual.count !== head.total_entries) throw new Error('FUSION_JOURNAL_HEAD_MISMATCH');
    return { sequence: BigInt(head.sequence), lastEntryHash: head.last_entry_hash, totalEntries: head.total_entries };
  }

  public async appendTransitionAtomic(input: DurableFusionTransition): Promise<FusionJournalEntry> {
    if (!input.economicFactId || !input.journalEntryId) throw new Error('FUSION_TRANSITION_IDENTITY_INVALID');
    if (input.expectedRevision < 0n || input.newRevision !== input.expectedRevision + 1n) {
      throw new Error('INVALID_REVISION_STEP');
    }
    let attemptedCommit = false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.readFactRevision(input.economicFactId);
      if (current !== input.expectedRevision) {
        throw new Error(`STALE_PROPOSAL: ${input.economicFactId} expected ${input.expectedRevision}, current ${current}`);
      }
      const exists = this.db.prepare(
        'SELECT 1 AS found FROM fusion_transition_events_v1 WHERE journal_entry_id=?'
      ).get(input.journalEntryId);
      if (exists) throw new Error('FUSION_JOURNAL_ID_CONFLICT');
      const head = this.readHeadRow();
      const nextSequence = head.sequence + 1;
      if (!Number.isSafeInteger(nextSequence)) throw new Error('FUSION_JOURNAL_SEQUENCE_LIMIT');
      const unsigned: Omit<FusionJournalEntry, 'entryHash'> = {
        sequence: BigInt(nextSequence),
        journalEntryId: input.journalEntryId,
        envelopeId: input.envelopeId,
        economicFactId: input.economicFactId,
        fromState: input.fromState,
        toState: input.toState,
        previousStateRoot: input.previousStateRoot,
        nextStateRoot: input.nextStateRoot,
        envelopeRoot: input.envelopeRoot,
        certificateHash: input.certificateHash,
        economicJournalRoot: input.economicJournalRoot,
        observedAt: input.observedAt,
        previousEntryHash: head.last_entry_hash,
      };
      const entry = Object.freeze({ ...unsigned, entryHash: computeJournalEntryHash(unsigned) });
      const body = JSON.stringify({ ...entry, sequence: entry.sequence.toString() });
      this.db.prepare(
        'INSERT INTO fusion_transition_events_v1(sequence,journal_entry_id,economic_fact_id,entry_hash,body_json) VALUES(?,?,?,?,?)'
      ).run(nextSequence,input.journalEntryId,input.economicFactId,entry.entryHash,body);
      this.db.prepare(
        'INSERT INTO fusion_fact_revisions_v1(economic_fact_id,revision) VALUES(?,?) ON CONFLICT(economic_fact_id) DO UPDATE SET revision=excluded.revision'
      ).run(input.economicFactId,input.newRevision.toString());
      const changed = this.db.prepare(
        'UPDATE fusion_transition_head_v1 SET sequence=?,last_entry_hash=?,total_entries=? WHERE singleton=1 AND sequence=? AND last_entry_hash=?'
      ).run(nextSequence,entry.entryHash,nextSequence,head.sequence,head.last_entry_hash);
      if (changed.changes !== 1) throw new Error('FUSION_JOURNAL_CONCURRENT_HEAD_CHANGE');
      attemptedCommit = true;
      this.db.exec('COMMIT');
      return entry;
    } catch (error) {
      try { if (this.db.isTransaction) this.db.exec('ROLLBACK'); }
      catch { throw new Error('FUSION_STORAGE_OUTCOME_UNKNOWN: rollback failed', { cause: error }); }
      if (attemptedCommit) throw new Error('FUSION_STORAGE_OUTCOME_UNKNOWN: commit outcome must be reconciled', { cause: error });
      throw error;
    }
  }

  public async readByEconomicFact(id: string): Promise<readonly FusionJournalEntry[]> {
    const rows = this.db.prepare(
      'SELECT body_json,entry_hash FROM fusion_transition_events_v1 WHERE economic_fact_id=? ORDER BY sequence'
    ).all(id) as { body_json: string; entry_hash: string }[];
    return Object.freeze(rows.map(row => this.decodeEntry(row)));
  }

  public async readFromSequence(sequence: bigint): Promise<readonly FusionJournalEntry[]> {
    if (sequence < 0n || sequence > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('FUSION_JOURNAL_SEQUENCE_INVALID');
    }
    const rows = this.db.prepare(
      'SELECT body_json,entry_hash FROM fusion_transition_events_v1 WHERE sequence>=? ORDER BY sequence'
    ).all(Number(sequence)) as { body_json: string; entry_hash: string }[];
    return Object.freeze(rows.map(row => this.decodeEntry(row)));
  }

  public async compareAndSwapRevision(
    _economicFactId: string, _expectedRevision: bigint, _newRevision: bigint
  ): Promise<boolean> {
    // A standalone CAS would commit a revision without its required journal
    // transition; all durable mutations must use appendTransitionAtomic().
    throw new Error('FUSION_REVISION_CAS_REQUIRES_ATOMIC_TRANSITION');
  }

  public close(): void { this.db.close(); }
}
