import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface ResearchExportManifestV1 {
  readonly schemaVersion: 'sylph-research-export-manifest/1';
  readonly createdAt: string;
  readonly snapshotFile: string;
  readonly snapshotBytes: number;
  readonly snapshotSha256: string;
  readonly auditCoverage: {
    readonly retainedRowCount: number;
    readonly firstRetainedId: number | null;
    readonly lastRetainedId: number | null;
    readonly firstRetainedAtMs: number | null;
    readonly lastRetainedAtMs: number | null;
    readonly countsByEvent: Readonly<Record<string, number>>;
    readonly prunedCountsByEvent: Readonly<Record<string, number>>;
    readonly retentionLedgerStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'TRUNCATED';
    readonly pruneBatchCount: number;
    readonly prunedRowCount: number;
    readonly knownPrunedIdRanges: readonly (readonly [number, number])[];
    readonly omittedPruneBatchCount: number;
    readonly completeness: 'UNKNOWN';
    readonly completenessReason: 'AUDIT_ROWS_MAY_HAVE_BEEN_PRUNED_OR_LOST';
  };
  readonly knownCaptureLoss: {
    readonly status: 'NONE_RECORDED' | 'RECORDED' | 'INVALID_OR_UNAVAILABLE';
    readonly failureCount: number | null;
    readonly recoveryRequired: boolean | null;
  };
  readonly trust: {
    readonly snapshotHash: 'SHA256';
    readonly manifestAuthentication: 'NONE';
    readonly externalAnchor: 'NONE';
  };
}

export type ResearchExportVerification =
  | { readonly valid: true; readonly snapshotSha256: string; readonly retainedAuditRows: number }
  | { readonly valid: false; readonly reason: 'MANIFEST_INVALID' | 'SNAPSHOT_HASH_MISMATCH' | 'SNAPSHOT_INVENTORY_MISMATCH' };

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; hash.update(chunk); }
  return { sha256: hash.digest('hex'), bytes };
}

async function stableSnapshot(path: string): Promise<{ sha256: string; bytes: number; facts: ReturnType<typeof inventory> }> {
  const before = await hashFile(path);
  const facts = inventory(path);
  const after = await hashFile(path);
  if (before.sha256 !== after.sha256 || before.bytes !== after.bytes) throw new Error('RESEARCH_EXPORT_SNAPSHOT_CHANGED_DURING_READ');
  return { ...after, facts };
}

