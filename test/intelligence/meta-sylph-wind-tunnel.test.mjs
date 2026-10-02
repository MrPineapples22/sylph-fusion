import test from 'node:test';
import assert from 'node:assert/strict';

import { MarketWindTunnel } from '../../dist/intelligence/simulation/market-wind-tunnel.js';
import { MetaStrategyController } from '../../dist/intelligence/runtime/meta-strategy-controller.js';
import { MasterSylphDashboardProjector } from '../../dist/intelligence/dashboard/master-sylph-dashboard.js';

test('MarketWindTunnel: simulates multi-agent adversarial futures and generates survival certificate', () => {
  const result = MarketWindTunnel.runSimulation({
    mint: 'WindTunnelMint1111111111111111111111111111',
    initialPoolSol: 50.0,
    initialPoolTokens: 500_000_000,
    sylphPositionSol: 1.0,
    scenariosCount: 30,
    slotsHorizon: 50,
  });

  assert.equal(result.trajectories.length, 30);
  assert.ok(result.survivalCertificate.testedScenariosCount === 30);
  assert.ok(result.survivalCertificate.survivalRate >= 0.0 && result.survivalCertificate.survivalRate <= 1.0);
  assert.ok(result.survivalCertificate.certificateHash.length === 64);
  assert.ok(typeof result.survivalCertificate.isApprovedForCanary === 'boolean');
});

test('MetaStrategyController: matches ecosystem regimes and token lifecycles to discrete strategy modes', () => {
  // 1. Launch Sniper mode under sub-second early discovery
  const sniperVerdict = MetaStrategyController.selectStrategy({
    mint: 'FastMint111111111111111111111111111111111',
    lifecyclePhase: 'LAUNCH',
    ecosystemRegime: 'expansion',
    alphaHalfLifeMs: 1200,
    poolLiquiditySol: 30.0,
    netCapitalVelocity: 2.5,
    truthDebtCount: 0,
    currentDrawdownPct: 1.0,
  });

  assert.equal(sniperVerdict.selectedMode, 'LAUNCH_SNIPER');
  assert.equal(sniperVerdict.isLiveBroadcastingAllowed, true);

  // 2. Bonding Expansion mode during active curve acceleration
  const curveVerdict = MetaStrategyController.selectStrategy({
    mint: 'CurveMint222222222222222222222222222222222',
    lifecyclePhase: 'CURVE_ACCELERATION',
    ecosystemRegime: 'neutral',
    alphaHalfLifeMs: 3000,
    poolLiquiditySol: 60.0,
    netCapitalVelocity: 1.5,
    truthDebtCount: 0,
    currentDrawdownPct: 2.0,
  });

  assert.equal(curveVerdict.selectedMode, 'BONDING_EXPANSION');
  assert.equal(curveVerdict.maxPermittedExposureFraction, 1.0);

  // 3. Post-Migration mode on graduated AMM pools
  const ammVerdict = MetaStrategyController.selectStrategy({
    mint: 'AmmMint333333333333333333333333333333333333',
    lifecyclePhase: 'MATURE_EXPANSION',
    ecosystemRegime: 'expansion',
    alphaHalfLifeMs: 5000,
    poolLiquiditySol: 150.0,
    netCapitalVelocity: 0.8,
    truthDebtCount: 0,
    currentDrawdownPct: 1.5,
  });

  assert.equal(ammVerdict.selectedMode, 'POST_MIGRATION');

  // 4. Hard safety override: Truth Debt >= 3 forces LIQUIDITY_DEFENSIVE
  const debtOverrideVerdict = MetaStrategyController.selectStrategy({
    mint: 'DebtMint44444444444444444444444444444444444',
    lifecyclePhase: 'MOMENTUM',
    ecosystemRegime: 'expansion',
    alphaHalfLifeMs: 5000,
    poolLiquiditySol: 150.0,
    netCapitalVelocity: 5.0,
    truthDebtCount: 3, // Truth debt violation!
    currentDrawdownPct: 2.0,
  });

  assert.equal(debtOverrideVerdict.selectedMode, 'LIQUIDITY_DEFENSIVE');
  assert.equal(debtOverrideVerdict.isLiveBroadcastingAllowed, false);
});

test('MasterSylphDashboardProjector: projects 7-tier master dashboard view model', () => {
  const dashboard = MasterSylphDashboardProjector.projectDashboard({
    truthDebtCount: 0,
    availableCapitalSol: 85.5,
    reservedCapitalSol: 4.5,
    confirmedExposureSol: 10.0,
    currentDrawdownPct: 3.2,
    discoveryCandidatesCount: 142,
    authenticCandidatesCount: 18,
    qualifiedOpportunitiesCount: 5,
    executionReadyCount: 2,
    averageP10x: 0.12,
    averagePRug: 0.08,
    entryLandingRatePct: 94.5,
  });

  assert.equal(dashboard.systemMode, 'FULL');
  assert.equal(dashboard.truthDebtCount, 0);
  assert.equal(dashboard.availableCapitalSol, 85.5);
  assert.equal(dashboard.discoveryCandidatesCount, 142);
  assert.equal(dashboard.entryLandingRatePct, 94.5);
  assert.ok(dashboard.dashboardSnapshotHash.length === 64);

  // High truth debt halts the system
  const haltedDashboard = MasterSylphDashboardProjector.projectDashboard({
    truthDebtCount: 4,
    availableCapitalSol: 50.0,
    reservedCapitalSol: 20.0,
    confirmedExposureSol: 30.0,
    currentDrawdownPct: 5.0,
  });

  assert.equal(haltedDashboard.systemMode, 'HALT');
});
