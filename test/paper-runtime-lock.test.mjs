import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPaperRuntime } from '../dist/fusion.js';

test('engine startup rejects every non-paper runtime before transport or signer setup', () => {
  assert.doesNotThrow(() => assertPaperRuntime({ MODE: 'paper' }));
  assert.throws(
    () => assertPaperRuntime({ MODE: 'live' }),
    /PAPER_ONLY_RUNTIME: live execution is unavailable in this build/,
  );
});