function inventory(path: string): Pick<ResearchExportManifestV1, 'auditCoverage' | 'knownCaptureLoss'> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as { name: string }[]).map(row => row.name));
    if (!tables.has('audit') || !tables.has('state')) throw new Error('RESEARCH_EXPORT_SCHEMA_UNSUPPORTED');
    const aggregateQuery = db.prepare('SELECT COUNT(*) AS count, MIN(id) AS first_id, MAX(id) AS last_id, MIN(at) AS first_at, MAX(at) AS last_at FROM audit');
    aggregateQuery.setReadBigInts(true);
    const aggregate = aggregateQuery.get() as Record<string, number | bigint | null>;
    const countsQuery = db.prepare('SELECT event, COUNT(*) AS count FROM audit GROUP BY event ORDER BY event LIMIT 10001');
    countsQuery.setReadBigInts(true);
    const counts = countsQuery.all() as { event: string; count: number | bigint }[];
    if (counts.length > 10_000) throw new Error('RESEARCH_EXPORT_EVENT_TYPE_LIMIT');
    const countsByEvent: Record<string, number> = Object.create(null);
    const prunedCountsByEvent: Record<string, number> = Object.create(null);
    for (const row of counts) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(row.event)) throw new Error('RESEARCH_EXPORT_AUDIT_EVENT_INVALID');
      countsByEvent[row.event] = safeInteger(row.count);
    }
    if (Object.values(countsByEvent).reduce((sum, count) => sum + BigInt(count), 0n) !==
        BigInt(safeInteger(aggregate.count!))) throw new Error('RESEARCH_EXPORT_AUDIT_COUNTS_MISMATCH');
    let retentionLedgerStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'TRUNCATED' = 'UNAVAILABLE';
    let pruneBatchCount = 0, prunedRowCount = 0, omittedPruneBatchCount = 0;
    const knownPrunedIdRanges: [number, number][] = [];
    if (tables.has('audit_prune_ledger')) {
      const totalsQuery = db.prepare('SELECT COUNT(*) AS batches, COALESCE(SUM(deleted_row_count),0) AS rows FROM audit_prune_ledger');
      totalsQuery.setReadBigInts(true);
      const totals = totalsQuery.get() as { batches: bigint; rows: bigint };
      pruneBatchCount = safeInteger(totals.batches);
      prunedRowCount = safeInteger(totals.rows);
      const rangesQuery = db.prepare('SELECT id_ranges_json,event_counts_json FROM audit_prune_ledger ORDER BY id');
      let consumedBytes = 0, scannedBatches = 0, knownPrunedRows = 0n;
      retentionLedgerStatus = 'AVAILABLE';
      for (const item of rangesQuery.iterate() as Iterable<{ id_ranges_json: string; event_counts_json: string }>) {
        scannedBatches++;
        const bytes = Buffer.byteLength(item.id_ranges_json) + Buffer.byteLength(item.event_counts_json);
        if (consumedBytes + bytes > 512 * 1024) { retentionLedgerStatus = 'TRUNCATED'; break; }
        let ranges: unknown, eventCounts: unknown;
        try { ranges = JSON.parse(item.id_ranges_json); eventCounts = JSON.parse(item.event_counts_json); }
        catch { throw new Error('RESEARCH_EXPORT_RETENTION_LEDGER_INVALID'); }
        if (!Array.isArray(ranges) || ranges.length === 0 || knownPrunedIdRanges.length + ranges.length > 10_000 ||
            !eventCounts || typeof eventCounts !== 'object' || Array.isArray(eventCounts)) { retentionLedgerStatus = 'TRUNCATED'; break; }
        const eventEntries = Object.entries(eventCounts);
        const newEventTypes = eventEntries.filter(([event]) => !Object.hasOwn(prunedCountsByEvent, event)).length;
        if (newEventTypes + Object.keys(prunedCountsByEvent).length > 10_000) { retentionLedgerStatus = 'TRUNCATED'; break; }
        for (const [event, count] of eventEntries) {
          if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(event) || !Number.isSafeInteger(count) || Number(count) < 1) {
            throw new Error('RESEARCH_EXPORT_RETENTION_LEDGER_INVALID');
          }
          const sum = BigInt(prunedCountsByEvent[event] ?? 0) + BigInt(Number(count));
          if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('RESEARCH_EXPORT_INTEGER_OUT_OF_RANGE');
          prunedCountsByEvent[event] = Number(sum);
        }
        for (const pair of ranges) {
          if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isSafeInteger) || pair[0] < 1 || pair[1] < pair[0]) {
            throw new Error('RESEARCH_EXPORT_RETENTION_LEDGER_INVALID');
          }
          knownPrunedIdRanges.push([pair[0], pair[1]]);
          knownPrunedRows += BigInt(pair[1]) - BigInt(pair[0]) + 1n;
        }
        const batchRangeCount = ranges.reduce((sum, pair) => sum + BigInt(pair[1]) - BigInt(pair[0]) + 1n, 0n);
        if (eventEntries.reduce((sum, [, count]) => sum + BigInt(Number(count)), 0n) !== batchRangeCount) throw new Error('RESEARCH_EXPORT_RETENTION_LEDGER_INVALID');
        consumedBytes += bytes;
      }
      knownPrunedIdRanges.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < knownPrunedIdRanges.length; i++) {
        if (knownPrunedIdRanges[i][0] <= knownPrunedIdRanges[i - 1][1]) throw new Error('RESEARCH_EXPORT_RETENTION_LEDGER_INVALID');
      }
      omittedPruneBatchCount = pruneBatchCount - scannedBatches + (retentionLedgerStatus === 'TRUNCATED' ? 1 : 0);
      if (omittedPruneBatchCount < 0) throw new Error('RESEARCH_EXPORT_RETENTION_LEDGER_INVALID');
      if (retentionLedgerStatus === 'AVAILABLE' && (knownPrunedRows !== BigInt(prunedRowCount) ||
          Object.values(prunedCountsByEvent).reduce((sum, count) => sum + BigInt(count), 0n) !== BigInt(prunedRowCount))) {
        throw new Error('RESEARCH_EXPORT_RETENTION_LEDGER_INVALID');
      }
    }
    const stateRow = db.prepare('SELECT body FROM state WHERE id=1').get() as { body?: string } | undefined;
    let knownCaptureLoss: ResearchExportManifestV1['knownCaptureLoss'] = {
      status: 'NONE_RECORDED', failureCount: 0, recoveryRequired: false,
    };
    if (!stateRow?.body) knownCaptureLoss = { status: 'INVALID_OR_UNAVAILABLE', failureCount: null, recoveryRequired: null };
    else {
      try {
        const state = JSON.parse(stateRow.body);
        const loss = state?.researchEvidenceLoss;
        if (loss !== undefined) {
          const valid = loss && Number.isSafeInteger(loss.failureCount) && loss.failureCount > 0 &&
            Number.isSafeInteger(loss.firstFailureAtMs) && Number.isSafeInteger(loss.lastFailureAtMs) &&
            typeof loss.recoveryRequired === 'boolean';
          knownCaptureLoss = valid
            ? { status: 'RECORDED', failureCount: loss.failureCount, recoveryRequired: loss.recoveryRequired }
            : { status: 'INVALID_OR_UNAVAILABLE', failureCount: null, recoveryRequired: null };
        }
      } catch { knownCaptureLoss = { status: 'INVALID_OR_UNAVAILABLE', failureCount: null, recoveryRequired: null }; }
    }
    const toNumber = (value: number | bigint | null): number | null => value === null ? null : safeInteger(value);
    return {
      auditCoverage: {
        retainedRowCount: safeInteger(aggregate.count!),
        firstRetainedId: toNumber(aggregate.first_id), lastRetainedId: toNumber(aggregate.last_id),
        firstRetainedAtMs: toNumber(aggregate.first_at), lastRetainedAtMs: toNumber(aggregate.last_at),
        countsByEvent: Object.freeze(countsByEvent), completeness: 'UNKNOWN',
        prunedCountsByEvent: Object.freeze(prunedCountsByEvent),
        completenessReason: 'AUDIT_ROWS_MAY_HAVE_BEEN_PRUNED_OR_LOST',
        retentionLedgerStatus, pruneBatchCount, prunedRowCount,
        knownPrunedIdRanges: Object.freeze(knownPrunedIdRanges.map(range => Object.freeze(range) as readonly [number, number])),
        omittedPruneBatchCount,
      },
      knownCaptureLoss,
    };
  } finally { db.close(); }
}

