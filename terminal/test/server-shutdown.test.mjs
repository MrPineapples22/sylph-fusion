import test from 'node:test';
import assert from 'node:assert/strict';
import {createGracefulShutdown} from '../server-shutdown.mjs';

test('terminal shutdown is idempotent and closes SQLite resources after HTTP drain', () => {
  let closeCallback;
  const calls = [];
  const server = {
    close(callback) { calls.push('close-server'); closeCallback = callback; },
    closeIdleConnections() { calls.push('close-idle'); },
    closeAllConnections() { calls.push('force-close'); },
  };
  const shutdown = createGracefulShutdown({
    server,
    stopServices() { calls.push('stop-services'); },
    closeStores() { calls.push('close-stores'); },
    forceAfterMs: 1000,
  });

  assert.equal(shutdown('SIGINT'), true);
  assert.equal(shutdown('SIGTERM'), false);
  assert.deepEqual(calls, ['stop-services', 'close-server', 'close-idle']);
  closeCallback();
  closeCallback();
  assert.deepEqual(calls, ['stop-services', 'close-server', 'close-idle', 'close-stores']);
});

test('terminal shutdown bounds a stuck HTTP drain and reports close failures', async () => {
  const calls = [];
  const errors = [];
  let closeCallback;
  const server = {
    close(callback) { calls.push('close-server'); closeCallback = callback; },
    closeIdleConnections() {},
    closeAllConnections() { calls.push('force-close'); closeCallback?.(); },
  };
  const shutdown = createGracefulShutdown({
    server,
    stopServices() { throw new Error('stop failed'); },
    closeStores() { calls.push('close-stores'); },
    onError(error, phase) { errors.push([error.message, phase]); },
    forceAfterMs: 10,
  });

  shutdown();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(calls, ['close-server', 'force-close', 'close-stores']);
  assert.deepEqual(errors, [['stop failed', 'stop-services']]);
});

test('terminal shutdown validates the server and force-close deadline', () => {
  assert.throws(() => createGracefulShutdown({server: {close() {}}}), /INVALID_TERMINAL_SHUTDOWN_SERVER/);
  const server = {close() {}, closeAllConnections() {}};
  assert.throws(() => createGracefulShutdown({server, forceAfterMs: 0}), /INVALID_TERMINAL_SHUTDOWN_TIMEOUT/);
});
