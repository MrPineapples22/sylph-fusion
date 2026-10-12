import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SolanaArbitrageGraph } from '../../dist/platform/solana/arbitrage-graph.js';

describe('SolanaArbitrageGraph multi-leg estimates and safety checks', () => {
  it('finds a positive estimated 4-leg cycle without inventing atomicity profit', () => {
    const arbGraph = new SolanaArbitrageGraph();

    // Leg 1: SOL -> USDC (Rate 150.0)
    arbGraph.updateEdge({
      edgeId: 'e1_sol_usdc',
      poolId: 'pool_1',
      protocol: 'RAYDIUM',
      baseToken: 'SOL',
      quoteToken: 'USDC',
      rate: 150.0,
      feeBps: 20,
      impactBps: 5,
      availableCapacityLamports: 10_000_000_000n, // 10 SOL
      freshnessMs: 25,
      executionProbability: 0.99,
    });

    // Leg 2: USDC -> JUP (Rate 1.25 JUP / USDC)
    arbGraph.updateEdge({
      edgeId: 'e2_usdc_jup',
      poolId: 'pool_2',
      protocol: 'METEORA',
      baseToken: 'USDC',
      quoteToken: 'JUP',
      rate: 1.25,
      feeBps: 20,
      impactBps: 5,
      availableCapacityLamports: 8_000_000_000n, // 8 SOL equivalent
      freshnessMs: 20,
      executionProbability: 0.98,
    });

    // Leg 3: JUP -> RAY (Rate 0.40 RAY / JUP)
    arbGraph.updateEdge({
      edgeId: 'e3_jup_ray',
      poolId: 'pool_3',
      protocol: 'ORCA',
      baseToken: 'JUP',
      quoteToken: 'RAY',
      rate: 0.40,
      feeBps: 25,
      impactBps: 5,
      availableCapacityLamports: 5_000_000_000n, // 5 SOL equivalent (Bottleneck!)
      freshnessMs: 15,
      executionProbability: 0.97,
    });

    // Leg 4: RAY -> SOL (Dislocated rate: 1 SOL / 70 RAY -> Rate = 1/70 = ~0.0142857 SOL/RAY)
    // Combined multiplier: 150 * 1.25 * 0.40 * (1 / 70) = 75 / 70 = ~1.0714 (+7.14% gross spread)
    arbGraph.updateEdge({
      edgeId: 'e4_ray_sol',
      poolId: 'pool_4',
      protocol: 'PUMPSWAP',
      baseToken: 'RAY',
      quoteToken: 'SOL',
      rate: 1 / 70.0,
      feeBps: 25,
      impactBps: 5,
      availableCapacityLamports: 12_000_000_000n,
      freshnessMs: 30,
      executionProbability: 0.96,
    });

    const notional = 2_000_000_000n; // 2 SOL
    const cycles = arbGraph.findProfitableCycles({
      rootToken: 'SOL',
      notionalLamports: notional,
      estimatedTipFeeLamports: 200_000n,
      minProfitBps: 100, // Min 1% profit
    });

    assert.ok(cycles.length >= 1, 'Must find 4-leg arbitrage cycle');
    const cycle = cycles[0];
    assert.equal(cycle.legs.length, 4);
    assert.equal(cycle.isSingleAtomicTransaction, false, 'atomic execution is not proven by graph topology');
    assert.ok(cycle.grossSpreadLamports > 0n);
    assert.equal(cycle.atomicityPremiumLamports, 0n);
    assert.ok(cycle.robustArbProfitLamports > 0n);
    assert.ok(cycle.profitBps > 500); // Expecting > 5% net profit

    // Bottleneck capacity verification: Pool 3 has 5 SOL capacity
    assert.equal(cycle.minLegCapacityLamports, 5_000_000_000n);
    assert.equal(cycle.optimalNotionalLamports, notional);
  });

  it('2. Invariant: Negative gross spread cycles never receive atomicity premium or claim profit', () => {
    const arbGraph = new SolanaArbitrageGraph();

    // Pool 1: SOL -> USDC (Rate 150.0)
    arbGraph.updateEdge({
      edgeId: 'e1_sol_usdc_loss',
      poolId: 'pool_loss_1',
      protocol: 'RAYDIUM',
      baseToken: 'SOL',
      quoteToken: 'USDC',
      rate: 150.0,
      feeBps: 25,
      impactBps: 5,
      availableCapacityLamports: 10_000_000_000n,
      freshnessMs: 20,
      executionProbability: 0.99,
    });

    // Pool 2: USDC -> SOL (Unfavorable rate: 1 / 152.0 = losing cycle: 150/152 = 0.9868, -1.3% loss)
    arbGraph.updateEdge({
      edgeId: 'e2_usdc_sol_loss',
      poolId: 'pool_loss_2',
      protocol: 'ORCA',
      baseToken: 'USDC',
      quoteToken: 'SOL',
      rate: 1 / 152.0,
      feeBps: 25,
      impactBps: 5,
      availableCapacityLamports: 10_000_000_000n,
      freshnessMs: 20,
      executionProbability: 0.99,
    });

    const notional = 10_000_000_000n; // 10 SOL
    const cycles = arbGraph.findProfitableCycles({
      rootToken: 'SOL',
      notionalLamports: notional,
      estimatedTipFeeLamports: 100_000n,
      minProfitBps: 1, // Look for any profit
    });

    // Unprofitable cycle must not be returned
    assert.equal(cycles.length, 0, 'Losing cycle must not be returned as profitable');
  });

  it('3. Optimal sizing respects bottleneck pool capacity when notional exceeds pool depth', () => {
    const arbGraph = new SolanaArbitrageGraph();

    arbGraph.updateEdge({
      edgeId: 'e1_cap',
      poolId: 'p1',
      protocol: 'RAYDIUM',
      baseToken: 'SOL',
      quoteToken: 'USDC',
      rate: 155.0,
      feeBps: 20,
      impactBps: 5,
      availableCapacityLamports: 50_000_000_000n,
      freshnessMs: 20,
      executionProbability: 0.99,
    });

    arbGraph.updateEdge({
      edgeId: 'e2_cap',
      poolId: 'p2',
      protocol: 'ORCA',
      baseToken: 'USDC',
      quoteToken: 'SOL',
      rate: 1 / 150.0,
      feeBps: 20,
      impactBps: 5,
      availableCapacityLamports: 1_500_000_000n, // Only 1.5 SOL capacity!
      freshnessMs: 20,
      executionProbability: 0.99,
    });

    const notional = 10_000_000_000n; // 10 SOL requested
    const cycles = arbGraph.findProfitableCycles({
      rootToken: 'SOL',
      notionalLamports: notional,
      estimatedTipFeeLamports: 50_000n,
      minProfitBps: 50,
    });

    assert.equal(cycles.length, 1);
    const cycle = cycles[0];
    assert.equal(cycle.minLegCapacityLamports, 1_500_000_000n);
    assert.equal(cycle.optimalNotionalLamports, 1_500_000_000n, 'Optimal notional must be capped at 1.5 SOL');
  });

  it('4. Deduplication ensures unique cycle paths and deterministic cycle IDs', () => {
    const arbGraph = new SolanaArbitrageGraph();

    arbGraph.updateEdge({
      edgeId: 'e1_dedup',
      poolId: 'p1',
      protocol: 'RAYDIUM',
      baseToken: 'SOL',
      quoteToken: 'USDC',
      rate: 155.0,
      feeBps: 20,
      impactBps: 5,
      availableCapacityLamports: 50_000_000_000n,
      freshnessMs: 20,
      executionProbability: 0.99,
    });

    arbGraph.updateEdge({
      edgeId: 'e2_dedup',
      poolId: 'p2',
      protocol: 'ORCA',
      baseToken: 'USDC',
      quoteToken: 'SOL',
      rate: 1 / 150.0,
      feeBps: 20,
      impactBps: 5,
      availableCapacityLamports: 50_000_000_000n,
      freshnessMs: 20,
      executionProbability: 0.99,
    });

    const cycles = arbGraph.findProfitableCycles({
      rootToken: 'SOL',
      notionalLamports: 1_000_000_000n,
      estimatedTipFeeLamports: 50_000n,
      minProfitBps: 10,
    });

    assert.equal(cycles.length, 1);
    const cycleIds = new Set(cycles.map(c => c.cycleId));
    assert.equal(cycleIds.size, cycles.length, 'Every cycle must possess a unique ID');
  });

  it('rejects malformed market observations and unsafe notionals', () => {
    const graph = new SolanaArbitrageGraph();
    assert.throws(() => graph.updateEdge({ edgeId: 'bad', poolId: 'p', protocol: 'x', baseToken: 'A', quoteToken: 'B', rate: Infinity, feeBps: 0, impactBps: 0, availableCapacityLamports: 1n, freshnessMs: 0, executionProbability: 1 }));
    assert.throws(() => graph.updateEdge({ edgeId: 'bad', poolId: 'p', protocol: 'x', baseToken: 'A', quoteToken: 'B', rate: 1, feeBps: 0, impactBps: 0, availableCapacityLamports: 1n, freshnessMs: 0, executionProbability: 1.1 }));
    assert.throws(() => graph.findProfitableCycles({ rootToken: 'SOL', notionalLamports: BigInt(Number.MAX_SAFE_INTEGER) + 1n }));
  });

  it('replacing an edge ID with a different base token removes the stale adjacency entry', () => {
    const graph = new SolanaArbitrageGraph();
    const edge = { edgeId: 'shared-id', poolId: 'p1', protocol: 'x', baseToken: 'A', quoteToken: 'B', rate: 2, feeBps: 0, impactBps: 0, availableCapacityLamports: 10_000_000_000n, freshnessMs: 0, executionProbability: 1 };
    graph.updateEdge(edge);
    graph.updateEdge({ ...edge, poolId: 'p3', baseToken: 'B', quoteToken: 'C' });
    graph.updateEdge({ ...edge, edgeId: 'return-edge', poolId: 'p2', baseToken: 'B', quoteToken: 'A', rate: 1 });

    assert.deepEqual(graph.findProfitableCycles({ rootToken: 'A', notionalLamports: 1_000_000_000n, estimatedTipFeeLamports: 0n, minProfitBps: 0 }), []);
  });
});
