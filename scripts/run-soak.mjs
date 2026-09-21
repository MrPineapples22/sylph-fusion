import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { runEngine } from '../dist/fusion.js';
import { readLatestSoakSession } from '../terminal/soak-reader.mjs';

if (existsSync('.env')) {
  try { process.loadEnvFile('.env'); } catch { /* ignore */ }
}

const args = process.argv.slice(2);
const durationArg = args.find(a => a.startsWith('--duration='));
const durationSec = durationArg ? Math.max(10, parseInt(durationArg.split('=')[1], 10)) : 86_400; // default 24h

const nowStr = new Date().toISOString().replace(/[:.]/g, '-');
const sessionDirArg = args.find(a => a.startsWith('--session-dir='));
const sessionDir = resolve(sessionDirArg ? sessionDirArg.split('=')[1] : `sessions/soak-${nowStr}`);
const dbPath = join(sessionDir, 'soak.sqlite');

console.log(`=== SYLPH FUSION CONTROLLED SOAK RUNNER ===`);
console.log(`Target Duration : ${durationSec}s (${(durationSec / 3600).toFixed(1)} hours)`);
console.log(`Execution Mode  : paper (ENFORCED)`);
console.log(`Session Dir     : ${sessionDir}`);
console.log(`Database Path   : ${dbPath}`);
console.log(`Runner Mode     : In-Process Native Engine (Zero Spawn)`);
console.log(`===========================================`);

// Safety Pre-flight
if (process.env.MODE === 'live') {
  console.error(`FATAL SAFETY CHECK: MODE is set to 'live'. The soak runner strictly requires paper mode.`);
  process.exit(1);
}

if (!process.env.RPC_URLS || !process.env.WS_URLS) {
  console.error(`FATAL PRE-FLIGHT: Missing RPC_URLS or WS_URLS in environment or .env.`);
  console.error(`Please configure your endpoints in .env based on .env.example before launching the soak.`);
  process.exit(1);
}

await mkdir(sessionDir, { recursive: true });

const startTime = Date.now();
try {
  await runEngine({
    durationSec,
    sessionDir,
    dbPath,
    uiPort: process.env.UI_PORT ? Number(process.env.UI_PORT) : 8799,
  });
} catch (err) {
  console.error('Soak engine completed or stopped:', err instanceof Error ? err.message : String(err));
}

const totalDuration = Math.round((Date.now() - startTime) / 1000);
const sessionsParent = dirname(sessionDir);
const sessionSummary = await readLatestSoakSession(sessionsParent, basename(sessionDir)).catch(() => null);

console.log(`\n=== SOAK RUN SUMMARY ===`);
console.log(`Total Runtime      : ${totalDuration}s (${(totalDuration / 3600).toFixed(2)}h)`);
console.log(`Quality Score      : ${sessionSummary?.baselineQualityScore ?? 'N/A'}/100`);
console.log(`Soak Status        : ${sessionSummary?.soakStatus ?? 'COMPLETE'}`);
console.log(`Total Candidates   : ${sessionSummary?.funnel?.discovered ?? 0}`);
console.log(`Total Fills        : ${sessionSummary?.fills?.count ?? 0}`);
console.log(`RPC Health Status  : ${sessionSummary?.rpcHealth?.gatePassed ? 'HEALTHY' : 'DEGRADED'} (${sessionSummary?.rpcHealth?.rateLimitPct ?? 0}% drop rate)`);
console.log(`Blocked Exit Events: ${sessionSummary?.blockedExits?.totalBlocked ?? 0}`);
console.log(`Rejections Total   : ${sessionSummary?.rejections?.total ?? 0}`);
if (sessionSummary?.rejections?.taxonomy?.length) {
  console.log(`Rejection Breakdown:`);
  for (const item of sessionSummary.rejections.taxonomy.slice(0, 8)) {
    console.log(`  - ${item.reason}: ${item.count} (${item.pct}%)`);
  }
}
console.log(`Artifacts Stored In: ${sessionDir}`);
console.log(`========================\n`);
