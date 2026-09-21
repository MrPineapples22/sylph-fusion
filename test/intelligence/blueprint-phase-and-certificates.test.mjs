import test from 'node:test';
import assert from 'node:assert/strict';

import { ApprovalCertificateEngine } from '../../dist/intelligence/certificates/approval-certificates.js';
import { MarketPhaseEngine } from '../../dist/intelligence/signals/market-phase-engine.js';
import { StructuralDivergenceEngine } from '../../dist/intelligence/signals/divergence-engine.js';
import { DigitalMarketTwinEngine } from '../../dist/intelligence/twin/market-twin.js';
import { AdversarialSearcher } from '../../dist/intelligence/adversarial/adversarial-search.js';

test('Blueprint Phase 3 & 9 - Three Independent Certificates & ProofState (3/3 vs Fail)', () => {
  const engine = new ApprovalCertificateEngine();
  const mint = 'TokenCertTest1111111111111111111111111111111';

  // Case 1: All 3 pass cleanly -> 3/3 Proof
  const structuralClean = engine.issueStructuralCertificate({
    mint,
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    hasPermanentDelegate: false,
    isNonTransferable: false,
    transferFeeBps: 0,
    unverifiedExtensionsCount: 0,
  });
  assert.equal(structuralClean.valid, true);

  const marketClean = engine.issueMarketCertificate({
    mint,
    independentActorsCount: 8,
    marketAuthenticityScore: 0.85,
    capitalNoveltyRatio: 0.75,
    washVolumeRatio: 0.05,
    topClusterConcentrationPct: 15,
  });
  assert.equal(marketClean.valid, true);

  const executionClean = engine.issueExecutionCertificate({
    mint,
    buyPathValid: true,
    sellPathValid: true,
    roundTripImpactBps: 90,
    robustExitCapacitySol: 4.5,
    routeRedundancyCount: 2,
    quoteAgeMs: 150,
  });
  assert.equal(executionClean.valid, true);

  const proofReport = engine.evaluateProof(structuralClean, marketClean, executionClean);
  assert.equal(proofReport.proofState, '3/3');
  assert.equal(proofReport.validCertificatesCount, 3);
  assert.equal(proofReport.isExecutionReady, true);

  // Case 2: Structural backdoor (Token-2022 freeze authority) -> Structural FAILS, Proof MUST NOT be 3/3
  const structuralBackdoor = engine.issueStructuralCertificate({
    mint,
    hasFreezeAuthority: true,
    hasPermanentDelegate: true,
    transferFeeBps: 900,
  });
  assert.equal(structuralBackdoor.valid, false);
  assert.ok(structuralBackdoor.failureReasons.includes('ACTIVE_FREEZE_AUTHORITY'));
  assert.ok(structuralBackdoor.failureReasons.includes('PERMANENT_DELEGATE_BACKDOOR'));

  const proofFailed = engine.evaluateProof(structuralBackdoor, marketClean, executionClean);
  assert.notEqual(proofFailed.proofState, '3/3');
  assert.equal(proofFailed.isExecutionReady, false, 'Partial failures must NEVER authorize execution');
});

