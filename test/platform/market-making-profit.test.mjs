import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SolanaMarketMakingEngine } from '../../dist/platform/solana/market-making-engine.js';

describe('ELITE UPDATE 4: Solana Market Making Engine Micro-Imbalance & Skew Yield', () => {
  it('1. Shifts quote center price dynamically based on orderbook queue depth imbalance', () => {
    const engine = new SolanaMarketMakingEngine(10_000_000_000n); // 10 SOL cap

    // Balanced orderbook
    const balancedQuote = engine.calculateQuote({
      poolId: 'sol_usdc_cpmm',
      fairMidPriceSol: 150.0,
      volatilityBps: 20,
      bidQueueDepth: 5,
      askQueueDepth: 5,
    });
    assert.equal(balancedQuote.orderbookImbalanceRatio, 0);

    // Heavy bid depth (buy pressure: bids=9, asks=1)
    const bidHeavyQuote = engine.calculateQuote({
      poolId: 'sol_usdc_cpmm',
      fairMidPriceSol: 150.0,
      volatilityBps: 20,
      bidQueueDepth: 9,
      askQueueDepth: 1,
    });
    assert.ok(bidHeavyQuote.orderbookImbalanceRatio > 0);
    // Price center shifts upwards to capture edge on ask
    assert.ok(bidHeavyQuote.bidPriceSol > balancedQuote.bidPriceSol);
    assert.ok(bidHeavyQuote.askPriceSol > balancedQuote.askPriceSol);

    // Heavy ask depth (sell pressure: bids=1, asks=9)
    const askHeavyQuote = engine.calculateQuote({
      poolId: 'sol_usdc_cpmm',
      fairMidPriceSol: 150.0,
      volatilityBps: 20,
      bidQueueDepth: 1,
      askQueueDepth: 9,
    });
    assert.ok(askHeavyQuote.orderbookImbalanceRatio < 0);
    assert.ok(askHeavyQuote.bidPriceSol < balancedQuote.bidPriceSol);
    assert.ok(askHeavyQuote.askPriceSol < balancedQuote.askPriceSol);
  });

  it('2. Dynamically skews quote sizes asymmetrically based on inventory balance', () => {
    const engine = new SolanaMarketMakingEngine(10_000_000_000n); // 10 SOL cap

    // 0 inventory: neutral 500M / 500M
    const neutralQuote = engine.calculateQuote({
      poolId: 'sol_usdc_cpmm',
      fairMidPriceSol: 150.0,
      volatilityBps: 10,
      bidQueueDepth: 3,
      askQueueDepth: 3,
    });
    assert.equal(neutralQuote.bidSizeLamports, 500_000_000n);
    assert.equal(neutralQuote.askSizeLamports, 500_000_000n);

    // Long 6 SOL (60% capacity): taper bid size, expand ask size to offload inventory
    engine.recordInventory(6_000_000_000n);
    const longQuote = engine.calculateQuote({
      poolId: 'sol_usdc_cpmm',
      fairMidPriceSol: 150.0,
      volatilityBps: 10,
      bidQueueDepth: 3,
      askQueueDepth: 3,
    });
    assert.ok(longQuote.bidSizeLamports < 500_000_000n, 'Bid size must taper down when long');
    assert.ok(longQuote.askSizeLamports > 500_000_000n, 'Ask size must expand when long');

    // Reset to short -4 SOL: expand bid size, taper ask size
    engine.recordInventory(-4_000_000_000n);
    const shortQuote = engine.calculateQuote({
      poolId: 'sol_usdc_cpmm',
      fairMidPriceSol: 150.0,
      volatilityBps: 10,
      bidQueueDepth: 3,
      askQueueDepth: 3,
    });
    assert.ok(shortQuote.bidSizeLamports > 500_000_000n, 'Bid size must expand when short');
    assert.ok(shortQuote.askSizeLamports < 500_000_000n, 'Ask size must taper when short');
  });

  it('3. Calculates expected net spread yield and halts sizes during toxic flow', () => {
    const engine = new SolanaMarketMakingEngine(10_000_000_000n);

    const quote = engine.calculateQuote({
      poolId: 'sol_usdc_cpmm',
      fairMidPriceSol: 150.0,
      volatilityBps: 25,
      bidQueueDepth: 2,
      askQueueDepth: 2,
    });
    // Base 20 + Vol 25 = 45 bps spread; expected net spread yield = 45 - 10 = 35 bps
    assert.equal(quote.spreadBps, 45);
    assert.equal(quote.expectedNetSpreadYieldBps, 35);

    // Inject toxic fills to reach HALTED
    for (let i = 0; i < 20; i++) {
      engine.recordPostFillObservation({
        fillId: `fill_toxic_${i}`,
        fillPriceSol: 150.0,
        fillSide: 'BUY',
        filledAtMs: Date.now() - (20 - i) * 1000,
        price10ms: 149.0,
        price50ms: 148.0,
        price250ms: 145.0,
        price1s: 142.0,
        price5s: 140.0,
      });
    }

    const haltedQuote = engine.calculateQuote({
      poolId: 'sol_usdc_cpmm',
      fairMidPriceSol: 140.0,
      volatilityBps: 20,
      bidQueueDepth: 2,
      askQueueDepth: 2,
    });
    assert.equal(haltedQuote.quoteStatus, 'HALTED');
    assert.equal(haltedQuote.bidSizeLamports, 0n);
    assert.equal(haltedQuote.askSizeLamports, 0n);
  });
});
