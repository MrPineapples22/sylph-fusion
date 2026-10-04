import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
export class EmergencyStopStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    static atProjectDataDirectory(projectRoot) {
        return new EmergencyStopStore(resolve(projectRoot, 'data', 'paper-emergency-stop.json'));
    }
    async load() {
        let contents;
        try {
            contents = await readFile(this.filePath, 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return null;
            throw new Error('EMERGENCY_STOP_STORE_READ_FAILED');
        }
        return this.decode(contents);
    }
    decode(contents) {
        let value;
        try {
            value = JSON.parse(contents);
        }
        catch {
            throw new Error('EMERGENCY_STOP_STORE_INVALID_JSON');
        }
        if (!this.isRecord(value))
            throw new Error('EMERGENCY_STOP_STORE_INVALID_RECORD');
        const record = value;
        return Object.freeze({
            commandId: record.commandId,
            initiator: record.initiator,
            triggeredAt: record.triggeredAt,
            triggerType: record.triggerType,
            reason: record.reason,
        });
    }
    async save(record) {
        if (!this.isRecord(record))
            throw new Error('EMERGENCY_STOP_STORE_INVALID_RECORD');
        const existing = await this.load();
        if (existing) {
            if (JSON.stringify(existing) === JSON.stringify(record))
                return;
            throw new Error('EMERGENCY_STOP_STORE_CONFLICT');
        }
        const folder = dirname(this.filePath);
        const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
        try {
            await mkdir(folder, { recursive: true });
            await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
            await rename(temporaryPath, this.filePath);
        }
        catch {
            throw new Error('EMERGENCY_STOP_STORE_WRITE_FAILED');
        }
    }
    /**
     * Commit a confirmed clear without yielding the event loop. The gateway must
     * revalidate its stop epoch immediately before this call and release memory
     * immediately after it. An asynchronous destructive adapter is not supported.
     * This is process-crash ordering, not a power-loss or cross-process guarantee.
     */
    clearSync(expected) {
        let existing;
        try {
            existing = this.decode(readFileSync(this.filePath, 'utf8'));
        }
        catch (error) {
            // A stop whose save failed may exist only in memory. Explicit operator
            // clear can release it after confirming that the durable file is absent.
            if (error.code === 'ENOENT')
                return;
            throw new Error('EMERGENCY_STOP_STORE_CLEAR_FAILED');
        }
        if (JSON.stringify(existing) !== JSON.stringify(expected)) {
            throw new Error('EMERGENCY_STOP_STORE_CONFLICT');
        }
        try {
            unlinkSync(this.filePath);
        }
        catch {
            throw new Error('EMERGENCY_STOP_STORE_CLEAR_FAILED');
        }
    }
    isRecord(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return false;
        const record = value;
        return typeof record.commandId === 'string' && record.commandId.length > 0 && record.commandId.length <= 200 &&
            typeof record.initiator === 'string' && record.initiator.length > 0 && record.initiator.length <= 200 &&
            Number.isSafeInteger(record.triggeredAt) && record.triggeredAt >= 0 &&
            (record.triggerType === 'OPERATOR_STOP' || record.triggerType === 'PANIC_CLOSE_ALL' || record.triggerType === 'LEGACY_UNKNOWN') &&
            typeof record.reason === 'string' && record.reason.length > 0 && record.reason.length <= 500;
    }
}
//# sourceMappingURL=emergency-stop-store.js.map