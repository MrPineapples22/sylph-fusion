import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import WebSocket from 'ws';

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

const wsUrl = process.env.MARKET_WS_URL || (process.env.WS_URLS ? process.env.WS_URLS.split(',')[0].trim() : null);

console.log('Testing WSS Certification against configured endpoint...');

if (!wsUrl) {
  console.error('FAIL: No WSS URL configured in .env');
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

console.log(`Endpoint (Sanitized): ${sanitize(wsUrl)}`);

const ws = new WebSocket(wsUrl);

let subId = null;
let observations = 0;
const targetObservations = 3;

const timeout = setTimeout(() => {
  console.error(`FAIL: Timed out waiting for ${targetObservations} WSS slot notifications`);
  ws.terminate();
  process.exit(1);
}, 15000);

ws.on('open', () => {
  console.log('[PASS] WebSocket OPEN');
  console.log('Sending slotSubscribe...');
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 101,
    method: 'slotSubscribe',
    params: []
  }));
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    if (msg.id === 101 && typeof msg.result === 'number') {
      subId = msg.result;
      console.log(`[PASS] Subscription ACK received. Subscription ID: ${subId}`);
      return;
    }
    if (msg.method === 'slotNotification' && msg.params) {
      observations++;
      const slotInfo = msg.params.result;
      console.log(`[PASS] Slot Notification #${observations}: slot ${slotInfo.slot}, parent ${slotInfo.parent}, root ${slotInfo.root}`);
      if (observations >= targetObservations) {
        clearTimeout(timeout);
        console.log('WSS CERTIFICATION: SUCCESS');
        ws.close();
        process.exit(0);
      }
    }
  } catch (err) {
    console.warn('[WARN] Error parsing message:', err.message);
  }
});

ws.on('error', (err) => {
  console.error('[FAIL] WebSocket error:', err.message);
  clearTimeout(timeout);
  process.exit(1);
});
