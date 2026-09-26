import type { AstraAgent, ModelRecord } from './contracts.js';
import { FEATURE_SCHEMA } from './features.js';

/** Versioned inference registry. Registration is not production promotion. */
export class AstraRegistry {
  private readonly entries = new Map<string, {agent: AstraAgent; model: ModelRecord}>();
  register(agent: AstraAgent, model: ModelRecord): void {
    if (!agent.id || !agent.version || agent.id !== model.modelId || agent.version !== model.modelVersion || model.featureSchema !== FEATURE_SCHEMA) throw new Error('Agent/model contract mismatch');
    if (this.entries.has(agent.id)) throw new Error('Explicit retirement is required before replacing an agent');
    if (!Number.isSafeInteger(model.createdAt) || model.createdAt <= 0 || !model.knownLimitations.length) throw new Error('Model provenance/limitations required');
    for (const n of [model.calibration, model.reliability]) if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1)) throw new Error('Invalid model quality');
    if (model.activeStatus === 'ACTIVE') {
      const v = model.validationResults;
      if (!v || !v.evidenceId || !v.outOfSample || !Number.isSafeInteger(v.samples) || v.samples < 1 ||
          !Number.isFinite(v.accuracy) || v.accuracy < 0 || v.accuracy > 1 || !Number.isSafeInteger(v.asOf) || v.asOf <= 0 ||
          model.calibration === null || model.reliability === null) throw new Error('Active inference requires validation/calibration evidence');
    }
    this.entries.set(agent.id, {agent, model: Object.freeze({...model, supportedRegimes: Object.freeze([...model.supportedRegimes]),
      knownLimitations: Object.freeze([...model.knownLimitations]), validationResults: model.validationResults ? Object.freeze({...model.validationResults}) : null})});
  }
  list(): readonly {agent: AstraAgent; model: ModelRecord}[] { return [...this.entries.values()]; }
  get(id: string) { return this.entries.get(id); }
  retire(id: string): void { this.entries.delete(id); }
  setHealth(id: string, health: ModelRecord['health']): void {
    const entry = this.entries.get(id); if (!entry) throw new Error('Unknown agent');
    this.entries.set(id, {...entry, model: Object.freeze({...entry.model, health})});
  }
}
