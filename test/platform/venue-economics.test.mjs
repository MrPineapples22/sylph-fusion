import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VenueEconomicsAuthority,
  PortfolioExitNet
} from '../../dist/platform/execution/venue-economics.js';

describe('VENUE ECONOMICS & PORTFOLIO EXITNET (Sections 55, 56)', () => {
  it('selects venue optimizing net round-trip executable EV and rejects trapping risks', () => {
    const authority = new VenueEconomicsAuthority();
    const mint = 'TokenTest111111111111111111111111111111111';

    // Venue 1: PumpFun bonding curve (low friction, high landing)
    const pumpFunVenue = {
      venue: 'PUMP_FUN',
      entryPriceLamports: 1000n,
      entryFeeLamports: 10000n,
      entryImpactBps: 50,
      expectedExitPriceLamports: 1000n,
      expectedExitFeeLamports: 10000n,
      expectedExitImpactBps: 60,
      landingProbability: 0.98,
      capitalTrappingRiskBps: 100, // 1%
      netRoundTripCostLamports: 25000n,
      isViable: true
    };

    // Venue 2: Illiquid AMM pool (high trapping risk: 15% exit depth penalty)
    const thinAmmVenue = {
      venue: 'RAYDIUM',
      entryPriceLamports: 990n, // Slightly cheaper headline price
      entryFeeLamports: 25000n,
      entryImpactBps: 200,
      expectedExitPriceLamports: 950n,
      expectedExitFeeLamports: 30000n,
      expectedExitImpactBps: 500,
      landingProbability: 0.80, // Poor landing
      capitalTrappingRiskBps: 1500, // 15% trapping risk (exceeds max 800)
      netRoundTripCostLamports: 85000n,
      isViable: true
    };

    const cert = authority.evaluateRoundTripEconomics({
      mint,
      evaluatedAmountLamports: 100000000n, // 0.1 SOL
      slot: 289450000,
      venueCandidates: [pumpFunVenue, thinAmmVenue]
    });

    assert.equal(cert.isApprovedForEntry, true);
    assert.equal(cert.selectedVenue.venue, 'PUMP_FUN');
    assert.equal(cert.selectedVenue.netRoundTripCostLamports, 25000n);
    assert.ok(cert.certificateId.startsWith('ROUNDTRIP-'));
  });

  it('PortfolioExitNet scales down position size when candidates share liquidation bottlenecks', () => {
    const exitNet = new PortfolioExitNet();

    // Register active existing position in Pool A with Creator X
    exitNet.registerPosition({
      mint: 'ExistingToken11111111111111111111111111111',
      poolAddress: 'PoolAlpha111111111111111111111111111111111',
      creatorPubkey: 'CreatorX111111111111111111111111111111111',
      routeType: 'RAYDIUM_V4',
      quoteAssetMint: 'SOL',
      writableLockAccounts: ['LockAccountA', 'LockAccountB'],
      marketRegime: 'TRENDING'
    });

    // 1. Independent candidate (shares nothing) -> full 1.0 scale
    const independentEval = exitNet.evaluateMarginalExitRisk({
      mint: 'CandidateToken22222222222222222222222222222',
      poolAddress: 'PoolBeta111111111111111111111111111111111',
      creatorPubkey: 'CreatorY111111111111111111111111111111111',
      routeType: 'PUMP_FUN',
      quoteAssetMint: 'SOL',
      writableLockAccounts: ['LockAccountC'],
      marketRegime: 'TRENDING'
    });

    assert.equal(independentEval.marginalExitRiskMultiplier, 1.0);
    assert.equal(independentEval.maxRecommendedPositionScale, 1.0);
    assert.equal(independentEval.isLiquidationChoked, false);

    // 2. Correlated candidate (shares Pool A and LockAccount B with existing position)
    const bottleneckedEval = exitNet.evaluateMarginalExitRisk({
      mint: 'CandidateToken33333333333333333333333333333',
      poolAddress: 'PoolAlpha111111111111111111111111111111111', // Shared pool!
      creatorPubkey: 'CreatorZ111111111111111111111111111111111',
      routeType: 'RAYDIUM_V4',
      quoteAssetMint: 'SOL',
      writableLockAccounts: ['LockAccountB'], // Shared lock!
      marketRegime: 'TRENDING'
    });

    // Multiplier = 1.0 + 0.5 (pool) + 0.3 (lock) = 1.8
    assert.ok(bottleneckedEval.marginalExitRiskMultiplier >= 1.8);
    // Position scale = 1 / 1.8 ~= 0.55 (scaled down)
    assert.ok(bottleneckedEval.maxRecommendedPositionScale < 0.6);
  });

  it('correctly calculates net round-trip EV and enforces requirePositiveEV gate', () => {
    const authority = new VenueEconomicsAuthority();
    const mint = 'TokenEVTest11111111111111111111111111111111';

    const venue = {
      venue: 'PUMP_FUN',
      entryPriceLamports: 1000n,
      entryFeeLamports: 10000n,
      entryImpactBps: 50,
      expectedExitPriceLamports: 1000n,
      expectedExitFeeLamports: 10000n,
      expectedExitImpactBps: 50,
      landingProbability: 0.99,
      capitalTrappingRiskBps: 50,
      netRoundTripCostLamports: 20000n, // 0.00002 SOL cost
      isViable: true
    };

    // 1. Without alpha, net EV is -netRoundTripCostLamports
    const certWithoutAlpha = authority.evaluateRoundTripEconomics({
      mint,
      evaluatedAmountLamports: 100000000n,
      slot: 289450010,
      venueCandidates: [venue]
    });

    assert.equal(certWithoutAlpha.isApprovedForEntry, true);
    assert.equal(certWithoutAlpha.expectedAlphaLamports, 0n);
    assert.equal(certWithoutAlpha.expectedNetRoundTripEVLamports, -20000n);
    assert.equal(certWithoutAlpha.estimatedNetTerminalCapitalLamports, 100000000n - 20000n);

    // 2. With requirePositiveEV enabled and zero alpha -> rejected fail-closed
    const certRejected = authority.evaluateRoundTripEconomics({
      mint,
      evaluatedAmountLamports: 100000000n,
      slot: 289450011,
      venueCandidates: [venue],
      requirePositiveEV: true
    });

    assert.equal(certRejected.isApprovedForEntry, false);
    assert.ok(certRejected.rejectionReason.includes('Negative expected round-trip EV'));

    // 3. With positive alpha exceeding round-trip cost -> approved
    const certWithAlpha = authority.evaluateRoundTripEconomics({
      mint,
      evaluatedAmountLamports: 100000000n,
      slot: 289450012,
      venueCandidates: [venue],
      expectedAlphaLamports: 50000n,
      requirePositiveEV: true
    });

    assert.equal(certWithAlpha.isApprovedForEntry, true);
    assert.equal(certWithAlpha.expectedAlphaLamports, 50000n);
    assert.equal(certWithAlpha.expectedNetRoundTripEVLamports, 30000n); // 50000 - 20000
    assert.equal(certWithAlpha.estimatedNetTerminalCapitalLamports, 100000000n + 30000n);
  });
});

