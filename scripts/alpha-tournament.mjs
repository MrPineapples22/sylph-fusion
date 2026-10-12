import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const strategies = ['wallet_copy', 'launch_momentum', 'cross_dex_arbitrage', 'execution_optimization'];
const numeric = (v, field) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw Error('INVALID_' + field); return v; };
export function evaluate(rows, { minHoldoutTrades = 20, minNetImprovement = 0 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) throw Error('EMPTY_INPUT');
  const seen = new Set();
  const grouped = new Map();
  for (const r of rows) {
    if (!strategies.includes(r.strategy)) throw Error('UNKNOWN_STRATEGY');
    if (!['train', 'holdout'].includes(r.split)) throw Error('INVALID_SPLIT');
    if (typeof r.eventId !== 'string' || !r.eventId || typeof r.timestamp !== 'string' || !Number.isFinite(Date.parse(r.timestamp))) throw Error('INVALID_EVENT');
    const key = r.strategy + ':' + r.eventId;
    if (seen.has(key)) throw Error('DUPLICATE_OR_LEAKED_EVENT');
    seen.add(key);
    const entry = numeric(r.entryValue, 'entryValue');
    const exit = numeric(r.exitValue, 'exitValue');
    if (entry <= 0 || exit < 0) throw Error('INVALID_NOTIONAL');
    const costs = ['networkFee', 'priorityFee', 'tip', 'priceImpact', 'otherCosts'].reduce((a,k)=>{const v=numeric(r[k],k);if(v<0)throw Error('NEGATIVE_COST');return a+v;},0);
    const pnl = exit - entry - costs;
    const baseline = numeric(r.baselinePnl, 'baselinePnl');
    const k = r.strategy + ':' + r.split;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push({ pnl, baseline, timestamp: Date.parse(r.timestamp), eventId:r.eventId });
  }
  const results = {};
  for (const strategy of strategies) {
    const train = grouped.get(strategy + ':train') ?? [];
    const holdout = grouped.get(strategy + ':holdout') ?? [];
    const lastTrain = Math.max(...train.map(x=>x.timestamp));
    const firstHoldout = Math.min(...holdout.map(x=>x.timestamp));
    const chronologyValid = train.length>0 && holdout.length>0 && lastTrain < firstHoldout;
    const sum = (xs, k) => xs.reduce((a,x)=>a+x[k],0);
    const net = sum(holdout,'pnl'), baseline = sum(holdout,'baseline');
    const improvement = net - baseline;
    const eligible = chronologyValid && holdout.length >= minHoldoutTrades && net>0 && improvement > minNetImprovement;
    results[strategy] = { trainTrades:train.length, holdoutTrades:holdout.length, chronologyValid, holdoutNetPnl:net, holdoutBaselinePnl:baseline, holdoutImprovement:improvement, status: eligible ? 'RESEARCH_CANDIDATE' : 'BLOCKED' };
  }
  return { certification:'NOT_CERTIFIED', liveAuthority:'BLOCKED', results };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2], output = process.argv[3];
  if (!input || !output) { console.error('Usage: node scripts/alpha-tournament.mjs input.json output.json'); process.exit(2); }
  try {
    const raw = readFileSync(input);
    const result = evaluate(JSON.parse(raw.toString('utf8')));
    result.inputSha256 = createHash('sha256').update(raw).digest('hex');
    writeFileSync(output, JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({output,certification:result.certification,results:result.results}));
  } catch(e) { console.error('ALPHA_TOURNAMENT_BLOCKED:',e.message); process.exitCode=1; }
}
