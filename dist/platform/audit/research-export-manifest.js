import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
function isValidSignerId(value) {
    return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}
function isValidExternalAnchor(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const anchor = value;
    return (anchor.mode === undefined || anchor.mode === 'EXTERNAL_WITNESS_ROOT') && typeof anchor.witnessRootSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(anchor.witnessRootSha256) && typeof anchor.anchorReference === 'string' &&
        anchor.anchorReference.length >= 1 && anchor.anchorReference.length <= 512 &&
        !/[\u0000-\u001f\u007f]/.test(anchor.anchorReference);
}
async function hashFile(path) {
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(path)) {
        bytes += chunk.length;
        hash.update(chunk);
    }
    return { sha256: hash.digest('hex'), bytes };
}
async function stableSnapshot(path) {
    const before = await hashFile(path);
    const facts = inventory(path);
    const after = await hashFile(path);
    if (before.sha256 !== after.sha256 || before.bytes !== after.bytes)
        throw new Error('RESEARCH_EXPORT_SNAPSHOT_CHANGED_DURING_READ');
    return { ...after, facts };
}
function inventory(path) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
        if (!tables.has('audit') || !tables.has('state'))
            throw new Error('RESEARCH_EXPORT_SCHEMA_UNSUPPORTED');
        const aggregateQuery = db.prepare('SELECT COUNT(*) AS count, MIN(id) AS first_id, MAX(id) AS last_id, MIN(at) AS first_at, MAX(at) AS last_at FROM audit');
        aggregateQuery.setReadBigInts(true);
        const aggregate = aggregateQuery.get();
        const countsQuery = db.prepare('SELECT event, COUNT(*) AS count FROM audit GROUP BY event ORDER BY event LIMIT 10001');
        countsQuery.setReadBigInts(true);
        const counts = countsQuery.all();
        if (counts.length > 10_000)
            throw new Error('RESEARCH_EXPORT_EVENT_TYPE_LIMIT');
        const countsByEvent = Object.create(null);
        const prunedCountsByEvent = Object.create(null);
        for (const row of counts) {
            if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(row.event))
                throw new Error('RESEARCH_EXPORT_AUDIT_EVENT_INVALID');
            countsByEvent[row.event] = safeInteger(row.count);
        }
        if (Object.values(countsByEvent).reduce((sum, count) => sum + BigInt(count), 0n) !==
            BigInt(safeInteger(aggregate.count)))
            throw new Error('RESEARCH_EXPORT_AUDIT_COUNTS_MISMATCH');
        let retentionLedgerStatus = 'UNAVAILABLE';
        let pruneBatchCount = 0, prunedRowCount = 0, omittedPruneBatchCount = 0;
        const knownPrunedIdRanges = [];
        if (tables.has('audit_prune_ledger')) {
            const totalsQuery = db.prepare('SELECT COUNT(*) AS batches, COALESCE(SUM(deleted_row_count),0) AS rows FROM audit_prune_ledger');
            totalsQuery.setReadBigInts(true);
            const totals = totalsQuery.get();
            pruneBatchCount = safeInteger(totals.batches);
            prunedRowCount = safeInteger(totals.rows);
            const rangesQuery = db.prepare('SELECT id_ranges_json,event_counts_json FROM audit_prune_ledger ORDER BY id');
            let consumedBytes = 0, scannedBatches = 0, knownPrunedRows = 0n;
            retentionLedgerStatus = 'AVAILABLE';
            for (const item of rangesQuery.iterate()) {
                scannedBatches++;
                const bytes = Buffer.byteLength(item.id_ranges_json) + Buffer.byteLength(item.event_counts_json);
                if (consumedBytes + bytes > 512 * 1024) {
                    retentionLedgerStatus = 'TRUNCATED';
                    break;
                }
                let ranges, eventCounts;
                try {
                    ranges = JSON.parse(item.id_ranges_json);
                    eventCounts = JSON.parse(item.event_counts_json);
                }
                catch {
                    throw new Error('RESEARCH_EXPORT_RETENTION_LEDGER_INVALID');
                }
                if (!Array.isArray(ranges) || ranges.length === 0 || knownPrunedIdRanges.length + ranges.length > 10_000 ||
                    !eventCounts || typeof eventCounts !== 'object' || Array.isArray(eventCounts)) {
                    retentionLedgerStatus = 'TRUNCATED';
                    break;
                }
                const eventEntries = Object.entries(eventCounts);
                const newEventTypes = eventEntries.filter(([event]) => !Object.hasOwn(prunedCountsByEvent, event)).length;
                if (newEventTypes + Object.keys(prunedCountsByEvent).length > 10_000) {
                    retentionLedgerStatus = 'TRUNCATED';
                    break;
                }
                for (const [event, count] of eventEntries) {
                    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(event) || !Number.isSafeInteger(count) || Number(count) < 1) {
                        throw new Error('RESEARCH_EXPORT_RETENTION_LEDGER_INVALID');
                    }
                    const sum = BigInt(prunedCountsByEvent[event] ?? 0) + BigInt(Number(count));
                    if (sum > BigInt(Number.MAX_SAFE_INTEGER))
                        throw new Error('RESEARCH_EXPORT_INTEGER_OUT_OF_RANGE');
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
                if (eventEntries.reduce((sum, [, count]) => sum + BigInt(Number(count)), 0n) !== batchRangeCount)
                    throw new Error('RESEARCH_EXPORT_RETENTION_LEDGER_INVALID');
                consumedBytes += bytes;
            }
            knownPrunedIdRanges.sort((a, b) => a[0] - b[0]);
            for (let i = 1; i < knownPrunedIdRanges.length; i++) {
                if (knownPrunedIdRanges[i][0] <= knownPrunedIdRanges[i - 1][1])
                    throw new Error('RESEARCH_EXPORT_RETENTION_LEDGER_INVALID');
            }
            omittedPruneBatchCount = pruneBatchCount - scannedBatches + (retentionLedgerStatus === 'TRUNCATED' ? 1 : 0);
            if (omittedPruneBatchCount < 0)
                throw new Error('RESEARCH_EXPORT_RETENTION_LEDGER_INVALID');
            if (retentionLedgerStatus === 'AVAILABLE' && (knownPrunedRows !== BigInt(prunedRowCount) ||
                Object.values(prunedCountsByEvent).reduce((sum, count) => sum + BigInt(count), 0n) !== BigInt(prunedRowCount))) {
                throw new Error('RESEARCH_EXPORT_RETENTION_LEDGER_INVALID');
            }
        }
        const stateRow = db.prepare('SELECT body FROM state WHERE id=1').get();
        let knownCaptureLoss = {
            status: 'NONE_RECORDED', failureCount: 0, recoveryRequired: false,
        };
        if (!stateRow?.body)
            knownCaptureLoss = { status: 'INVALID_OR_UNAVAILABLE', failureCount: null, recoveryRequired: null };
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
            }
            catch {
                knownCaptureLoss = { status: 'INVALID_OR_UNAVAILABLE', failureCount: null, recoveryRequired: null };
            }
        }
        const toNumber = (value) => value === null ? null : safeInteger(value);
        return {
            auditCoverage: {
                retainedRowCount: safeInteger(aggregate.count),
                firstRetainedId: toNumber(aggregate.first_id), lastRetainedId: toNumber(aggregate.last_id),
                firstRetainedAtMs: toNumber(aggregate.first_at), lastRetainedAtMs: toNumber(aggregate.last_at),
                countsByEvent: Object.freeze(countsByEvent), completeness: 'UNKNOWN',
                prunedCountsByEvent: Object.freeze(prunedCountsByEvent),
                completenessReason: 'AUDIT_ROWS_MAY_HAVE_BEEN_PRUNED_OR_LOST',
                retentionLedgerStatus, pruneBatchCount, prunedRowCount,
                knownPrunedIdRanges: Object.freeze(knownPrunedIdRanges.map(range => Object.freeze(range))),
                omittedPruneBatchCount,
            },
            knownCaptureLoss,
        };
    }
    finally {
        db.close();
    }
}
function safeInteger(value) {
    if (typeof value === 'bigint') {
        if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
            throw new Error('RESEARCH_EXPORT_INTEGER_OUT_OF_RANGE');
        return Number(value);
    }
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('RESEARCH_EXPORT_INTEGER_OUT_OF_RANGE');
    return value;
}
export function computeManifestDigest(manifest) {
    const canonical = {
        schemaVersion: manifest.schemaVersion,
        createdAt: manifest.createdAt,
        snapshotFile: manifest.snapshotFile,
        snapshotBytes: manifest.snapshotBytes,
        snapshotSha256: manifest.snapshotSha256,
        auditCoverage: manifest.auditCoverage,
        knownCaptureLoss: manifest.knownCaptureLoss,
        trust: {
            snapshotHash: manifest.trust.snapshotHash,
            externalAnchor: manifest.trust.externalAnchor,
        },
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
export async function createResearchExportManifest(snapshotPath, manifestPath = `${snapshotPath}.manifest.json`, options) {
    if ((options?.signingKey === undefined) !== (options?.signerId === undefined) ||
        (options?.signingKey !== undefined && (typeof options.signingKey !== 'string' || options.signingKey.length === 0)) ||
        (options?.signerId !== undefined && !isValidSignerId(options.signerId))) {
        throw new Error('INVALID_MANIFEST_SIGNING_CONFIGURATION');
    }
    if (options?.externalAnchor !== undefined && !isValidExternalAnchor(options.externalAnchor)) {
        throw new Error('INVALID_EXTERNAL_ANCHOR');
    }
    const snapshot = resolve(snapshotPath), destination = resolve(manifestPath);
    if (snapshot === destination)
        throw new Error('RESEARCH_EXPORT_PATH_COLLISION');
    const { sha256, bytes, facts } = await stableSnapshot(snapshot);
    const externalAnchor = options?.externalAnchor
        ? {
            mode: 'EXTERNAL_WITNESS_ROOT',
            witnessRootSha256: options.externalAnchor.witnessRootSha256,
            anchorReference: options.externalAnchor.anchorReference,
        }
        : 'NONE';
    let manifestAuthentication = 'NONE';
    const createdAt = new Date().toISOString();
    const snapshotFile = basename(snapshot);
    if (options?.signingKey !== undefined && options.signerId !== undefined) {
        const digest = computeManifestDigest({
            schemaVersion: 'sylph-research-export-manifest/1',
            createdAt,
            snapshotFile,
            snapshotBytes: bytes,
            snapshotSha256: sha256,
            ...facts,
            trust: { snapshotHash: 'SHA256', externalAnchor },
        });
        const signatureHex = createHmac('sha256', options.signingKey).update(digest).digest('hex');
        manifestAuthentication = {
            mode: 'HMAC_SHA256',
            signerId: options.signerId,
            signatureHex,
        };
    }
    const manifest = Object.freeze({
        schemaVersion: 'sylph-research-export-manifest/1',
        createdAt,
        snapshotFile,
        snapshotBytes: bytes,
        snapshotSha256: sha256,
        ...facts,
        trust: {
            snapshotHash: 'SHA256',
            manifestAuthentication,
            externalAnchor,
        },
    });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
        await rename(temporary, destination);
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
    return manifest;
}
export async function verifyResearchExportManifest(snapshotPath, manifestPath = `${snapshotPath}.manifest.json`, options) {
    let manifest;
    try {
        const sidecarStat = await stat(manifestPath);
        if (!sidecarStat.isFile() || sidecarStat.size > MAX_MANIFEST_BYTES)
            return { valid: false, reason: 'MANIFEST_INVALID' };
        manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (!manifest || manifest.schemaVersion !== 'sylph-research-export-manifest/1' ||
            !/^[a-f0-9]{64}$/.test(manifest.snapshotSha256) || !Number.isSafeInteger(manifest.snapshotBytes) || manifest.snapshotBytes < 0 ||
            !Number.isFinite(Date.parse(manifest.createdAt)) || manifest.snapshotFile !== basename(resolve(snapshotPath)) ||
            manifest.auditCoverage?.completeness !== 'UNKNOWN' || manifest.auditCoverage.completenessReason !== 'AUDIT_ROWS_MAY_HAVE_BEEN_PRUNED_OR_LOST' ||
            manifest.trust?.snapshotHash !== 'SHA256' ||
            !['NONE_RECORDED', 'RECORDED', 'INVALID_OR_UNAVAILABLE'].includes(manifest.knownCaptureLoss?.status) ||
            !Number.isSafeInteger(manifest.auditCoverage.retainedRowCount) || manifest.auditCoverage.retainedRowCount < 0)
            return { valid: false, reason: 'MANIFEST_INVALID' };
        const auth = manifest.trust?.manifestAuthentication;
        const anchor = manifest.trust?.externalAnchor;
        const authValid = auth === 'NONE' || (auth && typeof auth === 'object' && auth.mode === 'HMAC_SHA256' &&
            isValidSignerId(auth.signerId) &&
            typeof auth.signatureHex === 'string' && /^[a-f0-9]{64}$/.test(auth.signatureHex));
        const anchorValid = anchor === 'NONE' || (anchor && typeof anchor === 'object' && anchor.mode === 'EXTERNAL_WITNESS_ROOT' && isValidExternalAnchor(anchor));
        if (!authValid || !anchorValid)
            return { valid: false, reason: 'MANIFEST_INVALID' };
        // Verify cryptographic signature if authentication is present
        if (auth && typeof auth === 'object' && auth.mode === 'HMAC_SHA256') {
            if (typeof options?.verificationKey !== 'string' || options.verificationKey.length === 0) {
                return { valid: false, reason: 'SIGNATURE_INVALID' };
            }
            const digest = computeManifestDigest({
                schemaVersion: manifest.schemaVersion,
                createdAt: manifest.createdAt,
                snapshotFile: manifest.snapshotFile,
                snapshotBytes: manifest.snapshotBytes,
                snapshotSha256: manifest.snapshotSha256,
                auditCoverage: manifest.auditCoverage,
                knownCaptureLoss: manifest.knownCaptureLoss,
                trust: {
                    snapshotHash: 'SHA256',
                    externalAnchor: manifest.trust.externalAnchor,
                },
            });
            const expectedSig = createHmac('sha256', options.verificationKey).update(digest).digest('hex');
            if (!timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(auth.signatureHex, 'hex'))) {
                return { valid: false, reason: 'SIGNATURE_INVALID' };
            }
        }
    }
    catch {
        return { valid: false, reason: 'MANIFEST_INVALID' };
    }
    let snapshot;
    try {
        snapshot = await stableSnapshot(resolve(snapshotPath));
    }
    catch {
        return { valid: false, reason: 'SNAPSHOT_INVENTORY_MISMATCH' };
    }
    if (snapshot.sha256 !== manifest.snapshotSha256 || snapshot.bytes !== manifest.snapshotBytes)
        return { valid: false, reason: 'SNAPSHOT_HASH_MISMATCH' };
    if (JSON.stringify(snapshot.facts) !== JSON.stringify({ auditCoverage: manifest.auditCoverage, knownCaptureLoss: manifest.knownCaptureLoss })) {
        return { valid: false, reason: 'SNAPSHOT_INVENTORY_MISMATCH' };
    }
    const auth = manifest.trust.manifestAuthentication;
    const anchor = manifest.trust.externalAnchor;
    const result = {
        valid: true,
        snapshotSha256: snapshot.sha256,
        retainedAuditRows: manifest.auditCoverage.retainedRowCount,
        ...(auth && typeof auth === 'object' && auth.mode === 'HMAC_SHA256'
            ? { authentication: { signerId: auth.signerId, verified: true } }
            : {}),
        ...(anchor && typeof anchor === 'object' && anchor.mode === 'EXTERNAL_WITNESS_ROOT'
            ? { externalAnchor: { witnessRootSha256: anchor.witnessRootSha256, anchorReference: anchor.anchorReference } }
            : {}),
    };
    return result;
}
//# sourceMappingURL=research-export-manifest.js.map