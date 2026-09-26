import test from 'node:test';
import assert from 'node:assert/strict';

import { LeaderScheduleTracker } from '../../dist/platform/execution/solaris/leader-schedule.js';
import { HeliosDirectClient } from '../../dist/platform/execution/helios/helios-direct.js';

test('HELIOS-DIRECT: does not fabricate leader TPU endpoints', () => {
  const tracker = new LeaderScheduleTracker();
  const helios = new HeliosDirectClient(tracker);

  try {
    const endpoint = helios.resolveLeaderTpu(250_000);
    assert.equal(endpoint, undefined, 'missing schedule must not create a synthetic endpoint');

    const customPubkey = 'CustomVal1111111111111111111111111111111111';
    tracker.loadEpochSchedule(0, { [customPubkey]: [0] }, 0);
    helios.registerTpuNode(customPubkey, '192.168.1.100', 8003, 8009);

    const registered = helios.resolveLeaderTpu(0);
    assert.equal(registered?.ip, '192.168.1.100');
  } finally {
    helios.close();
  }
});

test('HELIOS-DIRECT: does not send when endpoint evidence is unavailable', async () => {
  const tracker = new LeaderScheduleTracker();
  const helios = new HeliosDirectClient(tracker);

  try {
    const mockWireTx = new Uint8Array(128);
    for (let i = 0; i < mockWireTx.length; i++) {
      mockWireTx[i] = i % 256;
    }

    const result = await helios.sendWireTransactionDirect(mockWireTx, 250_003, true);

    assert.equal(result.success, false);
    assert.equal(result.wireBytes, 128);
    assert.equal(result.mode, 'NOT_SENT');
    assert.equal(result.targetEndpoint, 'UNAVAILABLE');
    assert.match(result.error, /DIRECT_TPU_DISPATCH_UNAVAILABLE/);

    const telemetry = helios.getTelemetry();
    assert.equal(telemetry.directTransmissionsCount, 0);
    assert.equal(telemetry.pipelinedTransmissionsCount, 0);
    assert.ok(telemetry.avgTransmissionDurationMs >= 0, 'Average transmission latency tracked');
  } finally {
    helios.close();
  }
});
