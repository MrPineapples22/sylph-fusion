import { randomUUID } from 'node:crypto';
import { open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

export type FeedSessionIncident = Readonly<{
  reason: string;
  detail?: string;
  slot?: number;
  signature?: string;
  transport?: string;
  observedAtMs: number;
}>;

type FeedSessionRecord = {
  version: 1;
  databaseIdentity: string;
  canonicalDatabasePath: string;
  status: 'ACTIVE' | 'INCIDENT';
  sessionId: string;
  openedAtMs: number;
  incident?: FeedSessionIncident;
};

type FeedReplayCheckpoint = Readonly<{
  version: 1;
  databaseIdentity: string;
  canonicalDatabasePath: string;
  lastAcceptedYellowstoneSlot: number;
  updatedAtMs: number;
}>;

export type FeedSessionStart = Readonly<{ sessionId: string | null; incident: FeedSessionIncident | null; lastAcceptedYellowstoneSlot: number }>;
export type FeedSessionLatchLocation = Readonly<{ path: string; databaseIdentity: string; canonicalDatabasePath: string }>;

/** Resolve aliases to a shared per-user latch key using the OS file identity. */
export async function feedSessionLatchLocation(databasePath: string, appDataRoot?: string): Promise<FeedSessionLatchLocation> {
  const canonicalDatabasePath = await realpath(databasePath);
  const metadata = await stat(canonicalDatabasePath, { bigint: true });
  if (!metadata.isFile() || metadata.ino <= 0n) throw new Error('FEED_SESSION_DATABASE_FILE_ID_UNAVAILABLE');
  const normalizedPath = process.platform === 'win32' ? canonicalDatabasePath.toLocaleLowerCase('en-US') : canonicalDatabasePath;
  const databaseIdentity = `${metadata.dev.toString()}:${metadata.ino.toString()}`;
  const key = createHash('sha256').update(databaseIdentity).digest('hex');
  const configuredRoot = appDataRoot !== undefined ? appDataRoot : process.env.LOCALAPPDATA;
  const root = configuredRoot ? configuredRoot : join(homedir(), '.local', 'state');
  if (!isAbsolute(root)) throw new Error('FEED_SESSION_APPDATA_ROOT_MUST_BE_ABSOLUTE');
  return Object.freeze({
    path: join(resolve(root), 'SylphFusion', 'feed-session-latches', `${key}.json`),
    databaseIdentity,
    canonicalDatabasePath: normalizedPath,
  });
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(dirname(path), 'r'); }
  catch (error) {
    // Windows does not expose directory handles through Node's fs.open; the
    // file itself was flushed before the atomic rename. On POSIX, directory
    // metadata is flushed as well.
    if (process.platform === 'win32' && ['EISDIR', 'EPERM', 'EACCES', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
    throw error;
  }
  try {
    try { await handle.sync(); }
    catch (error) {
      // Windows may permit opening a directory handle but reject FlushFileBuffers
      // through Node. The incident file itself was fsynced before its rename.
      if (!(process.platform === 'win32' && ['EISDIR', 'EPERM', 'EACCES', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? ''))) throw error;
    }
  } finally { await handle.close(); }
}

async function writeAtomic(path: string, value: FeedSessionRecord | FeedReplayCheckpoint): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${randomUUID()}.feed-session.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally { await handle.close(); }
  await rename(temporary, path);
  await syncDirectory(path);
}

async function readRecord(path: string): Promise<FeedSessionRecord | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as FeedSessionRecord;
    if (!value || value.version !== 1 || typeof value.databaseIdentity !== 'string' || !value.databaseIdentity ||
        typeof value.canonicalDatabasePath !== 'string' || !value.canonicalDatabasePath || !['ACTIVE', 'INCIDENT'].includes(value.status) ||
        typeof value.sessionId !== 'string' || !value.sessionId || !Number.isSafeInteger(value.openedAtMs) || value.openedAtMs < 0 ||
        (value.status === 'INCIDENT' && (!value.incident || typeof value.incident.reason !== 'string' ||
          !Number.isSafeInteger(value.incident.observedAtMs) || value.incident.observedAtMs < 0))) {
      throw new Error('FEED_SESSION_LATCH_INVALID');
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function replayCheckpointPath(path: string): string {
  return path.endsWith('.json') ? `${path.slice(0, -5)}.replay-checkpoint.json` : `${path}.replay-checkpoint.json`;
}

async function readReplayCheckpoint(path: string, databaseIdentity: string, canonicalDatabasePath: string): Promise<number> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as FeedReplayCheckpoint;
    if (!value || value.version !== 1 || value.databaseIdentity !== databaseIdentity ||
        value.canonicalDatabasePath !== canonicalDatabasePath || !Number.isSafeInteger(value.lastAcceptedYellowstoneSlot) ||
        value.lastAcceptedYellowstoneSlot < 0 || !Number.isSafeInteger(value.updatedAtMs) || value.updatedAtMs < 0) {
      throw new Error('FEED_REPLAY_CHECKPOINT_INVALID');
    }
    return value.lastAcceptedYellowstoneSlot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

/** Persist a coarse replay cursor while ACTIVE; old cursors only cause safe duplicate replay. */
export async function persistFeedReplayCheckpoint(path: string, sessionId: string, slot: number, now = Date.now()): Promise<void> {
  if (!Number.isSafeInteger(slot) || slot < 0 || !Number.isSafeInteger(now) || now < 0) throw new Error('FEED_REPLAY_CHECKPOINT_INVALID');
  const current = await readRecord(path);
  if (!current || current.status !== 'ACTIVE' || current.sessionId !== sessionId) throw new Error('FEED_SESSION_LATCH_OWNERSHIP_MISMATCH');
  const checkpointPath = replayCheckpointPath(path);
  const priorSlot = await readReplayCheckpoint(checkpointPath, current.databaseIdentity, current.canonicalDatabasePath);
  if (slot < priorSlot) throw new Error('FEED_REPLAY_CHECKPOINT_REGRESSION');
  await writeAtomic(checkpointPath, Object.freeze({ version: 1, databaseIdentity: current.databaseIdentity,
    canonicalDatabasePath: current.canonicalDatabasePath, lastAcceptedYellowstoneSlot: slot, updatedAtMs: now }));
}

/** Create a durable ACTIVE sentinel before opening provider subscriptions. Any old sentinel is unresolved. */
export async function beginFeedSession(path: string, databaseIdentity: string, canonicalDatabasePath: string, now = Date.now()): Promise<FeedSessionStart> {
  if (typeof databaseIdentity !== 'string' || !databaseIdentity || typeof canonicalDatabasePath !== 'string' || !canonicalDatabasePath) throw new Error('FEED_SESSION_DATABASE_IDENTITY_REQUIRED');
  const lastAcceptedYellowstoneSlot = await readReplayCheckpoint(replayCheckpointPath(path), databaseIdentity, canonicalDatabasePath);
  const prior = await readRecord(path);
  if (prior) {
    if (prior.databaseIdentity !== databaseIdentity) throw new Error('FEED_SESSION_DATABASE_IDENTITY_MISMATCH');
    const incident = prior.incident ?? Object.freeze({ reason: 'FEED_SESSION_UNCLEAN_SHUTDOWN',
      detail: `Previous feed session ${prior.sessionId} did not close cleanly`, observedAtMs: now });
    await writeAtomic(path, { version: 1, databaseIdentity, canonicalDatabasePath: prior.canonicalDatabasePath,
      status: 'INCIDENT', sessionId: prior.sessionId, openedAtMs: prior.openedAtMs, incident });
    return { sessionId: null, incident, lastAcceptedYellowstoneSlot };
  }
  const sessionId = randomUUID();
  await writeAtomic(path, { version: 1, databaseIdentity, canonicalDatabasePath, status: 'ACTIVE', sessionId, openedAtMs: now });
  return { sessionId, incident: null, lastAcceptedYellowstoneSlot };
}

/** Replace the ACTIVE sentinel before Store persistence; this latch survives Store queue/disk failures. */
export async function persistFeedSessionIncident(path: string, sessionId: string, incident: FeedSessionIncident): Promise<void> {
  const current = await readRecord(path);
  if (!current || current.status !== 'ACTIVE' || current.sessionId !== sessionId) throw new Error('FEED_SESSION_LATCH_OWNERSHIP_MISMATCH');
  await writeAtomic(path, { ...current, status: 'INCIDENT', incident: Object.freeze({ ...incident }) });
}

/** Remove only this session's clean ACTIVE marker, after Feed has drained admitted ingress. */
export async function closeFeedSession(path: string, sessionId: string, lastAcceptedYellowstoneSlot?: number, now = Date.now()): Promise<void> {
  const current = await readRecord(path);
  if (!current) return;
  if (current.status !== 'ACTIVE' || current.sessionId !== sessionId) throw new Error('FEED_SESSION_LATCH_NOT_CLEAN_ACTIVE');
  if (lastAcceptedYellowstoneSlot !== undefined) await persistFeedReplayCheckpoint(path, sessionId, lastAcceptedYellowstoneSlot, now);
  await unlink(path);
  await syncDirectory(path);
}
