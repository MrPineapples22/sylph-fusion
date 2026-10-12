import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PortfolioEvacuationEngine } from '../../dist/intelligence/survival/portfolio-evacuation.js';

describe('REQ-009: Portfolio Evacuation Engine Full Lifecycle & Shared Bottlenecks', () => {
  it('registers positions only after execution and cleans them up on exit', () => {
    const evac = new PortfolioEvacuationEngine();
    const mintA = 'TokenA111111111111111111111111111111111111';
    const mintB = 'TokenB222222222222222222222222222222222222';

    // Initial state: empty portfolio
    let metrics = evac.evaluatePortfolioEvacuation();
    assert.equal(metrics.total_portfolio_size_sol, 0);
    assert.equal(metrics.current_exit_coverage_pct, 100);
    assert.equal(metrics.shared_route_bottlenecks.length, 0);

    // Register Position A
    evac.registerPosition({
      mint: mintA,
      size_sol: 2.0,
      route: 'Pump_Bonding_Curve',
      pool_liquidity_sol: 20.0,
      current_evacuated_pct: 0,
      last_evacuated_slot: 290000000,
    });

    metrics = evac.evaluatePortfolioEvacuation();
    assert.equal(metrics.total_portfolio_size_sol, 2.0);
    assert.ok(metrics.time_to_liquidate_100s > 0);

    // Register Position B with different route
    evac.registerPosition({
      mint: mintB,
      size_sol: 1.0,
      route: 'Raydium_Main_Pool',
      pool_liquidity_sol: 50.0,
      current_evacuated_pct: 0,
      last_evacuated_slot: 290000001,
    });

    metrics = evac.evaluatePortfolioEvacuation();
    assert.equal(metrics.total_portfolio_size_sol, 3.0);

    // Remove Position A on exit
    evac.removePosition(mintA);
    metrics = evac.evaluatePortfolioEvacuation();
    assert.equal(metrics.total_portfolio_size_sol, 1.0);

    // Remove Position B on exit
    evac.removePosition(mintB);
    metrics = evac.evaluatePortfolioEvacuation();
    assert.equal(metrics.total_portfolio_size_sol, 0);
    assert.equal(metrics.current_exit_coverage_pct, 100);
  });

  it('detects shared route bottlenecks when a route carries >40% of portfolio exposure', () => {
    const evac = new PortfolioEvacuationEngine();

    // 3 positions all sharing the same route
    evac.registerPosition({
      mint: 'Token1111111111111111111111111111111111111',
      size_sol: 2.5,
      route: 'Shared_Congested_Route',
      pool_liquidity_sol: 10.0,
      current_evacuated_pct: 0,
      last_evacuated_slot: 290000000,
    });
    evac.registerPosition({
      mint: 'Token2222222222222222222222222222222222222',
      size_sol: 2.5,
      route: 'Shared_Congested_Route',
      pool_liquidity_sol: 10.0,
      current_evacuated_pct: 0,
      last_evacuated_slot: 290000000,
    });
    evac.registerPosition({
      mint: 'Token3333333333333333333333333333333333333',
      size_sol: 1.0,
      route: 'Alternative_Route',
      pool_liquidity_sol: 20.0,
      current_evacuated_pct: 0,
      last_evacuated_slot: 290000000,
    });

    const metrics = evac.evaluatePortfolioEvacuation();
    assert.equal(metrics.total_portfolio_size_sol, 6.0);
    // Shared_Congested_Route carries 5/6 = 83.3% > 40%
    assert.ok(metrics.shared_route_bottlenecks.length > 0);
    assert.ok(metrics.shared_route_bottlenecks[0].includes('ROUTE_OVERCONCENTRATION: Shared_Congested_Route'));
  });
});
