import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VenueEconomicsAuthority } from '../../dist/platform/execution/venue-economics.js';

describe('ELITE UPDATE 5: Venue Economics Multi-Venue Split Route Optimizer', () => {
  it('1. Computes optimal split allocation across multiple AMMs minimizing aggregate price impact', () => {
    const authority = new VenueEconomicsAuthority();
    const mint = 'TokenSplit111111111111111111111111111111111';

    // Candidate 1: Raydium (100 bps impact for full size, 0.95 landing)
    const raydium = {
      venue: 'RAYDIUM',
      entryPriceLamports: 1000n,
      entryFeeLamports: 20000n,
      entryImpactBps: 100,
      expectedExitPriceLamports: 1000n,
      expectedExitFeeLamports: 20000n,
      expectedExitImpactBps: 100,
      landingProbability: 0.95,
      capitalTrappingRiskBps: 150,
      netRoundTripCostLamports: 50000n,
      isViable: true,
    };

    // Candidate 2: Meteora DLMM (150 bps impact for full size, 0.92 landing)
    const meteora = {
      venue: 'METEORA',
      entryPriceLamports: 1000n,
      entryFeeLamports: 25000n,
      entryImpactBps: 150,
      expectedExitPriceLamports: 1000n,
      expectedExitFeeLamports: 25000n,
      expectedExitImpactBps: 150,
      landingProbability: 0.92,
      capitalTrappingRiskBps: 200,
      netRoundTripCostLamports: 60000n,
      isViable: true,
    };

    const cert = authority.evaluateOptimalSplitRoute({
      mint,
      totalAmountLamports: 10_000_000_000n, // 10 SOL
      slot: 290000100,
      venueCandidates: [raydium, meteora],
    });

    assert.equal(cert.isSplitAdvantageous, true);
    assert.equal(cert.legs.length, 2);
    // Best single venue was Raydium at 100 bps
    assert.equal(cert.singleVenueBestImpactBps, 100);
    // Splitting saves slippage bps
    assert.ok(cert.aggregateImpactBps < 100, `Aggregate impact ${cert.aggregateImpactBps} must be lower than single venue 100 bps`);
    assert.ok(cert.slippageSavingsBps > 0);
    assert.ok(cert.slippageSavingsLamports > 0n);
    assert.ok(cert.certificateId.startsWith('SPLIT-'));
    assert.equal(cert.totalEvaluatedAmountLamports, 10_000_000_000n);

    // Sum of leg allocations must exactly equal totalAmountLamports
    const totalAllocated = cert.legs.reduce((sum, leg) => sum + leg.allocatedAmountLamports, 0n);
    assert.equal(totalAllocated, 10_000_000_000n);

    // Deeper venue (Raydium, 100 bps) receives higher allocation than shallower venue (Meteora, 150 bps)
    const raydiumLeg = cert.legs.find(l => l.venue === 'RAYDIUM');
    const meteoraLeg = cert.legs.find(l => l.venue === 'METEORA');
    assert.ok(raydiumLeg.allocationFractionPct > meteoraLeg.allocationFractionPct);
  });

  it('2. Gracefully handles single viable venue without synthetic split', () => {
    const authority = new VenueEconomicsAuthority();
    const mint = 'TokenSingle1111111111111111111111111111111';

    const pumpFun = {
      venue: 'PUMP_FUN',
      entryPriceLamports: 1000n,
      entryFeeLamports: 10000n,
      entryImpactBps: 40,
      expectedExitPriceLamports: 1000n,
      expectedExitFeeLamports: 10000n,
      expectedExitImpactBps: 40,
      landingProbability: 0.98,
      capitalTrappingRiskBps: 50,
      netRoundTripCostLamports: 25000n,
      isViable: true,
    };

    const cert = authority.evaluateOptimalSplitRoute({
      mint,
      totalAmountLamports: 2_000_000_000n,
      slot: 290000101,
      venueCandidates: [pumpFun],
    });

    assert.equal(cert.legs.length, 1);
    assert.equal(cert.legs[0].allocationFractionPct, 100);
    assert.equal(cert.slippageSavingsBps, 0);
    assert.equal(cert.isSplitAdvantageous, false);
  });
});
