import test from 'node:test';
import assert from 'node:assert/strict';

import { AdaptivePolicyRouter } from '../../dist/intelligence/policies/adaptive-router.js';
import { OODSentinel } from '../../dist/intelligence/safety/ood-sentinel.js';
import { PositionDefenseEngine } from '../../dist/intelligence/execution/position-defense.js';

test('AdaptivePolicyRouter selects context-specific policy and enforces abstention on uncertainty', () => {
  const router = new AdaptivePolicyRouter();

  // 1. Extreme OOD -> ObservationOnlyPolicy
  const oodDecision = router.route({
    tokenAgeSeconds: 45,
    isPostMigration: false,
    compositeHsi: 25,
    pumpScore: 80,
    clusterDispersalRatio: 0.9,
    deceptionGap: 5,
    actorReputationScore: 70,
    macroRegime: 'RISK_ON',
    oodState: 'OUT_OF_DISTRIBUTION',
  });
  assert.equal(oodDecision.policyName, 'ObservationOnlyPolicy');
  assert.equal(oodDecision.action, 'OBSERVE');
  assert.equal(oodDecision.targetAllocationMultiplier, 0.0);

  // 2. Early Launch with high momentum -> EarlyLaunchPolicy
  const earlyDecision = router.route({
    tokenAgeSeconds: 30,
    isPostMigration: false,
    compositeHsi: 30,
    pumpScore: 75,
    clusterDispersalRatio: 0.85,
    deceptionGap: 10,
    actorReputationScore: 60,
    macroRegime: 'RISK_ON',
    oodState: 'KNOWN',
  });
  assert.equal(earlyDecision.policyName, 'EarlyLaunchPolicy');
  assert.equal(earlyDecision.action, 'ENTER');
  assert.ok(earlyDecision.targetAllocationMultiplier > 0);

  // 3. Mature token with strong wallet diversity -> OrganicMomentumPolicy
  const matureDecision = router.route({
    tokenAgeSeconds: 150,
    isPostMigration: false,
    compositeHsi: 20,
    pumpScore: 60,
    clusterDispersalRatio: 0.85,
    deceptionGap: 5,
    actorReputationScore: 70,
    macroRegime: 'RISK_ON',
    oodState: 'KNOWN',
  });
  assert.equal(matureDecision.policyName, 'OrganicMomentumPolicy');
  assert.equal(matureDecision.action, 'ENTER');
  assert.equal(matureDecision.targetAllocationMultiplier, 1.0);

  // 4. Macro Risk-Off -> DefensivePolicy
  const defensiveDecision = router.route({
    tokenAgeSeconds: 150,
    isPostMigration: false,
    compositeHsi: 20,
    pumpScore: 60,
    clusterDispersalRatio: 0.85,
    deceptionGap: 5,
    actorReputationScore: 70,
    macroRegime: 'RISK_OFF',
    oodState: 'KNOWN',
  });
  assert.equal(defensiveDecision.policyName, 'DefensivePolicy');
  assert.equal(defensiveDecision.action, 'OBSERVE');
});

test('OODSentinel classifies epistemic states and clamps capital authorization', () => {
  const sentinel = new OODSentinel();

  // 1. Normal known environment
  const known = sentinel.evaluateOod({
    tokenAgeSeconds: 50,
    launchFrequencyPerMin: 4,
    solVolatilityPct: 3.5,
    uniqueFundingClusters: 15,
    buyerCount: 20,
    modelDisagreementSpread: 0.1,
    hasContradictoryData: false,
  });
  assert.equal(known.epistemicState, 'KNOWN');
  assert.equal(known.allowedCapitalMultiplier, 1.0);
  assert.equal(known.requiresObservationMode, false);

  // 2. Extreme macro outlier -> OUT_OF_DISTRIBUTION
  const ood = sentinel.evaluateOod({
    tokenAgeSeconds: 50,
    launchFrequencyPerMin: 45, // Extreme burst
    solVolatilityPct: 25.0,    // Extreme shock
    uniqueFundingClusters: 15,
    buyerCount: 20,
    modelDisagreementSpread: 0.1,
    hasContradictoryData: false,
  });
  assert.equal(ood.epistemicState, 'OUT_OF_DISTRIBUTION');
  assert.equal(ood.allowedCapitalMultiplier, 0.0);
  assert.equal(ood.requiresObservationMode, true);

  // 3. Contradictory telemetry -> UNKNOWN
  const unknown = sentinel.evaluateOod({
    tokenAgeSeconds: 50,
    launchFrequencyPerMin: 4,
    solVolatilityPct: 3.5,
    uniqueFundingClusters: 15,
    buyerCount: 20,
    modelDisagreementSpread: 0.1,
    hasContradictoryData: true,
  });
  assert.equal(unknown.epistemicState, 'UNKNOWN');
  assert.equal(unknown.allowedCapitalMultiplier, 0.0);
});

test('PositionDefenseEngine models Exitability Surface, Thesis Monitor, and D0-D5 escalation', () => {
  const defenseEngine = new PositionDefenseEngine();

  // 1. Healthy open position (D0_NORMAL)
  const healthy = defenseEngine.evaluateDefense({
    mint: 'Mint_Healthy',
    positionTokens: 1_000_000,
    currentPriceSol: 0.000005, // 5 SOL mark value
    poolSolReserves: 50.0,
    toxicityScore: 0.15,
    unrealizedPnlPct: 15.0,
    liquidityDropPct: 0.0,
    independentBuyersDecreasing: false,
  });

  assert.equal(healthy.defenseLevel, 'D0_NORMAL');
  assert.equal(healthy.recommendedAction, 'HOLD');
  assert.equal(healthy.exitabilitySurface.length, 4);
  assert.ok(healthy.liquidityCoverageRatio > 0.85);

  // 2. Severe Thesis Invalidation -> D4_EXIT
  const invalidated = defenseEngine.evaluateDefense({
    mint: 'Mint_Invalidated',
    positionTokens: 1_000_000,
    currentPriceSol: 0.000004,
    poolSolReserves: 30.0,
    toxicityScore: 0.85, // Toxic sell flow
    unrealizedPnlPct: -18.0,
    liquidityDropPct: 30.0, // Liquidity pulled > 25%
    independentBuyersDecreasing: true,
  });

  assert.equal(invalidated.defenseLevel, 'D4_EXIT');
  assert.equal(invalidated.recommendedAction, 'FULL_EXIT');
  assert.equal(invalidated.hasInvalidatedThesis, true);

  // 3. Flash Liquidity Pull / Collapse -> D5_EMERGENCY
  const emergency = defenseEngine.evaluateDefense({
    mint: 'Mint_Rug',
    positionTokens: 1_000_000,
    currentPriceSol: 0.000001,
    poolSolReserves: 2.0,
    toxicityScore: 0.95,
    unrealizedPnlPct: -70.0,
    liquidityDropPct: 80.0, // 80% liquidity vanished
    independentBuyersDecreasing: true,
  });

  assert.equal(emergency.defenseLevel, 'D5_EMERGENCY');
  assert.equal(emergency.recommendedAction, 'EMERGENCY_DUMP');
});
