#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function selectBest(payload) {
  const entries = payload?.rankings || payload?.results || payload;
  if (!Array.isArray(entries) || !entries.length) throw new Error('No ranking entries found');
  if (entries.some(x => (x?.result || x)?.evidenceClass === 'MODELED')) throw new Error('Research simulations cannot automatically promote trading configuration');
  const ranked = entries.map(x => x?.result || x).filter(x => Number.isFinite(x?.netReturnPct)).sort((a,b) => b.netReturnPct - a.netReturnPct);
  const best = ranked[0], p = best?.params || best;
  if (!p || !Number.isFinite(p.velocity) || !Number.isFinite(p.trailing) || !Number.isInteger(p.slippageBps) || !Array.isArray(p.tp) || p.tp.length !== 3) throw new Error('Invalid top parameter configuration');
  return p;
}
export function transformEngineSource(source, params) {
  const updates={velocity:params.velocity,trailing:params.trailing,slippage:Number((params.slippageBps/100).toFixed(2)),tp1:params.tp[0],tp2:params.tp[1],tp3:params.tp[2]}; let out=source;
  for(const [key,val] of Object.entries(updates)){const re=new RegExp(`(${key}\\s*:\\s*)[\\d.]+`); if(!re.test(out)) throw new Error(`Missing config key: ${key}`); out=out.replace(re,`$1${val}`);} return out;
}
const root=dirname(dirname(fileURLToPath(import.meta.url)));
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) { try { const path=resolve(process.cwd(),process.argv[2]||'results.json'), engine=resolve(root,'terminal/src/engine.js'); const p=selectBest(JSON.parse(readFileSync(path,'utf8'))); writeFileSync(engine,transformEngineSource(readFileSync(engine,'utf8'),p)); console.log('Applied sweep configuration.'); } catch(e){ console.error(`Failed to apply configuration: ${e.message}`); process.exitCode=1; } }
