import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
export class JsonDurableSettlementStore {
    filePath;
    constructor(filePath = resolve('data', 'durable-settlements.json')) {
        this.filePath = filePath;
    }
    async loadState() {
        try {
            const data = await readFile(this.filePath, 'utf8');
            return JSON.parse(data);
        }
        catch (e) {
            if (e.code === 'ENOENT') {
                return { records: {}, byCycle: {}, destinations: {} };
            }
            throw e;
        }
    }
    async saveState(state) {
        const folder = dirname(this.filePath);
        await mkdir(folder, { recursive: true });
        const tmp = this.filePath + '.' + randomUUID() + '.tmp';
        await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
        await rename(tmp, this.filePath);
    }
    async saveSettlementRecord(record) {
        const state = await this.loadState();
        const cycleKey = JSON.stringify([record.vaultId, record.cycleId]);
        state.records[record.settlementId] = {
            ...record,
            netPayableLamports: record.netPayableLamports.toString(),
            platformFeeLamports: record.platformFeeLamports.toString(),
        };
        state.byCycle[cycleKey] = record.settlementId;
        await this.saveState(state);
    }
    async getSettlementRecord(settlementId) {
        const state = await this.loadState();
        const raw = state.records[settlementId];
        if (!raw)
            return undefined;
        return {
            ...raw,
            netPayableLamports: BigInt(raw.netPayableLamports),
            platformFeeLamports: BigInt(raw.platformFeeLamports),
        };
    }
    async getSettlementByCycle(vaultId, cycleId) {
        const state = await this.loadState();
        return state.byCycle[JSON.stringify([vaultId, cycleId])];
    }
    async saveConfirmedDestination(vaultId, address) {
        const state = await this.loadState();
        state.destinations[vaultId] = address;
        await this.saveState(state);
    }
    async getConfirmedDestination(vaultId) {
        const state = await this.loadState();
        return state.destinations[vaultId];
    }
    async getAllRecords() {
        const state = await this.loadState();
        return Object.values(state.records).map((raw) => ({
            ...raw,
            netPayableLamports: BigInt(raw.netPayableLamports),
            platformFeeLamports: BigInt(raw.platformFeeLamports),
        }));
    }
    async getAllConfirmedDestinations() {
        const state = await this.loadState();
        return { ...state.destinations };
    }
}
//# sourceMappingURL=durable-settlement-store.js.map