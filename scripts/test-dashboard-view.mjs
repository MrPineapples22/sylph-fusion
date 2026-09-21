#!/usr/bin/env node
import { DashboardUI } from './ui-dashboard.mjs';

const ui = new DashboardUI();
let count = 0;
const timer = setInterval(() => {
  const slot = 284910200 + ++count;
  ui.observe({ type: 'TICK', asset: 'SYNTHETIC JUP', price: .8421, slot, timestamp: Date.now(), reserves: { sol: '42150382910000', token: '7508920194000' } });
  if (count % 3 === 0) ui.observe({ type: 'ORDER_REJECTED', payload: { reason: 'Synthetic slippage rejection' } });
  else if (count % 5 === 0) ui.observe({ type: 'ORDER_FILLED', payload: { direction: 'BUY', mint: 'SYNTHETIC JUP' } });
  if (process.stderr.isTTY || count === 10) ui.render({
    status: 'SYNTHETIC DISPLAY DEMO', solPriceUsd: 150, tokenDecimals: 9,
    rugReport: { score: 12, token: { mintAuthority: null, freezeAuthority: null }, markets: [{ lp: { lpBurnedPct: 100 } }] },
    cash: 7500, positions: [], realizedPnl: 0
  });
  if (count === 10) { clearInterval(timer); process.stderr.write('Dashboard display demo complete. No trades were executed.\n'); }
}, 500);
process.once('SIGINT', () => { clearInterval(timer); process.stderr.write('Dashboard demo stopped.\n'); });

