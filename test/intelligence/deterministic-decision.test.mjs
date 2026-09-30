import test from 'node:test';
import assert from 'node:assert/strict';
import { UnifiedDecisionEngine } from '../../dist/intelligence/decision/unified-decision.js';

test('UnifiedDecisionEngine generates strictly deterministic decisionId and provenance', async () => {
  const engine = new UnifiedDecisionEngine();
  const input = {
    tokenId: 'MintDeterministic11111111111111111111111111',
    symbol: 'DET',
    slot: 28492019,
    timestamp: 1727740000000,
    marketSnapshotId: 'snap_fixed_snapshot_01',
    strategyVersion: 'sylph_momentum_v1.0',
    featureVersion: 'features_v1',
  };

  const decision1 = engine.reconcile(input);

  // Wait a small delay to ensure wall clock would have advanced if Date.now() was used
  await new Promise((r) => setTimeout(r, 20));

  const decision2 = engine.reconcile(input);

  assert.equal(decision1.decisionId, decision2.decisionId, 'decisionId must be identical across calls');
  assert.equal(decision1.provenance, decision2.provenance, 'provenance must be identical across calls');
  assert.equal(decision1.opportunityId, decision2.opportunityId, 'opportunityId must be identical');
  assert.equal(decision1.timestamp, decision2.timestamp, 'timestamp must be preserved');
  assert.match(decision1.decisionId, /^dec_MintDete_28492019_[a-f0-9]{12}$/);
});
