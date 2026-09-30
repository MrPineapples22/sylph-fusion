/**
 * SYLPH FUSION - DURABLE GENERATION FENCE AUTHORITY
 * Specifications: Sections 37 (Execution Generations), 103 (Invariants 1, 2).
 *
 * Enforces the core distributed systems invariant:
 *   ONE ECONOMIC INTENT -> AT MOST ONE ACTIVE EXECUTION GENERATION
 *
 * Durable across process restarts, unhandled exceptions, and async cancellations.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface DurableGenerationEntry {
  readonly intentId: string;
  readonly generation: number;
  readonly signature: string;
  readonly lastValidBlockHeight: number;
  readonly state: 'ACTIVE' | 'SUPERSEDED' | 'CONFIRMED' | 'EXPIRED';
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface FenceStorageState {
  entries: Record<string, DurableGenerationEntry>;
}

export class DurableGenerationFenceAuthority {
  constructor(private readonly storagePath: string = resolve('data', 'generation-fences.json')) {}

  private async load(): Promise<FenceStorageState> {
    try {
      const data = await readFile(this.storagePath, 'utf8');
      return JSON.parse(data);
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        return { entries: {} };
      }
      throw e;
    }
  }

  private async save(state: FenceStorageState): Promise<void> {
    const folder = dirname(this.storagePath);
    await mkdir(folder, { recursive: true });
    const tmp = this.storagePath + '.' + randomUUID() + '.tmp';
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await rename(tmp, this.storagePath);
  }

  /**
   * Registers Generation 1 for a new intent. Throws if active generation already exists.
   */
  public async acquireInitialGeneration(
    intentId: string,
    signature: string,
    lastValidBlockHeight: number
  ): Promise<DurableGenerationEntry> {
    const state = await this.load();
    const existing = state.entries[intentId];
    if (existing && existing.state === 'ACTIVE') {
      throw new Error("GENERATION_ALREADY_ACTIVE: Intent " + intentId + " is active at Gen " + existing.generation);
    }

    const now = Date.now();
    const entry: DurableGenerationEntry = {
      intentId,
      generation: 1,
      signature,
      lastValidBlockHeight,
      state: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };

    state.entries[intentId] = entry;
    await this.save(state);
    return entry;
  }

  /**
   * Advances generation to N+1 only if previous generation is proven expired or dropped.
   */
  public async advanceGeneration(
    intentId: string,
    newSignature: string,
    newLastValidBlockHeight: number,
    currentBlockHeight: number
  ): Promise<DurableGenerationEntry> {
    const state = await this.load();
    const current = state.entries[intentId];
    if (!current) {
      throw new Error("INTENT_NOT_REGISTERED: Cannot advance generation for unregistered intent " + intentId);
    }

    // Safety Invariant: cannot advance if previous generation may still land
    if (current.state === 'ACTIVE' && currentBlockHeight <= current.lastValidBlockHeight) {
      throw new Error(
        "FENCE_BREACH_PREVENTED: Generation " + current.generation + " is still in flight (current " + currentBlockHeight + " <= max " + current.lastValidBlockHeight + ")"
      );
    }

    const now = Date.now();
    const nextGen = current.generation + 1;
    const entry: DurableGenerationEntry = {
      intentId,
      generation: nextGen,
      signature: newSignature,
      lastValidBlockHeight: newLastValidBlockHeight,
      state: 'ACTIVE',
      createdAt: current.createdAt,
      updatedAt: now,
    };

    state.entries[intentId] = entry;
    await this.save(state);
    return entry;
  }

  public async confirmGeneration(intentId: string, generation: number): Promise<void> {
    const state = await this.load();
    const current = state.entries[intentId];
    if (current && current.generation === generation) {
      state.entries[intentId] = { ...current, state: 'CONFIRMED', updatedAt: Date.now() };
      await this.save(state);
    }
  }

  public async getActiveGeneration(intentId: string): Promise<DurableGenerationEntry | undefined> {
    const state = await this.load();
    const entry = state.entries[intentId];
    return entry?.state === 'ACTIVE' ? entry : undefined;
  }
}
