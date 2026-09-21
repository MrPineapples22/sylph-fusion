#!/usr/bin/env node
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const clean = value => String(value ?? 'Unknown').replace(/[\x00-\x1f\x7f-\x9f]/g, '').replace(/\[[0-9;]*m/g, '');
const number = (value, places = 4) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(places) : 'Unknown';
const authority = (token, key) => token && Object.hasOwn(token, key) ? token[key] === null ? 'REVOKED' : 'ACTIVE / UNVERIFIED' : 'UNKNOWN';
function atomic(value, decimals) {
  try {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 || !/^\d+$/.test(String(value))) return 'Unknown';
    const n = BigInt(value), scale = 10n ** BigInt(decimals);
    return `${n / scale}.${(n % scale).toString().padStart(decimals, '0').slice(0, 4) || '0'}`;
  } catch { return 'Unknown'; }
}

export class DashboardUI {
  constructor({ stream = process.stderr } = {}) {
    this.stream = stream;
    this.data = { fills: 0, rejections: 0, events: [], status: 'WAITING' };
  }
  observe(event) {
    const p = event.payload || {}, d = this.data;
    if (event.type === 'SESSION_START') { d.started = event.timestamp; d.status = 'CAPTURING'; }
    if (event.type === 'TICK') Object.assign(d, { mint: event.asset, slot: event.slot, priceUsd: event.price, reserves: event.reserves, lastTick: event.timestamp });
    if (event.type === 'ORDER_FILLED') d.fills++;
    if (event.type === 'ORDER_REJECTED') d.rejections++;
    if (event.type === 'SESSION_CHECKPOINT') Object.assign(d, { status: 'CHECKPOINT RECORDED', cash: p.cash ?? p.cashUsd, positions: p.positions });
    d.events = [...d.events, clean(`${event.type} ${p.direction || ''} ${p.mint || event.asset || ''} ${p.reason || ''}`)].slice(-5);
  }
  progressBar(ratio, width = 30) {
    const filled=Math.round(Math.max(0,Math.min(1,Number.isFinite(ratio)?ratio:0))*width);
    return '#'.repeat(filled)+'-'.repeat(width-filled);
  }
  format(extra = {}) {
    const d = { ...this.data, ...extra }, report = d.rugReport;
    const width = Math.max(32, Math.min(100, (this.stream.columns || 100) - 1));
    const row = text => `| ${clean(text).slice(0, width - 4).padEnd(width - 4)} |`;
    const bar = '+' + '-'.repeat(width - 2) + '+';
    const total = d.fills + d.rejections;
    const selectivity = total ? `${(100 * d.rejections / total).toFixed(1)}%` : 'No evaluated signals';
    const lp = report?.markets?.map(m => m.lp?.lpBurnedPct).filter(Number.isFinite) || [];
    return [bar, row(`SYLPH-FUSION | PAPER SHADOW | ${d.status}`),
      row(`Target: ${d.mint || 'Unknown'}`), row(`Slot/sequence: ${d.slot ?? 'Unknown'} | Tick age: ${Number.isFinite(d.lastTick) ? Math.max(0, Date.now() - d.lastTick) + 'ms' : 'Unknown'}`),
      bar, row('1. POOL OBSERVATIONS (bridge reserves/slots are estimates)'),
      row(`USD price: ${number(d.priceUsd, 8)} | SOL price: ${number(d.solPriceUsd > 0 ? d.priceUsd / d.solPriceUsd : undefined, 8)}`),
      row(`SOL reserve: ${atomic(d.reserves?.sol, 9)} SOL`),
      row(`Token reserve: ${d.tokenDecimals == null ? clean(d.reserves?.token) + ' raw units (decimals unknown)' : atomic(d.reserves?.token, d.tokenDecimals)}`),
      bar, row('2. PREFLIGHT REPORT'), row(`Risk score: ${number(report?.score, 0)}`),
      row(`Mint: ${authority(report?.token, 'mintAuthority')} | Freeze: ${authority(report?.token, 'freezeAuthority')}`),
      row(`Highest reported LP burn: ${lp.length ? number(Math.max(...lp), 1) + '%' : 'Unknown'}`),
      bar, row('3. LEDGER'), row(`Cash USD: ${number(d.cash, 8)} | Realized PnL: ${number(d.realizedPnl, 8)}`),
      row(`Open positions: ${Array.isArray(d.positions) ? d.positions.length : 'Unknown'} (open inventory is not necessarily dust)`),
      row(`Cash delta: ${number(d.cashDelta, 8)} | Replay parity: ${typeof d.isDeterministicMatch === 'boolean' ? d.isDeterministicMatch ? 'PASS' : 'FAIL' : 'NOT VERIFIED'}`),
      bar, row('4. SIGNAL CONVERSION'), row(`Evaluated: ${total} | Fills: ${d.fills} | Rejected: ${d.rejections}`),
      row(`Rejection rate: ${selectivity} | 70-85% is a synthetic fixture target`),
      row('['+this.progressBar(total?d.rejections/total:0,Math.max(8,width-6))+']'),
      bar, row('5. LATEST EVENTS'), ...d.events.map(row), bar,
      row('Ctrl+C: request shutdown and checkpoint'), bar].join('\n') + '\n';
  }
  render(extra = {}) {
    let text = this.format(extra);
    if(this.stream.isTTY && this.stream.rows){
      const lines=text.trimEnd().split('\n'),limit=Math.max(4,this.stream.rows-1);
      if(lines.length>limit)text=[...lines.filter((line,i)=>i===0||i===lines.length-1||!/^\+[-]+\+$/.test(line)).slice(0,limit-1),'Resize terminal for more detail.'].join('\n')+'\n';
    }
    this.stream.write(this.stream.isTTY ? `\x1b[H\x1b[J\x1b[36m${text}\x1b[0m` : text);
  }
}

// Standalone view: node scripts/ui-dashboard.mjs < session.jsonl
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ui = new DashboardUI();
  for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    try { ui.observe(JSON.parse(line)); } catch { continue; }
    if (process.stderr.isTTY) ui.render();
  }
  ui.render();
}
