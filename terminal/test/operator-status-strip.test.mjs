import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSystemStrip } from '../src/operator-status-strip-state.js';

test('operator status strip removes cached positive badges when projection evidence is stale or missing', () => {
  const healthy = { data: 'FRESH', execution: 'READY' };
  assert.equal(selectSystemStrip({ systemStrip: healthy }, false, null), healthy);
  assert.equal(selectSystemStrip({ systemStrip: healthy }, true, healthy), null);
  assert.equal(selectSystemStrip({}, false, healthy), null);
  assert.equal(selectSystemStrip({ systemStrip: null }, false, healthy), null);
  assert.equal(selectSystemStrip(null, false, healthy), healthy);
});
