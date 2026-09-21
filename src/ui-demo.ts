import { startDashboard } from './dashboard.js';
const started = Date.now();
const names = ['Demo11111111111111111111111111111111', 'Demo22222222222222222222222222222222'];
const server = await startDashboard({
  snapshot: () => ({ demo: true, mode: 'paper', wallet: 'OfflinePreview11111111111111111111111', time: Date.now(), startedAt: started, paused: true, halted: false, stopping: false,
    feed: { healthy: true, last: Date.now(), slot: 0 }, cash: '964800000', dayPnl: '4200000', day: new Date().toISOString().slice(0,10),
    positions: names.map((mint, i) => ({ mint, qty: String(126000000 + i * 43200000), cost: '13000000', stage: i, opened: started - 60000, panic: false, mark: { value: String(14200000 + i * 1800000), at: Date.now() } })), pending: null,
    candidates: names.map((mint,i) => ({ mint, age: 18000 + i*1000, buyers: 7+i*2, devSold: false })),
    limits: { positions: 3, exposure: '100000000', dailyLoss: '30000000', buy: '10000000', slippage: 300, stop: 1200, tip: '500000', priority: '200000' },
    events: [{ time: new Date(started).toISOString(), event: 'offline_preview_started', reason: 'Sample data · No trading engine attached' }, { time: new Date(started-12000).toISOString(), event: 'sample_paper_fill', mint: names[0], side: 'buy' }],
  }), setPaused: async () => { throw new Error('Demo is read-only'); },
}, Number(process.env.UI_DEMO_PORT || 8788));
console.log(`Offline UI preview: ${server.url}`);
process.once('SIGINT', () => void server.close()); process.once('SIGTERM', () => void server.close());
