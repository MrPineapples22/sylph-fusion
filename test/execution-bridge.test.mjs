import test from 'node:test';
import assert from 'node:assert/strict';
import { orderFromUsd, fillToTerminal, tokenQtyToBaseUnits } from '../terminal/src/execution-bridge.js';

test('execution bridge converts USD BUY to exact SOL lamports', () => {
  const order = orderFromUsd({ orderId: 'b1', tokenMint: 'm', poolAddress: 'p', side: 'BUY', usdAmount: 200, solPriceUsd: 100 });
  assert.equal(order.amountLamports, 2_000_000_000n);
  assert.equal(order.amountDecimals, 9);
});

test('execution bridge converts fills to USD and token display units', () => {
  const view = fillToTerminal({ solPriceUsd: 100, tokenDecimals: 6, report: {
    status: 'FILLED', execPrice: 200, inputAmount: 1_000_000_000n,
    outputAmount: 5_000_000n, priorityFeeLamports: 50_000n, jitoTipLamports: 100_000n,
    slotLatency: 2
  }});
  assert.equal(view.priceUsd, 20);
  assert.equal(view.inputUsd, 100);
  assert.equal(view.feesUsd, 0.015);
  assert.equal(view.outputTokens, 5);
});

test('token quantity conversion preserves decimal precision', () => {
  assert.equal(tokenQtyToBaseUnits(1.25, 6), 1_250_000n);
});