function safeInteger(value: number | bigint): number {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('RESEARCH_EXPORT_INTEGER_OUT_OF_RANGE');
    return Number(value);
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('RESEARCH_EXPORT_INTEGER_OUT_OF_RANGE');
  return value;
}

export async function createResearchExportManifest(snapshotPath: string, manifestPath = `${snapshotPath}.manifest.json`): Promise<ResearchExportManifestV1> {
  const snapshot = resolve(snapshotPath), destination = resolve(manifestPath);
  if (snapshot === destination) throw new Error('RESEARCH_EXPORT_PATH_COLLISION');
  const { sha256, bytes, facts } = await stableSnapshot(snapshot);
  const manifest: ResearchExportManifestV1 = Object.freeze({
    schemaVersion: 'sylph-research-export-manifest/1', createdAt: new Date().toISOString(), snapshotFile: basename(snapshot),
    snapshotBytes: bytes, snapshotSha256: sha256, ...facts,
    trust: { snapshotHash: 'SHA256', manifestAuthentication: 'NONE', externalAnchor: 'NONE' } as ResearchExportManifestV1['trust'],
  });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, destination);
  } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  return manifest;
}

export async function verifyResearchExportManifest(snapshotPath: string, manifestPath = `${snapshotPath}.manifest.json`): Promise<ResearchExportVerification> {
  let manifest: ResearchExportManifestV1;
  try {
    const sidecarStat = await stat(manifestPath);
    if (!sidecarStat.isFile() || sidecarStat.size > MAX_MANIFEST_BYTES) return { valid: false, reason: 'MANIFEST_INVALID' };
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ResearchExportManifestV1;
    if (!manifest || manifest.schemaVersion !== 'sylph-research-export-manifest/1' ||
        !/^[a-f0-9]{64}$/.test(manifest.snapshotSha256) || !Number.isSafeInteger(manifest.snapshotBytes) || manifest.snapshotBytes < 0 ||
        !Number.isFinite(Date.parse(manifest.createdAt)) || manifest.snapshotFile !== basename(resolve(snapshotPath)) ||
        manifest.auditCoverage?.completeness !== 'UNKNOWN' || manifest.auditCoverage.completenessReason !== 'AUDIT_ROWS_MAY_HAVE_BEEN_PRUNED_OR_LOST' ||
        manifest.trust?.snapshotHash !== 'SHA256' || manifest.trust.manifestAuthentication !== 'NONE' || manifest.trust.externalAnchor !== 'NONE' ||
        !['NONE_RECORDED', 'RECORDED', 'INVALID_OR_UNAVAILABLE'].includes(manifest.knownCaptureLoss?.status) ||
        !Number.isSafeInteger(manifest.auditCoverage.retainedRowCount) || manifest.auditCoverage.retainedRowCount < 0) return { valid: false, reason: 'MANIFEST_INVALID' };
  } catch { return { valid: false, reason: 'MANIFEST_INVALID' }; }
  let snapshot: { sha256: string; bytes: number; facts: ReturnType<typeof inventory> };
  try { snapshot = await stableSnapshot(resolve(snapshotPath)); }
  catch { return { valid: false, reason: 'SNAPSHOT_INVENTORY_MISMATCH' }; }
  if (snapshot.sha256 !== manifest.snapshotSha256 || snapshot.bytes !== manifest.snapshotBytes) return { valid: false, reason: 'SNAPSHOT_HASH_MISMATCH' };
  if (JSON.stringify(snapshot.facts) !== JSON.stringify({ auditCoverage: manifest.auditCoverage, knownCaptureLoss: manifest.knownCaptureLoss })) {
    return { valid: false, reason: 'SNAPSHOT_INVENTORY_MISMATCH' };
  }
  return { valid: true, snapshotSha256: snapshot.sha256, retainedAuditRows: manifest.auditCoverage.retainedRowCount };
}
