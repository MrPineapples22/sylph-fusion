import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import { dirname, join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashCanonical } from '../pipeline/canonical-hashing.js';
const EVENT = 'runtime_telemetry_observed_v3';
const FILETIME_EPOCH_100NS = 116444736000000000n;
/** Resolve the bundled Win32 helper from the compiled module's package root. */
export function runtimeTelemetryWindowsProcessHelperPath(moduleUrl = import.meta.url) {
    const packageRoot = dirname(dirname(dirname(dirname(fileURLToPath(moduleUrl)))));
    return join(packageRoot, 'scripts', 'windows-process-identity.ps1');
}
/** Obtain this process identity from a Win32 process handle, never from caller options. */
function resolveCurrentProcessImageIdentity() {
    if (process.platform !== 'win32' || !Number.isSafeInteger(process.pid) || process.pid < 1 || process.pid > 2_147_483_647) {
        throw new Error('C5_PROCESS_IMAGE_IDENTITY_UNAVAILABLE');
    }
    try {
        const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
        if (!systemRoot || !win32.isAbsolute(systemRoot))
            throw new Error('Windows PowerShell path unavailable');
        const powershell = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const helperPath = runtimeTelemetryWindowsProcessHelperPath();
        const packageRoot = dirname(dirname(helperPath));
        const output = execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', helperPath, '-ProcessId', String(process.pid)], {
            cwd: packageRoot, encoding: 'utf8', timeout: 10_000,
            maxBuffer: 64 * 1024, windowsHide: true,
        }).trim();
        const observed = JSON.parse(output);
        if (!observed || Object.keys(observed).sort().join(',') !== 'creationFileTime100ns,imagePath,processId,processStartedAtMs' ||
            observed.processId !== process.pid || !Number.isSafeInteger(observed.processStartedAtMs) || observed.processStartedAtMs < 1 ||
            typeof observed.creationFileTime100ns !== 'string' || !/^[1-9][0-9]{0,19}$/.test(observed.creationFileTime100ns) ||
            typeof observed.imagePath !== 'string' || observed.imagePath.length < 4 || observed.imagePath.length > 32_767 ||
            observed.imagePath.includes('\0') || !win32.isAbsolute(observed.imagePath))
            throw new Error('Invalid Win32 process identity');
        const fileTime = BigInt(observed.creationFileTime100ns);
        const delta = fileTime - FILETIME_EPOCH_100NS;
        if (delta < 0n || fileTime > 9223372036854775807n || Number(delta / 10000n) !== observed.processStartedAtMs) {
            throw new Error('Win32 process creation time mismatch');
        }
        return { ...observed, processImageIdentity: { imagePath: observed.imagePath,
                executableSha256: hashStableExecutable(observed.imagePath), creationFileTime100ns: observed.creationFileTime100ns } };
    }
    catch {
        throw new Error('C5_PROCESS_IMAGE_IDENTITY_UNAVAILABLE');
    }
}
function hashStableExecutable(path) {
    const initialStat = statSync(path, { bigint: true });
    const before = initialStat;
    if (!initialStat.isFile() || before.size < 1n || before.size > 512n * 1024n * 1024n)
        throw new Error('Executable outside hash bounds');
    const fd = openSync(path, 'r');
    try {
        const openedBefore = fstatSync(fd, { bigint: true });
        if (!sameFileVersion(before, openedBefore))
            throw new Error('Executable changed before hashing');
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let total = 0n;
        while (true) {
            const bytes = readSync(fd, buffer, 0, buffer.length, null);
            if (bytes === 0)
                break;
            total += BigInt(bytes);
            if (total > 512n * 1024n * 1024n)
                throw new Error('Executable exceeds hash bound');
            hash.update(buffer.subarray(0, bytes));
        }
        const openedAfter = fstatSync(fd, { bigint: true });
        const pathAfter = statSync(path, { bigint: true });
        if (total !== before.size || !sameFileVersion(openedBefore, openedAfter) || !sameFileVersion(openedAfter, pathAfter)) {
            throw new Error('Executable changed while hashing');
        }
        return hash.digest('hex');
    }
    finally {
        closeSync(fd);
    }
}
function sameFileVersion(a, b) {
    return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
const nonzeroId = (bytes) => {
    let id;
    do {
        id = randomBytes(bytes).toString('hex');
    } while (/^0+$/.test(id));
    return id;
};
/** Internal ingress observer. It has no decision, delivery or wallet capability.
 * Capture is explicit, bounded and serialized. A failed signing attempt retains
 * its exact immutable snapshot for retry; new observations enter the next batch.
 * Returned JSON is the artifact; callers choose its publication destination. */
export class RuntimeTelemetryCapture {
    #store;
    #options;
    #runtimeInstanceId = nonzeroId(16);
    #spans = [];
    #captureStartedAtMs = Date.now();
    #active = 0;
    #overflow = false;
    #pending = null;
    #capture = null;
    constructor(store, options) {
        this.#store = store;
        this.#options = Object.freeze({ ...options });
    }
    async observe(operation, succeeded) {
        let trace;
        try {
            trace = { traceId: nonzeroId(16), rootSpanId: nonzeroId(8) };
        }
        catch {
            this.#overflow = true;
            trace = { traceId: '0'.repeat(32), rootSpanId: '0'.repeat(16) };
        }
        return this.measure('ingress.observation', trace, () => operation(trace), succeeded);
    }
    async measure(name, trace, operation, succeeded = () => true) {
        const startedAtNs = process.hrtime.bigint().toString();
        this.#active++;
        let status = 'ERROR';
        try {
            const result = await operation();
            status = succeeded(result) ? 'OK' : 'ERROR';
            return result;
        }
        finally {
            this.#active--;
            // Never let a broken observer change the result of authoritative work.
            try {
                if (this.#spans.length >= 128) {
                    this.#overflow = true;
                }
                else
                    this.#spans.push(Object.freeze({ spanId: name === 'ingress.observation' ? trace.rootSpanId : nonzeroId(8), traceId: trace.traceId,
                        parentSpanId: name === 'ingress.observation' ? null : trace.rootSpanId, name,
                        startedAtNs, endedAtNs: process.hrtime.bigint().toString(), status }));
            }
            catch {
                this.#overflow = true;
            }
        }
    }
    capture() {
        if (this.#capture)
            return this.#capture;
        const promise = this.#attest();
        this.#capture = promise;
        void promise.finally(() => { this.#capture = null; }).catch(() => { });
        return promise;
    }
    async #attest() {
        const { sourceCommitSha, sourceTreeSha, signer, trustedPublicKeyPem } = this.#options;
        if (!/^[a-f0-9]{40}$/.test(sourceCommitSha) || !/^[a-f0-9]{40}$/.test(sourceTreeSha))
            throw new Error('C5_SOURCE_IDENTITY_INVALID');
        if (!signer || typeof signer.signRuntimeTelemetryRoot !== 'function')
            throw new Error('C5_RUNTIME_SIGNER_MISSING');
        if (typeof trustedPublicKeyPem !== 'string' || !trustedPublicKeyPem.trim())
            throw new Error('C5_RUNTIME_ATTESTATION_TRUST_ROOT_MISSING');
        const publicKey = createPublicKey(trustedPublicKeyPem);
        if (publicKey.asymmetricKeyType !== 'ed25519')
            throw new Error('C5_RUNTIME_ATTESTATION_KEY_INVALID');
        if (this.#overflow)
            throw new Error('C5_CAPTURE_OVERFLOW');
        if (this.#active)
            throw new Error('C5_CAPTURE_OPERATIONS_PENDING');
        await this.#store.assertDurable();
        const storeInstanceId = await this.#store.getRuntimeStoreInstanceId();
        if (!this.#pending) {
            if (!this.#spans.length)
                throw new Error('C5_CAPTURE_EMPTY');
            // There are no awaits between the final state check and snapshot sealing.
            if (this.#active || this.#overflow)
                throw new Error('C5_CAPTURE_OPERATIONS_PENDING');
            const processIdentity = resolveCurrentProcessImageIdentity();
            if (processIdentity.processId !== process.pid)
                throw new Error('C5_PROCESS_IMAGE_IDENTITY_UNAVAILABLE');
            const body = Object.freeze({ schemaVersion: 'SYLPH_RUNTIME_TELEMETRY_STORE_V3', storeInstanceId,
                runtimeInstanceId: this.#runtimeInstanceId, sourceCommitSha, sourceTreeSha, processId: process.pid,
                processStartedAtMs: processIdentity.processStartedAtMs, processImageIdentity: processIdentity.processImageIdentity,
                captureStartedAtMs: this.#captureStartedAtMs,
                captureEndedAtMs: Date.now(), spans: Object.freeze(this.#spans.splice(0)) });
            this.#captureStartedAtMs = Date.now();
            this.#pending = { body, storeEventId: `runtime:${hashCanonical(body)}` };
        }
        const { body, storeEventId } = this.#pending;
        if (body.storeInstanceId !== storeInstanceId)
            throw new Error('C5_DURABLE_STORE_IDENTITY_MISMATCH');
        const expectedBody = JSON.stringify(body);
        const expectedHash = createHash('sha256').update(`${EVENT}:${expectedBody}`).digest('hex');
        const result = await this.#store.appendAuditEvent(EVENT, body, storeEventId);
        const row = await this.#store.getAuditEventByStableId(storeEventId);
        if (!row || row.pruned || row.id !== result.auditId || row.event !== EVENT || row.body !== expectedBody || row.eventHash !== expectedHash) {
            throw new Error('C5_DURABLE_STORE_RECORD_MISMATCH');
        }
        const { schemaVersion: _schemaVersion, storeInstanceId: _storeInstanceId, ...observation } = body;
        const payload = { schemaVersion: 'SYLPH_RUNTIME_TELEMETRY_V3', provenanceClass: 'REAL_RUNTIME', ...observation,
            nodeVersion: process.version, durability: { barrier: 'FSYNC_COMMITTED', storeInstanceId,
                storeEventId, storeAuditId: row.id, storeEventHash: expectedHash } };
        // All payload strings are controlled ASCII, so the runtime canonical hash
        // equals V10; the independent verifier tests that contract on emitted bytes.
        const root = hashCanonical(payload);
        const signatureBase64 = await signer.signRuntimeTelemetryRoot(root);
        if (typeof signatureBase64 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signatureBase64))
            throw new Error('C5_ATTESTATION_SIGNATURE_INVALID');
        const signature = Buffer.from(signatureBase64, 'base64');
        if (signature.toString('base64') !== signatureBase64 || !verify(null, Buffer.from(root, 'hex'), publicKey, signature))
            throw new Error('C5_ATTESTATION_SIGNATURE_INVALID');
        const attested = { ...payload, attestation: { algorithm: 'Ed25519', signatureBase64 } };
        const artifact = { ...attested, evidenceHash: hashCanonical(attested) };
        this.#pending = null;
        // Defensive JSON snapshot: caller mutation cannot change retained evidence.
        return Object.freeze(JSON.parse(JSON.stringify(artifact)));
    }
}
//# sourceMappingURL=runtime-telemetry.js.map