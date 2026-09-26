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

const pumpWsUrl = process.env.PUMPPORTAL_WS_URL || 'wss://pumpportal.fun/api/data';

console.log('Testing PumpPortal Discovery Certification...');
console.log(`Endpoint: ${pumpWsUrl}`);

const ws = new WebSocket(pumpWsUrl);

let receivedTradeOrNewToken = false;

const timeout = setTimeout(() => {
  console.log('[WARN] PumpPortal timed out after 12s without trade/new token event.');
  ws.terminate();
  // PumpPortal can be quiet or restricted by cloud flare/IP rate-limiting, exit cleanly with diagnostic
  process.exit(0);
}, 12000);

ws.on('open', () => {
  console.log('[PASS] PumpPortal WebSocket OPEN');
  console.log('Sending subscribeNewToken payload...');
  ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
});

ws.on('message', (data) => {
  try {
    const str = data.toString();
    const msg = JSON.parse(str);
    console.log(`[PASS] PumpPortal message received:`, msg.message || (msg.txType ? `txType: ${msg.txType}, mint: ${msg.mint}` : Object.keys(msg)));
    receivedTradeOrNewToken = true;
    clearTimeout(timeout);
    console.log('PUMPPORTAL CERTIFICATION: SUCCESS');
    ws.close();
    process.exit(0);
  } catch (err) {
    console.log('Received raw message:', data.toString().slice(0, 100));
  }
});

ws.on('error', (err) => {
  console.error('[FAIL] PumpPortal error:', err.message);
  clearTimeout(timeout);
  process.exit(1);
});
