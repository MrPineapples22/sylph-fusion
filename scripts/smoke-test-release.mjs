import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

// This is a bounded startup/HTTP contract check, not a production certification.
const root = resolve(process.argv[2] || '.');
const port = Number(process.env.SMOKE_PORT || 3099);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid smoke-test port');
const base = `http://127.0.0.1:${port}`;
try {await fetch(base + '/health', {signal: AbortSignal.timeout(500)}); throw Error('Smoke-test port is already occupied');}
catch (error) {if (error.message === 'Smoke-test port is already occupied') throw error;}
const child = spawn(process.execPath, ['terminal/server.mjs'], {
  cwd: root, env: {...process.env, TERMINAL_PORT: String(port)}, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true,
});
let spawnError;
child.on('error', error => {spawnError = error;});
const exit = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({code, signal})));
async function request(path, options, timeoutMs = 8000) {
  return fetch(base + path, {...options, signal: AbortSignal.timeout(timeoutMs)});
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (spawnError) throw Error('Unable to start smoke-test child process: ' + spawnError.code);
    if (child.exitCode !== null || child.signalCode !== null) throw Error('Server exited before readiness');
    try {const r = await request('/health', undefined, 500); if (r.ok && (await r.json()).service === 'sylph-paper-terminal') {ready = true; break;}} catch {}
    await delay(250);
  }
  assert.ok(ready, 'Server did not become ready');
  const ui = await request('/');
  assert.equal(ui.status, 200, 'UI must be served');
  assert.match(ui.headers.get('content-type') || '', /text\/html/);
  const html = await ui.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)(?:\?[^"]*)?"/g)].map(match => match[1]);
  assert.ok(assets.length > 0, 'UI must reference production assets');
  for (const asset of assets) assert.equal((await request(asset)).status, 200, 'Missing UI asset: ' + asset);
  const market = await request('/live/api/market');
  assert.equal(market.status, 200);
  const data = await market.json();
  assert.ok(Array.isArray(data.tokens));
  assert.equal(data.capitalAuthority.capitalStatus, 'UNVERIFIED');
  assert.equal(data.capitalAuthority.signingGate.gateReady, false);
  const command = await request('/live/api/command', {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({commandId: 'smoke-disable-' + Date.now(), type: 'SET_AUTOMATION', timestamp: Date.now(), initiator: 'smoke', payload: {enabled: false}})});
  assert.equal(command.status, 409, 'Live command alias must remain unavailable');
  assert.match((await command.json()).error, /^LIVE_UNAVAILABLE\b/);
  const paperCommand = await request('/api/command', {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({commandId: 'smoke-disable-paper-' + Date.now(), type: 'SET_AUTOMATION', timestamp: Date.now(), initiator: 'smoke', payload: {enabled: false}})});
  assert.equal(paperCommand.status, 200);
  assert.equal((await paperCommand.json()).ok, true);
  const badOrigin = await request('/live/api/command', {method: 'POST', headers: {origin: 'https://example.invalid', 'content-type': 'application/json'}, body: '{}'});
  assert.equal(badOrigin.status, 403);
  const mobileRes = await request('/mobile');
  assert.equal(mobileRes.status, 200, 'Mobile operations window route /mobile must return 200');
  const discovery = await request('/api/discovery');
  assert.equal(discovery.status, 200);
  const discData = await discovery.json();
  assert.ok(discData.systemStatus, 'Discovery snapshot must include authoritative systemStatus');
  assert.equal(discData.systemStatus.executionAuthority, 'LOCKED');
  assert.equal(discData.systemStatus.riskAuthority, 'LOCKED');
  console.log('PASS: server readiness, UI assets, mobile window, discovery systemStatus, market schema, unverified capital, command response, and origin rejection.');
} catch (error) {
  console.error('SMOKE FAILED: ' + error.message);
  process.exitCode = 1;
} finally {
  if (!spawnError && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  if (!spawnError) {
    const result = await Promise.race([exit, delay(10_000, null, {ref: false})]);
    if (!result) {child.kill('SIGKILL'); process.exitCode = 1; console.error('Server termination deadline exceeded');}
    else console.log('Child termination observed. This does not certify graceful shutdown or long-run reliability.');
  }
}
