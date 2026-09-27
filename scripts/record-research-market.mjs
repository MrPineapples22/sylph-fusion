#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function observationFrame(snapshot, observedAt, previous = new Map()) {
  if (!Array.isArray(snapshot?.rows) || snapshot.feedStale !== false) throw new Error('Discovery feed unavailable or stale');
  const assets = [], seen = new Set();
  for (const row of snapshot.rows) {
    if (typeof row.mint !== 'string' || !row.mint || seen.has(row.mint)) continue;
    seen.add(row.mint);
    if (!Number.isFinite(row.price) || row.price <= 0 || !Number.isFinite(row.at) ||
        row.at > observedAt || observedAt - row.at > 5000 ||
        !Number.isFinite(row.volume5m) || row.volume5m < 0) continue;
    const prior = previous.get(row.mint);
    const elapsedSeconds = prior ? (row.at - prior.at) / 1000 : 0;
    const velocity = elapsedSeconds > 0 ? (row.price / prior.price - 1) * 100 / elapsedSeconds : 0;
    if (!Number.isFinite(velocity)) continue;
    assets.push({ id: row.mint, price: row.price, velocity, volume: row.volume5m,
      availableAt: observedAt, sourceAt: row.at, source: 'local-discovery-projection',
      safety: row.safety ?? 'UNKNOWN', venue: row.dex ?? 'UNKNOWN' });
    if (!prior || row.at > prior.at) previous.set(row.mint, { price: row.price, at: row.at });
  }
  // An absent token must restart its velocity baseline when it returns.
  for (const id of previous.keys()) if (!assets.some(a => a.id === id)) previous.delete(id);
  return { timestamp: observedAt, assets };
}

export async function recordResearchMarket({ output, durationSeconds = 60, intervalMs = 2000,
  origin = 'http://127.0.0.1:8793' } = {}) {
  const url = new URL('/api/discovery', origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Recorder accepts only a local HTTP Sylph terminal');
  }
  if (!output || !Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 86400 ||
      !Number.isInteger(intervalMs) || intervalMs < 500 || intervalMs > 60000) throw new Error('Invalid recording options');
  const result = { schema: 'sylph-research-ticks-v1', provenance: {
    kind: 'recorded-market', source: 'local-discovery-projection', endpoint: url.href,
    independentlyVerified: false, velocityUnit: 'percent-per-second',
    warning: 'Discovery coverage and prices are observations, not executable quotes or token safety evidence.'
  }, failedPolls: 0, ticks: [] };
  // Reserve the new artifact before polling; never overwrite a prior session.
  writeFileSync(resolve(output), JSON.stringify(result, null, 2), { flag: 'wx' });
  const started = Date.now(), previous = new Map();
  while (Date.now() - started < durationSeconds * 1000) {
    const pollStarted = Date.now();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = await response.json();
      result.ticks.push(observationFrame(snapshot, Date.now(), previous));
    } catch {
      result.failedPolls++;
      previous.clear();
      result.ticks.push({ timestamp: Date.now(), assets: [] });
    }
    // Checkpoint each frame so interrupted sessions remain readable.
    writeFileSync(resolve(output), JSON.stringify(result, null, 2) + '\n');
    const wait = Math.min(intervalMs - (Date.now() - pollStarted), durationSeconds * 1000 - (Date.now() - started));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
  return { frames: result.ticks.length, failedPolls: result.failedPolls, output: resolve(output) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  recordResearchMarket({ output: process.argv[2], durationSeconds: Number(process.argv[3] ?? 60) })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
