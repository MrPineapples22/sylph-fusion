import { randomUUID } from 'node:crypto';
import { open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
/** Resolve aliases to a shared per-user latch key using the OS file identity. */
export async function feedSessionLatchLocation(databasePath, appDataRoot) {
    const canonicalDatabasePath = await realpath(databasePath);
    const metadata = await stat(canonicalDatabasePath, { bigint: true });
    if (!metadata.isFile() || metadata.ino <= 0n)
        throw new Error('FEED_SESSION_DATABASE_FILE_ID_UNAVAILABLE');
    const normalizedPath = process.platform === 'win32' ? canonicalDatabasePath.toLocaleLowerCase('en-US') : canonicalDatabasePath;
    const databaseIdentity = `${metadata.dev.toString()}:${metadata.ino.toString()}`;
    const key = createHash('sha256').update(databaseIdentity).digest('hex');
    const configuredRoot = appDataRoot !== undefined ? appDataRoot : process.env.LOCALAPPDATA;
    const root = configuredRoot ? configuredRoot : join(homedir(), '.local', 'state');
    if (!isAbsolute(root))
        throw new Error('FEED_SESSION_APPDATA_ROOT_MUST_BE_ABSOLUTE');
    return Object.freeze({
        path: join(resolve(root), 'SylphFusion', 'feed-session-latches', `${key}.json`),
        databaseIdentity,
        canonicalDatabasePath: normalizedPath,
    });
}
async function syncDirectory(path) {
    let handle;
    try {
        handle = await open(dirname(path), 'r');
    }
    catch (error) {
        // Windows does not expose directory handles through Node's fs.open; the
        // file itself was flushed before the atomic rename. On POSIX, directory
        // metadata is flushed as well.
        if (process.platform === 'win32' && ['EISDIR', 'EPERM', 'EACCES', 'EINVAL'].includes(error.code ?? ''))
            return;
        throw error;
    }
    try {
        try {
            await handle.sync();
        }
        catch (error) {
            // Windows may permit opening a directory handle but reject FlushFileBuffers
            // through Node. The incident file itself was fsynced before its rename.
            if (!(process.platform === 'win32' && ['EISDIR', 'EPERM', 'EACCES', 'EINVAL'].includes(error.code ?? '')))
                throw error;
        }
    }
    finally {
        await handle.close();
    }
}
async function writeAtomic(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.${randomUUID()}.feed-session.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
        await handle.writeFile(JSON.stringify(value));
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    await rename(temporary, path);
    await syncDirectory(path);
}
async function readRecord(path) {
    try {
        const value = JSON.parse(await readFile(path, 'utf8'));
        if (!value || value.version !== 1 || typeof value.databaseIdentity !== 'string' || !value.databaseIdentity ||
            typeof value.canonicalDatabasePath !== 'string' || !value.canonicalDatabasePath || !['ACTIVE', 'INCIDENT'].includes(value.status) ||
            typeof value.sessionId !== 'string' || !value.sessionId || !Number.isSafeInteger(value.openedAtMs) || value.openedAtMs < 0 ||
            (value.status === 'INCIDENT' && (!value.incident || typeof value.incident.reason !== 'string' ||
                !Number.isSafeInteger(value.incident.observedAtMs) || value.incident.observedAtMs < 0))) {
            throw new Error('FEED_SESSION_LATCH_INVALID');
        }
        return value;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    }
}
/** Create a durable ACTIVE sentinel before opening provider subscriptions. Any old sentinel is unresolved. */
export async function beginFeedSession(path, databaseIdentity, canonicalDatabasePath, now = Date.now()) {
    if (typeof databaseIdentity !== 'string' || !databaseIdentity || typeof canonicalDatabasePath !== 'string' || !canonicalDatabasePath)
        throw new Error('FEED_SESSION_DATABASE_IDENTITY_REQUIRED');
    const prior = await readRecord(path);
    if (prior) {
        if (prior.databaseIdentity !== databaseIdentity)
            throw new Error('FEED_SESSION_DATABASE_IDENTITY_MISMATCH');
        const incident = prior.incident ?? Object.freeze({ reason: 'FEED_SESSION_UNCLEAN_SHUTDOWN',
            detail: `Previous feed session ${prior.sessionId} did not close cleanly`, observedAtMs: now });
        await writeAtomic(path, { version: 1, databaseIdentity, canonicalDatabasePath: prior.canonicalDatabasePath,
            status: 'INCIDENT', sessionId: prior.sessionId, openedAtMs: prior.openedAtMs, incident });
        return { sessionId: null, incident };
    }
    const sessionId = randomUUID();
    await writeAtomic(path, { version: 1, databaseIdentity, canonicalDatabasePath, status: 'ACTIVE', sessionId, openedAtMs: now });
    return { sessionId, incident: null };
}
/** Replace the ACTIVE sentinel before Store persistence; this latch survives Store queue/disk failures. */
export async function persistFeedSessionIncident(path, sessionId, incident) {
    const current = await readRecord(path);
    if (!current || current.status !== 'ACTIVE' || current.sessionId !== sessionId)
        throw new Error('FEED_SESSION_LATCH_OWNERSHIP_MISMATCH');
    await writeAtomic(path, { ...current, status: 'INCIDENT', incident: Object.freeze({ ...incident }) });
}
/** Remove only this session's clean ACTIVE marker, after Feed has drained admitted ingress. */
export async function closeFeedSession(path, sessionId) {
    const current = await readRecord(path);
    if (!current)
        return;
    if (current.status !== 'ACTIVE' || current.sessionId !== sessionId)
        throw new Error('FEED_SESSION_LATCH_NOT_CLEAN_ACTIVE');
    await unlink(path);
    await syncDirectory(path);
}
//# sourceMappingURL=feed-session-latch.js.map