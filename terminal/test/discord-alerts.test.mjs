import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscordAlertService} from '../discord-alerts.mjs';

const webhook = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const report = (...activeAlerts) => ({activeAlerts});

test('Discord alerts are disabled by default and never make a network request', async () => {
  let calls = 0;
  const service = createDiscordAlertService({fetchImpl: async () => { calls += 1; }});
  assert.equal(service.getStatus().status, 'DISABLED');
  await service.observe(report({severity: 'CRITICAL', source: 'RPC'}), 1000);
  assert.equal(calls, 0);
});

test('Discord webhook accepts only the official HTTPS webhook URL shape', () => {
  for (const webhookUrl of [
    'http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'https://evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    `${webhook}?wait=true`,
  ]) {
    assert.equal(createDiscordAlertService({webhookUrl}).getStatus().status, 'INVALID_CONFIG');
  }
});

test('only critical provider events are sent; repeats dedupe and recovery is explicit', async () => {
  const payloads = [];
  const service = createDiscordAlertService({webhookUrl: webhook, fetchImpl: async (_url, init) => {
    payloads.push(JSON.parse(init.body));
    assert.equal(init.redirect, 'error');
    return {ok: true, status: 204};
  }});
  const active = report(
    {severity: 'WARNING', source: 'OPTIONAL_PROVIDER', message: 'do not send'},
    {severity: 'CRITICAL', source: 'RPC', message: 'private diagnostic text'},
  );
  await service.observe(active, 10_000);
  await service.observe(active, 20_000);
  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0].allowed_mentions, {parse: []});
  assert.match(payloads[0].content, /RPC entered CRITICAL/);
  assert.equal(payloads[0].content.includes('private diagnostic text'), false);
  await service.observe(report(), 30_000);
  assert.equal(payloads.length, 2);
  assert.match(payloads[1].content, /RPC no longer reports a CRITICAL condition/);
  assert.equal(service.getStatus().deliveredCount, 2);
  assert.equal(service.getStatus().lastSuccessMs, 30_000);
});

test('failed Discord delivery is secret-free, bounded, and retried on a later observation', async () => {
  let calls = 0;
  const service = createDiscordAlertService({webhookUrl: webhook, fetchImpl: async () => {
    calls += 1;
    if (calls === 1) throw new Error('request failed');
    return {ok: true, status: 204};
  }});
  const incident = report({severity: 'CRITICAL', source: 'JUPITER_QUOTE'});
  await service.observe(incident, 1_000);
  assert.equal(service.getStatus().status, 'DELIVERY_FAILED');
  assert.equal(JSON.stringify(service.getStatus()).includes('abcdefghijklmnopqrstuvwxyz'), false);
  await service.observe(incident, 2_000);
  assert.equal(calls, 2);
  assert.equal(service.getStatus().status, 'CONNECTED');
});
