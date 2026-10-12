import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnifiedDecisionEngine } from '../../dist/intelligence/decision/unified-decision.js';

describe('REQ-019: Unified Decision Deterministic IDs & Environment Root Binding', () => {
  it('produces identical deterministic decision ID and provenance for identical inputs & environment root', () => {
    const engine = new UnifiedDecisionEngine();
    const commonInput = {
      tokenId: 'TokenABC1111111111111111111111111111111111',
      symbol: 'ABC',
      slot: 290123456,
      marketSnapshotId: 'snap_market_001',
      strategyVersion: 'sylph_momentum_v2.0',
      featureVersion: 'features_pit_v3',
      environmentRoot: 'prod_cluster_env_root_hash_a',
      freshnessMs: 120,
    };

    const dec1 = engine.reconcile(commonInput);
    const dec2 = engine.reconcile(commonInput);

    assert.equal(dec1.decisionId, dec2.decisionId);
    assert.equal(dec1.provenance, dec2.provenance);
    assert.equal(dec1.environmentRoot, 'prod_cluster_env_root_hash_a');
  });

  it('generates distinct decision IDs when environment root or caller inputs change', () => {
    const engine = new UnifiedDecisionEngine();
    const baseInput = {
      tokenId: 'TokenXYZ1111111111111111111111111111111111',
      symbol: 'XYZ',
      slot: 290123456,
      marketSnapshotId: 'snap_market_002',
    };

    const decA = engine.reconcile({
      ...baseInput,
      environmentRoot: 'environment_root_alpha',
    });

    const decB = engine.reconcile({
      ...baseInput,
      environmentRoot: 'environment_root_beta',
    });

    assert.notEqual(decA.decisionId, decB.decisionId);
    assert.notEqual(decA.provenance, decB.provenance);
    assert.equal(decA.environmentRoot, 'environment_root_alpha');
    assert.equal(decB.environmentRoot, 'environment_root_beta');
  });
});
