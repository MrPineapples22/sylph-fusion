import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CommandGateway } from '../dist/command-gateway.js';
import { globalLifecycle } from '../dist/lifecycle/system-lifecycle.js';

describe('ELITE UPDATE 2: Command Gateway Dynamic Conviction Sizing for Maximum Profit', () => {
  let gateway;

  beforeEach(() => {
    globalLifecycle.bootstrapToHealthy();
    gateway = CommandGateway.resetInstance();
    gateway.setCashUsd(10_000);
  });

  it('1. Dynamically sizes BUY order based on alpha conviction (PRIME, HSI 95, POD UP) when usdAmount is omitted', async () => {
    const mintPrime = 'PrimeMint11111111111111111111111111111111111';
    const poolPrime = 'PrimePool11111111111111111111111111111111111';

    // Mock fresh market evidence provider
    gateway.setPaperEntryEvidenceProvider(async (mint, pool) => ({
      mint,
      poolAddress: pool,
      priceUsd: 1.0,
      liquidityUsd: 100_000,
      observedAt: Date.now(),
      solPriceUsd: 150,
      solObservedAt: Date.now(),
      marketObservationValid: true,
      source: 'test_oracle',
      entryAllowed: true,
    }));

    const res = await gateway.handleSubmitOrder({
      commandId: 'cmd_prime_buy_1',
      type: 'SUBMIT_ORDER',
      timestamp: Date.now(),
      initiator: 'operator_test',
      payload: {
        mint: mintPrime,
        poolAddress: poolPrime,
        side: 'BUY',
        symbol: 'PRIME',
        tier: 'PRIME',
        pod: 'UP',
        highSignalIndex: 95,
        liquidity: 100_000,
        priceUsd: 1.0,
      },
    });

    assert.equal(res.success, true);
    const pos = gateway.getPosition(poolPrime);
    assert.ok(pos, 'Position must be opened');
    assert.ok(pos.costBasisUsd > 0);
    assert.ok(pos.convictionMultiplier !== undefined, 'Conviction multiplier must be populated');
    assert.ok(pos.convictionMultiplier >= 1.0, 'PRIME + HSI 95 + UP pod must achieve >= 1.0 conviction multiplier');
    assert.ok(pos.confidenceGrade !== undefined, 'Confidence grade must be populated');
    assert.ok(pos.processEvidenceRef?.includes(pos.confidenceGrade), 'Process evidence ref must reflect confidence grade');
  });

  it('2. Defensively scales down sizing for lower conviction token (WATCH, HSI 65, POD DOWN)', async () => {
    const mintDef = 'DefensiveMint111111111111111111111111111111';
    const poolDef = 'DefensivePool111111111111111111111111111111';

    gateway.setPaperEntryEvidenceProvider(async (mint, pool) => ({
      mint,
      poolAddress: pool,
      priceUsd: 0.5,
      liquidityUsd: 50_000,
      observedAt: Date.now(),
      solPriceUsd: 150,
      solObservedAt: Date.now(),
      marketObservationValid: true,
      source: 'test_oracle',
      entryAllowed: true,
    }));

    const res = await gateway.handleSubmitOrder({
      commandId: 'cmd_watch_buy_2',
      type: 'SUBMIT_ORDER',
      timestamp: Date.now(),
      initiator: 'operator_test',
      payload: {
        mint: mintDef,
        poolAddress: poolDef,
        side: 'BUY',
        symbol: 'WATCH',
        tier: 'WATCH',
        pod: 'DOWN',
        highSignalIndex: 65,
        liquidity: 50_000,
        priceUsd: 0.5,
      },
    });

    assert.equal(res.success, true);
    const pos = gateway.getPosition(poolDef);
    assert.ok(pos, 'Defensive position must be opened');
    assert.ok(pos.convictionMultiplier !== undefined);
    assert.ok(pos.convictionMultiplier < 0.8, 'WATCH + HSI 65 + DOWN pod must receive discounted conviction multiplier');
  });

  it('3. Explicit usdAmount continues to take precedence while capped by risk authority', async () => {
    const mintExp = 'ExplicitMint1111111111111111111111111111111';
    const poolExp = 'ExplicitPool1111111111111111111111111111111';

    gateway.setPaperEntryEvidenceProvider(async (mint, pool) => ({
      mint,
      poolAddress: pool,
      priceUsd: 2.0,
      liquidityUsd: 100_000,
      observedAt: Date.now(),
      solPriceUsd: 150,
      solObservedAt: Date.now(),
      marketObservationValid: true,
      source: 'test_oracle',
      entryAllowed: true,
    }));

    const explicitAmount = 250.0;
    const res = await gateway.handleSubmitOrder({
      commandId: 'cmd_exp_buy_3',
      type: 'SUBMIT_ORDER',
      timestamp: Date.now(),
      initiator: 'operator_test',
      payload: {
        mint: mintExp,
        poolAddress: poolExp,
        side: 'BUY',
        usdAmount: explicitAmount,
        priceUsd: 2.0,
      },
    });

    assert.equal(res.success, true);
    const pos = gateway.getPosition(poolExp);
    assert.ok(pos);
    // Cost basis should be approximately explicitAmount plus tiny network fee
    assert.ok(Math.abs(pos.costBasisUsd - explicitAmount) < 5.0);
  });
});
