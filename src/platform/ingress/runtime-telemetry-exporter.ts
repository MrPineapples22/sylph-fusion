import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RuntimeTelemetryOptions } from './runtime-telemetry.js';

export interface RuntimeTelemetryExportOptions extends RuntimeTelemetryOptions {
  readonly artifactPath: string;
  readonly captureIntervalMs?: number;
  readonly captureTimeoutMs?: number;
}
type CapturePort = { captureRuntimeTelemetry(): Promise<Readonly<Record<string, unknown>>> };

/** Host-injected runtime composition; has no wallet or execution dependency.
 * Only a verified returned artifact can reach publication. Each capture and
 * shutdown drain is bounded even if the remote attestation service stalls. */
export class RuntimeTelemetryExporter {
  readonly #ingress: CapturePort;
  readonly #path: string;
  readonly #timeoutMs: number;
  readonly #onError: (code: string) => void;
  readonly #timer: NodeJS.Timeout;
  readonly #rename: typeof rename;
  #running: Promise<void> | null = null;
  #workPending = false;
  #publicationPending = false;
  #closing = false;
  #closePromise: Promise<void> | null = null;
  #unpublished: Readonly<Record<string, unknown>> | null = null;

  constructor(ingress: CapturePort, options: RuntimeTelemetryExportOptions, onError: (code: string) => void = () => {},
    /** Owned filesystem fault fixtures; production uses the default implementation. */
    publication: { rename: typeof rename } = { rename }) {
    const interval = options.captureIntervalMs ?? 250;
    this.#timeoutMs = options.captureTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(interval) || interval < 25 || interval > 60_000 ||
        !Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 25 || this.#timeoutMs > 30_000 ||
        typeof options.artifactPath !== 'string' || !options.artifactPath.trim()) throw new Error('C5_EXPORT_CONFIGURATION_INVALID');
    this.#ingress = ingress;
    this.#path = resolve(options.artifactPath);
    this.#onError = onError;
    this.#rename = publication.rename;
    this.#timer = setInterval(() => { void this.flush(); }, interval);
    this.#timer.unref();
  }

  flush(): Promise<void> {
    if (this.#closing) return this.#closePromise ?? Promise.resolve();
    return this.#flush();
  }

  #flush(): Promise<void> {
    if (this.#running) return this.#running;
    // A timeout does not cancel an injected service. Do not queue more work
    // behind a stalled signer or filesystem operation.
    if (this.#workPending) return Promise.resolve();
    this.#workPending = true;
    const controller = new AbortController();
    let publicationCommitted = false;
    let timeout: NodeJS.Timeout;
    const expired = new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => {
        // An issued rename cannot be revoked. Once publication is committed,
        // ending the bounded wait is not a failed/timed-out capture. Keep its
        // work fence until the filesystem reports success or failure.
        if (publicationCommitted) { resolve(); return; }
        controller.abort(); reject(new Error('C5_CAPTURE_TIMEOUT'));
      }, this.#timeoutMs);
    });
    const report = (error: unknown) => {
      const code = error instanceof Error && /^C5_[A-Z_]+$/.test(error.message) ? error.message : 'C5_EXPORT_FAILED';
      if (code !== 'C5_CAPTURE_EMPTY' && code !== 'C5_CAPTURE_OPERATIONS_PENDING') {
        try { this.#onError(code); } catch { /* diagnostic sinks cannot govern ingress */ }
      }
    };
    const work = (async () => {
      const artifact = this.#unpublished ?? await this.#ingress.captureRuntimeTelemetry();
      this.#unpublished = artifact;
      if (controller.signal.aborted) return;
      const temporary = `${this.#path}.${randomUUID()}.tmp`;
      let handle;
      try {
        await mkdir(dirname(this.#path), { recursive: true });
        if (controller.signal.aborted) return;
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(artifact) + '\n');
        await handle.sync();
        await handle.close(); handle = undefined;
        if (controller.signal.aborted) return;
        // No awaits between this final fence and issuing the irreversible rename.
        publicationCommitted = true;
        this.#publicationPending = true;
        await this.#rename(temporary, this.#path);
        this.#unpublished = null;
      } finally {
        await handle?.close();
        await rm(temporary, { force: true }).catch(() => {});
      }
    })().catch(report).finally(() => { this.#publicationPending = false; this.#workPending = false; });
    const run = Promise.race([work, expired]).catch(report)
      .finally(() => { clearTimeout(timeout); this.#running = null; });
    this.#running = run;
    return run;
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    // A prior bounded close may have reported an issued rename still pending.
    // Rechecking its completion must not start another capture after Store close.
    if (this.#closing) return this.#publicationPending
      ? Promise.reject(new Error('C5_PUBLICATION_PENDING_AT_SHUTDOWN')) : Promise.resolve();
    this.#closing = true;
    clearInterval(this.#timer);
    // At most two deadlines: drain the current batch, then the final observations.
    // A timed-out service remains fenced and is never awaited again by close.
    this.#closePromise = (async () => {
      if (this.#running) await this.#running;
      if (!this.#workPending) await this.#flush();
      if (this.#publicationPending) throw new Error('C5_PUBLICATION_PENDING_AT_SHUTDOWN');
    })().catch(error => { this.#closePromise = null; throw error; });
    return this.#closePromise;
  }
}
