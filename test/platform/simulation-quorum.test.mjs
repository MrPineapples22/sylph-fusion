import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationQuorum } from '../../dist/platform/simulation/simulation-quorum.js';

test('SimulationQuorum: achieves consensus when providers agree on context, outcome, and output', () => {
  const responses = [
    { providerId: 'HELIUS_EAST', contextSlot: 1000, success: true, outputLamports: 5_000_000n, tokenDeltaRaw: 1000n, computeUnitsConsumed: 32_000, latencyMs: 25 },
    { providerId: 'TRITON_WEST', contextSlot: 1000, success: true, outputLamports: 5_020_000n, tokenDeltaRaw: 1000n, computeUnitsConsumed: 32_500, latencyMs: 30 },
    { providerId: 'QUICKNODE_C', contextSlot: 999,  success: true, outputLamports: 4_990_000n, tokenDeltaRaw: 1000n, computeUnitsConsumed: 31_800, latencyMs: 28 },
  ];

  const result = SimulationQuorum.evaluateQuorum(responses);

  assert.equal(result.status, 'CONSENSUS_ACHIEVED');
  assert.equal(result.totalProviders, 3);
  assert.equal(result.agreeingProviders.length, 3);
  assert.equal(result.quarantinedProviders.length, 0);
  assert.equal(result.consensusOutputLamports, 5_000_000n);
  assert.ok(result.consensusComputeUnits > 30_000);
});

test('SimulationQuorum: automatically quarantines lagging provider nodes', () => {
  const responses = [
    { providerId: 'LEAD_NODE', contextSlot: 1050, success: true, outputLamports: 5_000_000n, tokenDeltaRaw: 1000n, computeUnitsConsumed: 30_000, latencyMs: 20 },
    { providerId: 'SYNC_NODE', contextSlot: 1049, success: true, outputLamports: 5_000_000n, tokenDeltaRaw: 1000n, computeUnitsConsumed: 30_000, latencyMs: 22 },
    { providerId: 'LAG_NODE',  contextSlot: 1045, success: true, outputLamports: 5_000_000n, tokenDeltaRaw: 1000n, computeUnitsConsumed: 30_000, latencyMs: 200 }, // 5 slots behind
  ];

  const result = SimulationQuorum.evaluateQuorum(responses);

  assert.equal(result.status, 'CONSENSUS_ACHIEVED');
  assert.equal(result.agreeingProviders.length, 2);
  assert.equal(result.quarantinedProviders.length, 1);
  assert.match(result.quarantinedProviders[0], /LAG_NODE.*LAGGING_SLOT/);
});

test('SimulationQuorum: fails closed and quarantines on execution revert disagreement', () => {
  const responses = [
    { providerId: 'NODE_A', contextSlot: 2000, success: true,  outputLamports: 10_000_000n, tokenDeltaRaw: 500n, computeUnitsConsumed: 40_000, latencyMs: 25 },
    { providerId: 'NODE_B', contextSlot: 2000, success: false, outputLamports: 0n,          tokenDeltaRaw: 0n,   computeUnitsConsumed: 12_000, latencyMs: 22, errorCode: 'CUSTOM_SLIPPAGE_EXCEEDED' },
  ];

  const result = SimulationQuorum.evaluateQuorum(responses);

  assert.equal(result.status, 'PROVIDER_DISAGREEMENT_QUARANTINE');
  assert.equal(result.consensusOutputLamports, 0n);
  assert.ok(result.quarantinedProviders.length > 0);
  assert.match(result.quarantinedProviders[0], /NODE_B.*EXECUTION_REVERT/);
  assert.match(result.rationale, /EXECUTION_DISAGREEMENT/);
});

test('SimulationQuorum: quarantines provider whose output diverges beyond tolerance', () => {
  const responses = [
    { providerId: 'NODE_1', contextSlot: 3000, success: true, outputLamports: 10_000_000n, tokenDeltaRaw: 100n, computeUnitsConsumed: 30_000, latencyMs: 20 },
    { providerId: 'NODE_2', contextSlot: 3000, success: true, outputLamports: 10_010_000n, tokenDeltaRaw: 100n, computeUnitsConsumed: 30_000, latencyMs: 20 },
    { providerId: 'OUTLIER', contextSlot: 3000, success: true, outputLamports: 9_500_000n, tokenDeltaRaw: 100n, computeUnitsConsumed: 30_000, latencyMs: 20 }, // 500 bps drop!
  ];

  const result = SimulationQuorum.evaluateQuorum(responses);

  assert.equal(result.status, 'CONSENSUS_ACHIEVED');
  assert.equal(result.agreeingProviders.length, 2);
  assert.equal(result.quarantinedProviders.length, 1);
  assert.match(result.quarantinedProviders[0], /OUTLIER.*OUTPUT_DIVERGENCE/);
});
