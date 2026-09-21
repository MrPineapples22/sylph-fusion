import test from 'node:test';
import assert from 'node:assert/strict';

import { LeaderScheduleTracker } from '../../dist/platform/execution/solaris/leader-schedule.js';
import { HeliosDirectClient } from '../../dist/platform/execution/helios/helios-direct.js';

test('HELIOS-DIRECT: Leader TPU socket resolution and registration', () => {
  const tracker = new LeaderScheduleTracker();
  const helios = new HeliosDirectClient(tracker);

  try {
    // 1. Resolve leader TPU for slot 250,000
    const endpoint = helios.resolveLeaderTpu(250_000);
    assert.ok(endpoint.pubkey.length > 0, 'Leader pubkey should be present');
    assert.ok(endpoint.ip.length > 0, 'Leader IP should be resolved');
    assert.equal(endpoint.tpuPort, 8003, 'Default TPU port should be 8003');
    assert.equal(endpoint.tpuQuicPort, 8009, 'Default QUIC port should be 8009');

    // 2. Custom validator TPU registration
    const customPubkey = 'CustomVal1111111111111111111111111111111111';
    helios.registerTpuNode(customPubkey, '192.168.1.100', 8003, 8009);

    const registered = helios.resolveLeaderTpu(0);
    assert.ok(registered.ip.length > 0);
  } finally {
    helios.close();
  }
});

test('HELIOS-DIRECT: Direct zero-copy wire transaction transmission & multi-leader pipelining', async () => {
  const tracker = new LeaderScheduleTracker();
  const helios = new HeliosDirectClient(tracker);

  try {
    // Mock 128-byte signed wire transaction
    const mockWireTx = new Uint8Array(128);
    for (let i = 0; i < mockWireTx.length; i++) {
      mockWireTx[i] = i % 256;
    }

    // Slot 250,003 is slot index 3 in a 4-slot chunk (remainingSlotsInChunk = 1 <= 2)
    // This will trigger multi-leader pipelining!
    const result = await helios.sendWireTransactionDirect(mockWireTx, 250_003, true);

    assert.equal(result.success, true);
    assert.equal(result.wireBytes, 128);
    assert.equal(result.mode, 'DIRECT_TPU_QUIC');
    assert.ok(result.targetEndpoint.includes(':8003'));
    assert.ok(result.pipelinedLeaderPubkey !== undefined, 'Should pipeline to adjacent leader across chunk transition');

    // Check telemetry
    const telemetry = helios.getTelemetry();
    assert.ok(telemetry.directTransmissionsCount >= 1, 'Should record direct transmission');
    assert.ok(telemetry.pipelinedTransmissionsCount >= 1, 'Should record pipelined transmission');
    assert.ok(telemetry.avgTransmissionDurationMs >= 0, 'Average transmission latency tracked');
  } finally {
    helios.close();
  }
});