test('Blueprint Phase 6 - Market Phase Engine 9 Bidirectional States & Compact Codes', () => {
  const phaseEngine = new MarketPhaseEngine();
  const mint = 'PhaseToken111111111111111111111111111111111';

  // Expansion / Accumulation
  const reportExpansion = phaseEngine.evaluatePhase(mint, {
    actorGrowthVelocity: 1.2,
    freshCapitalVelocity: 2.5,
    economicVolumeSol: 150,
    liquiditySol: 80,
    exitCapacitySol: 8.0,
    topClusterConcentrationPct: 18,
    sellPressureVelocity: 0.1,
    distanceToFailure: 0.85,
    marketAuthenticityScore: 0.88,
    priceChangePct1h: 15.0,
  });

  assert.ok(
    reportExpansion.currentPhase === 'EXPANSION' || reportExpansion.currentPhase === 'MOMENTUM' || reportExpansion.currentPhase === 'EARLY_ACCUMULATION',
    `Expected growth phase, got ${reportExpansion.currentPhase}`
  );
  assert.ok(['EXPANSION', 'MOMENTUM', 'ACCUM'].includes(reportExpansion.compactPhaseCode));

  // Liquidity Stress / Collapse
  const reportCollapse = phaseEngine.evaluatePhase(mint, {
    actorGrowthVelocity: -0.8,
    freshCapitalVelocity: -2.0,
    economicVolumeSol: 20,
    liquiditySol: 5,
    exitCapacitySol: 0.2, // Severely constrained
    topClusterConcentrationPct: 75,
    sellPressureVelocity: 4.5,
    distanceToFailure: 0.1, // Near breach
    marketAuthenticityScore: 0.2,
    priceChangePct1h: -55.0,
  });

  assert.ok(
    reportCollapse.currentPhase === 'CAPITULATION_COLLAPSE' || reportCollapse.currentPhase === 'LIQUIDITY_STRESS',
    `Expected stress/collapse, got ${reportCollapse.currentPhase}`
  );
  assert.ok(['COLLAPSE', 'STRESS'].includes(reportCollapse.compactPhaseCode));
});

test('Blueprint Phase 6 - Structural Divergence Engine: Price vs Structure Decoupling', () => {
  const divEngine = new StructuralDivergenceEngine();
  const mint = 'DivToken11111111111111111111111111111111111';

  // Scenario: Price rising while underlying structural health drops -> Trap detected
  const report = divEngine.evaluateDivergence({
    mint,
    priceVelocity: 0.25,             // Price jumping
    structuralHealthVelocity: -0.30, // Structure deteriorating
    freshCapitalVelocity: -0.15,     // Fresh capital leaving
    exitCapacityVelocity: -0.20,     // Exit capacity shrinking
    independentActorsVelocity: -0.10,
  });

  assert.equal(report.hasBearishDivergence, true);
  assert.ok(report.divergences.length > 0);
  assert.ok(report.divergences.some(d => d.type === 'PRICE_UP_STRUCTURE_DOWN'));
  assert.equal(report.highestSeverity, 'CRITICAL');
});

test('Blueprint Phase 7 & 8 - Digital Market Twin & Adversarial Search (DTF & Exit Capacity)', () => {
  const twinEngine = new DigitalMarketTwinEngine();
  const searcher = new AdversarialSearcher();
  const mint = 'TwinToken1111111111111111111111111111111111';

  const twinReport = twinEngine.simulateTokenMechanics({
    mint,
    liquidity: {
      mint,
      poolProtocol: 'PUMP_BONDING_CURVE',
      virtualSolReserves: 30,
      virtualTokenReserves: 1_000_000_000,
      realSolReserves: 25,
      realTokenReserves: 750_000_000,
      feeBps: 100,
      lpOwnerAddress: '11111111111111111111111111111111',
      lpLockedPct: 100,
    },
    intendedPositionSol: 0.5,
    whaleHoldingsSol: 3.0,
    topClusterSharePct: 20,
  });

  assert.ok(twinReport.robustExitCapacitySol > 0);
  assert.ok(twinReport.distanceToFailure > 0 && twinReport.distanceToFailure <= 1.0);
  assert.ok(twinReport.simulatedScenarios.length >= 2);

  // Adversarial Search
  const searchReport = searcher.searchAdversarialScenarios({
    mint,
    realLiquiditySol: 25,
    topClusterHoldingSol: 3.0,
    freshCapitalVelocity: 1.0,
    actorGrowthVelocity: 0.8,
    isLpLocked: true,
  });

  assert.ok(searchReport.minimumFailureShockSol > 0);
  assert.ok(searchReport.cascadeSusceptibility >= 0 && searchReport.cascadeSusceptibility <= 1.0);
  assert.ok(searchReport.primaryFailurePath.length > 0);
});
