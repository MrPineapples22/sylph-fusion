import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { SettlementRecord, DurableSettlementStore } from './settlement-firewall.js';

interface SerializedSettlementState {
  records: Record<string, any>;
  byCycle: Record<string, string>;
  destinations: Record<string, string>;
}

export class JsonDurableSettlementStore implements DurableSettlementStore {
  constructor(private readonly filePath: string = resolve('data', 'durable-settlements.json')) {}

  private async loadState(): Promise<SerializedSettlementState> {
    try {
      const data = await readFile(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        return { records: {}, byCycle: {}, destinations: {} };
      }
      throw e;
    }
  }

  private async saveState(state: SerializedSettlementState): Promise<void> {
    const folder = dirname(this.filePath);
    await mkdir(folder, { recursive: true });
    const tmp = this.filePath + '.' + randomUUID() + '.tmp';
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await rename(tmp, this.filePath);
  }

  async saveSettlementRecord(record: SettlementRecord): Promise<void> {
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

  async getSettlementRecord(settlementId: string): Promise<SettlementRecord | undefined> {
    const state = await this.loadState();
    const raw = state.records[settlementId];
    if (!raw) return undefined;
    return {
      ...raw,
      netPayableLamports: BigInt(raw.netPayableLamports),
      platformFeeLamports: BigInt(raw.platformFeeLamports),
    };
  }

  async getSettlementByCycle(vaultId: string, cycleId: string): Promise<string | undefined> {
    const state = await this.loadState();
    return state.byCycle[JSON.stringify([vaultId, cycleId])];
  }

  async saveConfirmedDestination(vaultId: string, address: string): Promise<void> {
    const state = await this.loadState();
    state.destinations[vaultId] = address;
    await this.saveState(state);
  }

  async getConfirmedDestination(vaultId: string): Promise<string | undefined> {
    const state = await this.loadState();
    return state.destinations[vaultId];
  }
}
