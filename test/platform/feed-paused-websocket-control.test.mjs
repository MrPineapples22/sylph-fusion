import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket, { WebSocketServer } from 'ws';

test('a paused feed socket does not dispatch pong frames until it resumes', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const peers = new Set();
  server.on('connection', peer => peers.add(peer));
  let pongCount = 0;
  t.after(async () => {
    client.terminate();
    for (const peer of peers) peer.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise((resolve, reject) => {
    client.once('open', resolve);
    client.once('error', reject);
  });

  const peer = [...peers][0];
  assert.ok(peer);
  peer.on('pong', () => { pongCount++; });
  client.pause();
  peer.ping(Buffer.from('heartbeat'));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(pongCount, 0, 'the paused socket must not process the inbound ping/pong control frame');

  const resumedPong = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('PONG_NOT_DISPATCHED_AFTER_RESUME')), 2_000);
    peer.once('pong', () => { clearTimeout(timeout); resolve(); });
  });
  client.resume();
  await resumedPong;
  assert.equal(pongCount, 1);
});
