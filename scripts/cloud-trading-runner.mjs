#!/usr/bin/env node
/**
 * SYLPH Autonomous Cloud Trading & Daemon Runner
 * ========================================================
 * Designed for continuous autonomous execution on GitHub Actions,
 * GitHub Codespaces, Docker containers, and Cloud Linux instances.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

// Parse CLI flags
const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return defaultValue;
}

const durationMinutes = Number(getArg('--duration', process.env.RUNTIME_MINUTES || '360'));
const mode = getArg('--mode', process.env.MODE || 'paper');
const auditIntervalSeconds = Number(getArg('--audit-interval', process.env.AUDIT_INTERVAL_SECONDS || '600'));
const port = Number(getArg('--port', process.env.TERMINAL_PORT || '8793'));

console.log('\n' + '='.repeat(70));
console.log('   SYLPH AUTONOMOUS CLOUD TRADING RUNNER');
console.log('='.repeat(70));
console.log(`  Target Mode:           ${mode.toUpperCase()}`);
console.log(`  Session Duration:      ${durationMinutes > 0 ? durationMinutes + ' minutes' : 'Continuous (unbounded)'}`);
console.log(`  Audit Interval:        ${auditIntervalSeconds} seconds`);
console.log(`  Bind Host & Port:      127.0.0.1:${port}`);
console.log('  Operator Access:       Local-only; authenticated remote access is not configured');
console.log('='.repeat(70) + '\n');

mkdirSync(join(root, 'data'), { recursive: true });
const logFile = join(root, 'data/cloud-server.log');

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const formatted = `[${ts} UTC] ${msg}`;
  console.log(formatted);
  try {
    appendFileSync(logFile, formatted + '\n', 'utf8');
  } catch {}
}

function fetchJson(url) {
  return new Promise((res, rej) => {
    http.get(url, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try { res(JSON.parse(data)); } catch (e) { rej(e); }
      });
    }).on('error', rej);
  });
}

async function isServerReady(url) {
  try {
    const health = await fetchJson(url);
    if (health && health.service === 'sylph-paper-terminal') return true;
  } catch {}
  return false;
}

let serverProcess = null;
let ownedProcess = false;

// Check if server is already running on this port
const alreadyRunning = await isServerReady(`http://127.0.0.1:${port}/health`);
if (alreadyRunning) {
  log(`Detected existing SYLPH server already active on port ${port}. Attaching supervisor...`);
} else {
  // Set runtime environment
  const env = {
    ...process.env,
    MODE: mode,
    TERMINAL_PORT: String(port),
    TERMINAL_HOST: '127.0.0.1',
    ALLOW_REMOTE_OPERATOR: 'false',
    GITHUB_ACTIONS: process.env.GITHUB_ACTIONS || 'true'
  };

  log(`Spawning Sylph Fusion terminal server on port ${port}...`);
  serverProcess = spawn(process.execPath, [join(root, 'terminal/server.mjs')], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  ownedProcess = true;

  serverProcess.stdout.on('data', (d) => {
    const str = d.toString();
    if (str.includes('SYLPH paper terminal') || str.includes('Astra') || str.includes('Error') || str.includes('Fill')) {
      log(`[SERVER] ${str.trim()}`);
    }
  });

  serverProcess.stderr.on('data', (d) => {
    log(`[SERVER ERR] ${d.toString().trim()}`);
  });

  const startWait = Date.now();
  let up = false;
  while (Date.now() - startWait < 45000) {
    if (await isServerReady(`http://127.0.0.1:${port}/health`)) {
      up = true;
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!up) {
    log('FATAL: Terminal server failed to respond within 45s.');
    process.exit(1);
  }
}

log(`SYLPH Cloud Engine is online and operational at http://${host}:${port}`);

let isShuttingDown = false;
async function shutdown(reason) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log(`Shutting down cloud runner (${reason})...`);
  
  if (ownedProcess && serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 2000));
    if (!serverProcess.killed) {
      serverProcess.kill('SIGKILL');
    }
  }
  log('Cloud trading runner terminated cleanly.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT received'));
process.on('SIGTERM', () => shutdown('SIGTERM received'));

const sessionStartMs = Date.now();
const maxRuntimeMs = durationMinutes > 0 ? durationMinutes * 60 * 1000 : Infinity;
let lastAuditMs = Date.now();
let lastHeartbeatMs = 0;
let auditIteration = 0;

async function runCheck() {
  try {
    const now = Date.now();
    const elapsedMinutes = ((now - sessionStartMs) / 60000).toFixed(1);
    
    // Check runtime duration limit
    if (now - sessionStartMs >= maxRuntimeMs) {
      log(`Session duration limit reached (${durationMinutes}m). Flushing telemetry...`);
      await shutdown('Duration reached');
      return;
    }

    // Emit heartbeat every 60s (or initial)
    if (now - lastHeartbeatMs >= 60000) {
      lastHeartbeatMs = now;
      const snap = await fetchJson(`http://127.0.0.1:${port}/api/gateway/snapshot`).catch(() => ({}));
      const learning = await fetchJson(`http://127.0.0.1:${port}/api/intelligence/learning`).catch(() => ({}));
      
      const cash = snap.cash != null ? `$${snap.cash.toFixed(2)}` : 'N/A';
      const unreserved = snap.unreservedCash != null ? `$${snap.unreservedCash.toFixed(2)}` : 'N/A';
      const posCount = (snap.positions || []).length;
      const trades = learning.totalCsvRecordsLoaded || snap.positionsEvaluatedCount || 0;
      const winRate = learning.summary?.winRatePct != null ? `${learning.summary.winRatePct.toFixed(1)}%` : 'N/A';
      const pnl = learning.summary?.totalRealizedPnlUsd != null ? `$${learning.summary.totalRealizedPnlUsd.toFixed(2)}` : 'N/A';

      log(`[HEARTBEAT ${elapsedMinutes}m/${durationMinutes}m] Cash: ${cash} (Unreserved: ${unreserved}) | Active Pos: ${posCount}/2 | Evaluated: ${trades} | Win Rate: ${winRate} | Realized PnL: ${pnl}`);
    }

    // Perform In-Flight Periodic Audit every auditIntervalSeconds
    if (now - lastAuditMs >= auditIntervalSeconds * 1000) {
      lastAuditMs = now;
      auditIteration++;
      log(`\n--- [GOD-TIER EXIT & PROFIT AUDIT #${auditIteration}] ---`);
      const snap = await fetchJson(`http://127.0.0.1:${port}/api/gateway/snapshot`).catch(() => ({}));
      const learning = await fetchJson(`http://127.0.0.1:${port}/api/intelligence/learning`).catch(() => ({}));
      const winRate = learning.summary?.winRatePct != null ? `${learning.summary.winRatePct.toFixed(1)}%` : 'N/A';
      const pnl = learning.summary?.totalRealizedPnlUsd != null ? `$${learning.summary.totalRealizedPnlUsd.toFixed(2)}` : 'N/A';

      if (snap.positions && snap.positions.length > 0) {
        for (const p of snap.positions) {
          const gain = p.entry && p.lastMark ? (((p.lastMark - p.entry) / p.entry) * 100).toFixed(2) : '0.00';
          log(`  # [${p.symbol || p.mint.slice(0, 6)}] Gain: ${gain}% | Cost: $${(p.costBasisUsd || 0).toFixed(2)} | Entry: ${p.entry} | Mark: ${p.lastMark} | Floor: ${p.stop}`);
        }
      } else {
        log('  No open positions currently active. Ready for high-conviction Prime setups.');
      }
      log(`  Cumulative Realized Gains: ${pnl} | Win Rate: ${winRate}`);
      log('--- [AUDIT COMPLETE: MAXIMUM PROFIT PROTECTION ACTIVE] ---\n');
    }
  } catch (err) {
    log(`Monitor warning: ${err.message}`);
  }
}

// Initial check immediately
await runCheck();

// Fast timer to check duration and periodic triggers
const checkIntervalMs = Math.min(5000, maxRuntimeMs > 0 ? Math.max(500, maxRuntimeMs / 10) : 5000);
const monitorInterval = setInterval(runCheck, checkIntervalMs);
