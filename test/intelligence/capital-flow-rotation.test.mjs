import test from 'node:test';
import assert from 'node:assert/strict';
import { CapitalFlowGraph } from '../../dist/intelligence/graph/capital-flow-graph.js';

test('CapitalFlowGraph tracks flow phases, wallet behavior states, and cross-token rotation', () => {
  const graph = new CapitalFlowGraph();
  const mintA = 'TokenAAA11111111111111111111111111111111111';
  const mintB = 'TokenBBB22222222222222222222222222222222222';
  const wallet = 'SmartTraderWallet11111111111111111111111111';

  // 1. Initial buy into Token A
  const res1 = graph.recordTransfer({
    fromNode: wallet,
    toNode: `mint:${mintA}`,
    amountSol: 15.0,
    timestampMs: 1_000_000,
    slot: 100,
    mint: mintA,
  });

  assert.equal(res1.updatedWalletState, 'ACCUMULATING');
  assert.equal(graph.getWalletBehaviorState(wallet), 'ACCUMULATING');

  // 2. Exit from Token A
  const res2 = graph.recordTransfer({
    fromNode: `mint:${mintA}`,
    toNode: wallet,
    amountSol: 25.0,
    timestampMs: 1_060_000,
    slot: 250,
    mint: mintA,
  });

  assert.equal(res2.updatedWalletState, 'EXITED');

  // 3. Fast rotation into Token B within 40 seconds (< 3 minutes)
  const res3 = graph.recordTransfer({
    fromNode: wallet,
    toNode: `mint:${mintB}`,
    amountSol: 20.0,
    timestampMs: 1_100_000,
    slot: 350,
    mint: mintB,
  });

  assert.ok(res3.detectedRotation, 'Should detect cross-token rotation');
  assert.equal(res3.detectedRotation.sourceMint, mintA);
  assert.equal(res3.detectedRotation.targetMint, mintB);
  assert.equal(res3.detectedRotation.intermediateWallet, wallet);
  assert.equal(res3.detectedRotation.rotationVolumeSol, 20.0);

  // 4. Token metrics for Token B
  const metricsB = graph.getTokenFlowMetrics(mintB, 1_100_000);
  assert.equal(metricsB.mint, mintB);
  assert.equal(metricsB.netInflowSol, 20.0);
  assert.equal(metricsB.phase, 'CAPITAL_ARRIVING');
});
