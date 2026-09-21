import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleExecutionFilled,
  handleExecutionRejected
} from '../terminal/src/terminal-reducer-handlers.js';

const POOL = 'So11111111111111111111111111111111111111112';
const MINT = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function baseState() {
  return {
    cash: 100_000_000_000n,
    balanceLamports: 100_000_000_000n,
    positions: [],
    positionsByPool: {},
    activeOverlays: {},
    tape: []
  };
}

function order(orderId, side, amountLamports, emergency = false) {
  return { orderId, tokenMint: MINT, poolAddress: POOL, side, amountLamports,
    maxSlippageBps: emergency ? 5000 : 300, triggerTimestamp: Date.now(), emergency };
}

test('parity: filled BUY updates cash, position, overlay, and tape', () => {
  const state = baseState();
  const o = order('buy-01', 'BUY', 1_000_000_000n);
  const report = { orderId: o.orderId, status: 'FILLED', execPrice: 0.00005,
    inputAmount: o.amountLamports, outputAmount: 20_000_000_000n,
    priorityFeeLamports: 50_000n, jitoTipLamports: 100_000n, slotLatency: 1 };
  const telemetry = { engineMode: 'PAPER', simulatedSlotLagMs: 400, priceImpactPct: 0.8,
    preTradeReserves: { sol: 50_000_000_000n, token: 1_000_000_000_000n },
    postTradeReserves: { sol: 51_000_000_000n, token: 980_000_000_000n } };
  const next = handleExecutionFilled(state, { order: o, report, telemetry });
  assert.equal(next.cash, 98_999_850_000n);
  assert.equal(next.positionsByPool[POOL].remainingTokens, 20_000_000_000n);
  assert.equal(next.positions[0].remainingTokens, 20_000_000_000n);
  assert.equal(next.activeOverlays[POOL].sol, 51_000_000_000n);
  assert.equal(next.tape[0].status, 'FILLED');
});

test('parity: partial SELL advances ladder and realized PnL', () => {
  const state = baseState();
  const position = { poolAddress: POOL, tokenMint: MINT, entryPrice: 0.00005,
    amount: 20_000_000_000n, totalTokens: 20_000_000_000n, remainingTokens: 20_000_000_000n,
    realizedPnlLamports: 0n, ladderStep: 0 };
  state.positions = [position]; state.positionsByPool = { [POOL]: { ...position } };
  const o = order('sell-01', 'SELL', 6_000_000_000n);
  const report = { orderId: o.orderId, status: 'FILLED', execPrice: 0.00006,
    inputAmount: o.amountLamports, outputAmount: 360_000_000n,
    priorityFeeLamports: 50_000n, jitoTipLamports: 100_000n, slotLatency: 1 };
  const telemetry = { engineMode: 'PAPER', simulatedSlotLagMs: 400, priceImpactPct: 0.5,
    preTradeReserves: { sol: 51_000_000_000n, token: 980_000_000_000n },
    postTradeReserves: { sol: 50_640_000_000n, token: 986_000_000_000n } };
  const next = handleExecutionFilled(state, { order: o, report, telemetry });
  assert.equal(next.positionsByPool[POOL].remainingTokens, 14_000_000_000n);
  assert.equal(next.positionsByPool[POOL].ladderStep, 1);
  // Legacy reducer and migrated handler share the same raw-unit cost-basis convention.
  assert.equal(next.positionsByPool[POOL].realizedPnlLamports, 359_550_000n);
  assert.equal(next.activeOverlays[POOL].sol, 50_640_000_000n);
});

test('parity: emergency SELL evicts position and overlay', () => {
  const state = baseState();
  const position = { poolAddress: POOL, tokenMint: MINT, entryPrice: 0.00005,
    amount: 14_000_000_000n, remainingTokens: 14_000_000_000n, realizedPnlLamports: 0n, ladderStep: 1 };
  state.positions = [position]; state.positionsByPool = { [POOL]: { ...position } };
  const o = order('panic-01', 'SELL', 14_000_000_000n, true);
  const report = { orderId: o.orderId, status: 'FILLED', execPrice: 0.00003,
    inputAmount: o.amountLamports, outputAmount: 420_000_000n,
    priorityFeeLamports: 50_000n, jitoTipLamports: 100_000n, slotLatency: 1 };
  const telemetry = { engineMode: 'PAPER', simulatedSlotLagMs: 400, priceImpactPct: 8.5,
    preTradeReserves: { sol: 50_640_000_000n, token: 986_000_000_000n },
    postTradeReserves: { sol: 50_220_000_000n, token: 1_000_000_000_000n } };
  const next = handleExecutionFilled(state, { order: o, report, telemetry });
  assert.equal(next.positionsByPool[POOL], undefined);
  assert.equal(next.positions.length, 0);
  assert.equal(next.activeOverlays[POOL], undefined);
  assert.equal(next.tape[0].emergency, true);
});

test('parity: rejected BUY charges priority fee only', () => {
  const state = baseState();
  const o = order('reject-01', 'BUY', 1_000_000_000n);
  const report = { orderId: o.orderId, status: 'REJECTED', execPrice: 0,
    inputAmount: o.amountLamports, outputAmount: 0n,
    priorityFeeLamports: 50_000n, jitoTipLamports: 0n, slotLatency: 1,
    failureReason: 'SLIPPAGE_EXCEEDED' };
  const next = handleExecutionRejected(state, { order: o, report });
  assert.equal(next.cash, 99_999_950_000n);
  assert.equal(next.balanceLamports, 99_999_950_000n);
  assert.equal(next.tape[0].status, 'REJECTED');
  assert.equal(next.tape[0].failureReason, 'SLIPPAGE_EXCEEDED');
});
