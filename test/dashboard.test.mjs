import test from 'node:test';
import assert from 'node:assert/strict';
import { startDashboard } from '../dist/dashboard.js';
import { Engine } from '../dist/fusion.js';
import { config } from '../dist/config.js';
import { PublicKey } from '@solana/web3.js';
import { request } from 'node:http';

test('dashboard protects reads and writes, validates actions and serves local assets', async () => {
  const source = { paused: false, snapshot() { return { paused: this.paused }; }, async setPaused(value) { this.paused = value; } };
  const server = await startDashboard(source, 0);
  try {
    const page = await fetch(server.url); const html = await page.text();
    const token = html.match(/name="dashboard-token" content="([a-f0-9]+)"/)[1];
    assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    assert.equal((await fetch(server.url + '/app.js')).status, 200);
    assert.equal((await fetch(server.url + '/api/state')).status, 403);
    assert.equal((await fetch(server.url + '/api/state', { headers: { 'x-dashboard-token': 'é'.repeat(64) } })).status, 403);
    const headers = { 'x-dashboard-token': token, 'content-type': 'application/json', origin: server.url };
    assert.equal((await fetch(server.url + '/api/state', { headers })).status, 200);
    assert.equal((await fetch(server.url + '/api/entries', { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{"paused":true}' })).status, 403);
    assert.equal(source.paused, false);
    assert.equal((await fetch(server.url + '/api/entries', { method: 'POST', headers, body: '{"paused":"false"}' })).status, 400);
    const response = await fetch(server.url + '/api/entries', { method: 'POST', headers, body: '{"paused":true}' });
    assert.equal(response.status, 200); assert.equal((await response.json()).paused, true);
    const hostStatus = await new Promise((resolve, reject) => { const req = request(server.url + '/api/state', { headers: { ...headers, host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
    assert.equal(hostStatus, 403);
  } finally { await server.close(); }
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/store.js';

let dashboardDir, dashboardStore;
test.before(async () => {
  dashboardDir = await mkdtemp(join(tmpdir(), 'dashboard-'));
  dashboardStore = new Store(join(dashboardDir, 'state.sqlite'));
});
test.after(async () => {
  await dashboardStore?.close();
  if (dashboardDir) await rm(dashboardDir, { recursive: true, force: true });
});

const cfg = config({ RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: 'wss://one.invalid', JITO_AUTH: 'SECRET_AUTH', YELLOWSTONE_TOKEN: 'SECRET_GRPC', KEYPAIR_PATH: 'SECRET_PATH' });
function fixture() { return { version: 1, mode: 'paper', wallet: PublicKey.default.toBase58(), positions: {}, cash: '1', dayPnl: '0', day: '2026-09-14', halted: true, closed: {}, pending: { signature: 'public-signature', wire: 'SECRET_SIGNED_WIRE', mint: 'mint', side: 'buy', created: Date.now(), reason: 'test' } }; }
test('dashboard snapshot excludes credentials and signed transaction bytes', () => {
  const engine = new Engine(cfg, { connection: {} }, {}, {}, dashboardStore, fixture());
  const value = JSON.stringify(engine.snapshot()); assert.ok(!value.includes('SECRET')); assert.ok(value.includes('public-signature'));
});
test('operator resume persists without clearing a safety halt', async () => {
  let saved;
  const origSave = dashboardStore.save.bind(dashboardStore);
  dashboardStore.save = async s => { saved = structuredClone(s); return origSave(s); };
  const engine = new Engine(cfg, { connection: {} }, {}, {}, dashboardStore, fixture());
  await engine.setPaused(true); assert.equal(saved.operatorPaused, true);
  await engine.setPaused(false); assert.equal(saved.operatorPaused, false); assert.equal(engine.state.halted, true);
});
test('pause arriving during buy construction prevents submission', async () => {
  let sent = false; const state = fixture(); state.halted = false; state.pending = null;
  dashboardStore.save = async () => {};
  const engine = new Engine(cfg, { connection: {} }, {}, { build: async () => { await engine.setPaused(true); return { pending: {} }; }, broadcast: async () => { sent = true; } }, dashboardStore, state);
  engine.feed.healthy = () => true;
  await engine.trade({ mint: PublicKey.default }, 'buy', 1n, '', 0, 'test', false);
  assert.equal(sent, false); assert.equal(state.pending, null);
});
