import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PositionSurvivalCore } from '../../dist/intelligence/survival/survival-core.js';

describe('REQ-006: Position Survival Core Exit Proof Ladder & Tranches', () => {
  it('computes non-linear constant product impact and genuine executable tranches for liquid routes', () => {
    const survivalCore = new PositionSurvivalCore();
    const mint = 'SurvTest1111111111111111111111111111111111';

    const cert = survivalCore.evaluateSurvival({
      mint,
      position_size_sol: 1.0,
      pool_liquidity_sol: 50.0,
      has_freeze_authority: false,
      has_mint_authority: false,
      route_name: 'Pump_Bonding_Curve',
      independent_routes_count: 2,
      current_slot: 290000000,
    });

    assert.equal(cert.is_valid, true);
    assert.equal(cert.exit_proof_level, 'E5_MULTIPLE_INDEPENDENT_ROUTES');
    assert.equal(cert.exit_health, 'HEALTHY');
    assert.equal(cert.partial_exit_proofs.length, 4);

    // Verify non-linear tranches: 25%, 50%, 75%, 100%
    const p25 = cert.partial_exit_proofs[0];
    const p100 = cert.partial_exit_proofs[3];

    assert.equal(p25.tranche_pct, 25);
    assert.equal(p100.tranche_pct, 100);
    assert.ok(p25.is_executable);
    assert.ok(p100.is_executable);
    // Non-linear constant product impact: 1 SOL in 50 SOL pool is ~1.96% impact
    assert.ok(p100.price_impact_pct > 1.8 && p100.price_impact_pct < 2.2);
    // 25% tranche (0.25 SOL) has lower price impact than 100% tranche
    assert.ok(p25.price_impact_pct < p100.price_impact_pct);
    // Output should be positive and account for fees
    assert.ok(p100.expected_output_sol > 0.95);
    assert.equal(p100.route, 'Pump_Bonding_Curve');
  });

  it('fails closed and sets is_executable to false when liquidity is thin (<2 SOL) or route is unknown', () => {
    const survivalCore = new PositionSurvivalCore();
    const mint = 'ThinPool1111111111111111111111111111111111';

    const cert = survivalCore.evaluateSurvival({
      mint,
      position_size_sol: 1.0,
      pool_liquidity_sol: 1.5, // Thin pool < 2.0 SOL
      has_freeze_authority: false,
      has_mint_authority: false,
      current_slot: 290000000,
    });

    assert.equal(cert.is_valid, false);
    assert.equal(cert.exit_proof_level, 'E0_UNKNOWN');
    assert.equal(cert.partial_exit_proofs.length, 4);
    // Every tranche must fail closed
    for (const tranche of cert.partial_exit_proofs) {
      assert.equal(tranche.is_executable, false);
      assert.equal(tranche.expected_output_sol, 0);
      assert.equal(tranche.price_impact_pct, 100);
    }
  });

  it('rejects tokens with freeze authority with E0_UNKNOWN and non-executable tranches', () => {
    const survivalCore = new PositionSurvivalCore();
    const mint = 'Frozen111111111111111111111111111111111111';

    const cert = survivalCore.evaluateSurvival({
      mint,
      position_size_sol: 0.5,
      pool_liquidity_sol: 100.0,
      has_freeze_authority: true, // Freeze authority present!
      has_mint_authority: false,
      route_name: 'Raydium_Main_Pool',
      current_slot: 290000000,
    });

    assert.equal(cert.is_valid, false);
    assert.equal(cert.exit_proof_level, 'E0_UNKNOWN');
    for (const tranche of cert.partial_exit_proofs) {
      assert.equal(tranche.is_executable, false);
    }
  });
});
