import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

loadEnv();

const rpcUrl = process.env.MARKET_RPC_URL || (process.env.RPC_URLS ? process.env.RPC_URLS.split(',')[0].trim() : null);

console.log('Testing RPC Certification against configured endpoint...');

if (!rpcUrl) {
  console.error('FAIL: No RPC URL configured in .env');
  process.exit(1);
}

function sanitize(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return 'invalid-url';
  }
}

async function probeRpc(method, params = []) {
  const start = Date.now();
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const latency = Date.now() - start;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`JSON-RPC Error: ${JSON.stringify(json.error)}`);
  }
  return { result: json.result, latency };
}

async function run() {
  console.log(`Endpoint (Sanitized): ${sanitize(rpcUrl)}`);
  
  try {
    const health = await probeRpc('getHealth');
    console.log(`[PASS] getHealth: ${health.result} (${health.latency}ms)`);
  } catch (err) {
    console.warn(`[WARN] getHealth probe returned: ${err.message}`);
  }

  try {
    const slot = await probeRpc('getSlot');
    console.log(`[PASS] getSlot: current slot ${slot.result} (${slot.latency}ms)`);
  } catch (err) {
    console.error(`[FAIL] getSlot failed: ${err.message}`);
    process.exit(1);
  }

  try {
    const blockhash = await probeRpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    console.log(`[PASS] getLatestBlockhash: valid blockhash slot ${blockhash.result.context.slot} (${blockhash.latency}ms)`);
  } catch (err) {
    console.error(`[FAIL] getLatestBlockhash failed: ${err.message}`);
    process.exit(1);
  }

  console.log('RPC CERTIFICATION: SUCCESS');
}

run().catch(err => {
  console.error('RPC CERTIFICATION FAILED:', err);
  process.exit(1);
});
