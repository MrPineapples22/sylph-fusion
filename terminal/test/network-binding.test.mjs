import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTerminalNetworkBinding} from '../network-binding.mjs';

test('terminal remains loopback-bound unless the Docker host-loopback publish is explicit', () => {
  assert.deepEqual(resolveTerminalNetworkBinding({MODE: 'paper'}), {
    host: '127.0.0.1', allowForwardedPeer: false,
  });
  assert.deepEqual(resolveTerminalNetworkBinding({MODE: 'paper', SYLPH_DOCKER_LOOPBACK_PUBLISHED: 'false'}), {
    host: '127.0.0.1', allowForwardedPeer: false,
  });
});

test('Docker published mode binds for forwarding only in paper mode', () => {
  assert.deepEqual(resolveTerminalNetworkBinding({MODE: 'paper', SYLPH_DOCKER_LOOPBACK_PUBLISHED: 'true'}, {dockerEnvironment: true}), {
    host: '0.0.0.0', allowForwardedPeer: true,
  });
  assert.throws(
    () => resolveTerminalNetworkBinding({MODE: 'paper', SYLPH_DOCKER_LOOPBACK_PUBLISHED: 'true'}, {dockerEnvironment: false}),
    /DOCKER_LOOPBACK_PUBLICATION_REQUIRES_DOCKER/,
  );
  assert.throws(
    () => resolveTerminalNetworkBinding({MODE: 'live', SYLPH_DOCKER_LOOPBACK_PUBLISHED: 'true'}, {dockerEnvironment: true}),
    /DOCKER_LOOPBACK_PUBLICATION_PAPER_ONLY/,
  );
  assert.throws(
    () => resolveTerminalNetworkBinding({SYLPH_DOCKER_LOOPBACK_PUBLISHED: 'true'}, {dockerEnvironment: true}),
    /DOCKER_LOOPBACK_PUBLICATION_PAPER_ONLY/,
  );
});
