import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { EmergencyStopRecord } from '../../command-gateway.js';

export class EmergencyStopStore {
  public constructor(private readonly filePath: string) {}

  public static atProjectDataDirectory(projectRoot: string): EmergencyStopStore {
    return new EmergencyStopStore(resolve(projectRoot, 'data', 'paper-emergency-stop.json'));
  }

  public async load(): Promise<EmergencyStopRecord | null> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('EMERGENCY_STOP_STORE_READ_FAILED');
    }

    return this.decode(contents);
  }

  private decode(contents: string): EmergencyStopRecord {
    let value: unknown;
    try {
      value = JSON.parse(contents);
    } catch {
      throw new Error('EMERGENCY_STOP_STORE_INVALID_JSON');
    }
    if (!this.isRecord(value)) throw new Error('EMERGENCY_STOP_STORE_INVALID_RECORD');
    const record = value as EmergencyStopRecord;
    return Object.freeze({
      commandId: record.commandId,
      initiator: record.initiator,
      triggeredAt: record.triggeredAt,
      triggerType: record.triggerType,
      reason: record.reason,
    });
  }

  public async save(record: EmergencyStopRecord): Promise<void> {
    if (!this.isRecord(record)) throw new Error('EMERGENCY_STOP_STORE_INVALID_RECORD');
    const existing = await this.load();
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(record)) return;
      throw new Error('EMERGENCY_STOP_STORE_CONFLICT');
    }
    const folder = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(folder, { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temporaryPath, this.filePath);
    } catch {
      throw new Error('EMERGENCY_STOP_STORE_WRITE_FAILED');
    }
  }

  /**
   * Commit a confirmed clear without yielding the event loop. The gateway must
   * revalidate its stop epoch immediately before this call and release memory
   * immediately after it. An asynchronous destructive adapter is not supported.
   * This is process-crash ordering, not a power-loss or cross-process guarantee.
   */
  public clearSync(expected: EmergencyStopRecord): void {
    let existing: EmergencyStopRecord;
    try {
      existing = this.decode(readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      // A stop whose save failed may exist only in memory. Explicit operator
      // clear can release it after confirming that the durable file is absent.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error('EMERGENCY_STOP_STORE_CLEAR_FAILED');
    }
    if (JSON.stringify(existing) !== JSON.stringify(expected)) {
      throw new Error('EMERGENCY_STOP_STORE_CONFLICT');
    }
    try {
      unlinkSync(this.filePath);
    } catch {
      throw new Error('EMERGENCY_STOP_STORE_CLEAR_FAILED');
    }
  }

  private isRecord(value: unknown): value is EmergencyStopRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return typeof record.commandId === 'string' && record.commandId.length > 0 && record.commandId.length <= 200 &&
      typeof record.initiator === 'string' && record.initiator.length > 0 && record.initiator.length <= 200 &&
      Number.isSafeInteger(record.triggeredAt) && (record.triggeredAt as number) >= 0 &&
      (record.triggerType === 'OPERATOR_STOP' || record.triggerType === 'PANIC_CLOSE_ALL' || record.triggerType === 'LEGACY_UNKNOWN') &&
      typeof record.reason === 'string' && record.reason.length > 0 && record.reason.length <= 500;
  }
}
