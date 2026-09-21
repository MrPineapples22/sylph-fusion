#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(process.argv[2] || path.join(here, '../sessions/synthetic-test.jsonl'));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const out = fs.createWriteStream(outputPath, { encoding: 'utf8' });
const write = value => out.write(`${JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v)}
`);
const engineFile = fs.existsSync(path.resolve(here, '../dist/execution-engine.js'))
  ? path.resolve(here, '../dist/execution-engine.js')
  : path.resolve(here, '../terminal/dist/execution-engine.js');
const { SimulatedEngine } = await import(pathToFileURL(engineFile).href);
const { ShadowRunner } = await import(pathToFileURL(path.resolve(here, 'shadow-runner.mjs')).href);

const engine = new SimulatedEngine(7, 100_000n, 10_000_000n);
const runner = new ShadowRunner({ engine, fixturePath: path.join(path.dirname(outputPath), '.unused.jsonl'), solPriceUsd: 150, jitoService: {start(){},stop(){}} });
runner.appendEvent = write;
runner.start();
const mint = 'So11111111111111111111111111111111111111112';
const safe = { score: 50, token: { mintAuthority: null, freezeAuthority: null }, markets: [{ lp: { lpBurnedPct: 100 } }], topHolders: [] };
const unsafe = { score: 900, token: { mintAuthority: 'ACTIVE', freezeAuthority: 'ACTIVE' }, markets: [{ lp: { lpBurnedPct: 20 } }], topHolders: [] };
let now = Date.now(); let slot = 106;
const tick = (price, slot, reserves, tokenReport) => { if (!runner.state.assets.some(a => a.id === mint)) runner.state.assets.push({ id: mint, price, history: [{ time: Math.floor(now / 1000), value: price }] }); const t = { mint, priceUsd: price, slot, timestamp: now, reserves, tokenReport }; runner.onMarketTick(t); return t; };
write({ type: 'SESSION_START', timestamp: now, payload: { mode: 'SYNTHETIC' } });
tick(1, 100, { sol: '10000000000', token: '10000000000' }, safe);
const buyPromise = runner.onTradeSignal({ mint, pool: mint, direction: 'BUY', sizeSol: 0.01, maxSlippageBps: 5000, tokenReport: safe });
now += 800; tick(1.025, 102, { sol: '10250000000', token: '9756097560' }, safe);
await buyPromise;
const position = runner.state.positions.find(p => p.asset === mint);
if (position) { now += 800; tick(1.10, 104, { sol: '11000000000', token: '9090909090' }, safe); const sell = runner.onTradeSignal({ mint, pool: mint, direction: 'SELL', tokenQty: position.qty, sizeSol: 0, maxSlippageBps: 5000, emergency: true, tokenReport: safe }); now += 800; tick(1.02, 106, { sol: '10200000000', token: '9803921568' }, safe); await sell; }
await runner.onTradeSignal({ mint: 'RUG11111111111111111111111111111111111111111', pool: mint, direction: 'BUY', sizeSol: 1, tokenReport: unsafe });
const rejections = [
 { mint: 'FRZ11111111111111111111111111111111111111111', report: { score: 850, token: { mintAuthority: null, freezeAuthority: 'ACTIVE' }, markets: [{ lp: { lpBurnedPct: 100 } }], topHolders: [] } },
 { mint: 'UNL11111111111111111111111111111111111111111', report: { score: 750, token: { mintAuthority: null, freezeAuthority: null }, markets: [{ lp: { lpBurnedPct: 15 } }], topHolders: [] } },
 { mint: 'CON11111111111111111111111111111111111111111', report: { score: 600, token: { mintAuthority: null, freezeAuthority: null }, markets: [{ lp: { lpBurnedPct: 100 } }], topHolders: [{ pct: 42.5 }] } },
 { mint: 'LOW11111111111111111111111111111111111111111', report: { score: 750, token: { mintAuthority: null, freezeAuthority: null }, markets: [{ lp: { lpBurnedPct: 10 } }], topHolders: [] } },
 { mint: 'RSK11111111111111111111111111111111111111111', report: { score: 1400, token: { mintAuthority: null, freezeAuthority: null }, markets: [{ lp: { lpBurnedPct: 95 } }], topHolders: [] } }
];
for (const scenario of rejections) { now += 100; await runner.onTradeSignal({ mint: scenario.mint, pool: scenario.mint, direction: 'BUY', sizeSol: 0.01, tokenReport: scenario.report }); }
await runner.stop();
write({ type: 'SESSION_CHECKPOINT', timestamp: now, payload: { cashUsd: runner.state.cash, positions: runner.state.positions } });
await new Promise(resolve => out.end(resolve));
console.log(`Synthetic session generated at: ${outputPath}`);





