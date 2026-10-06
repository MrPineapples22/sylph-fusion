import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readSoakSessionEvidence, getSoakSessionGateLabel, readSoakQualityScore } from '../src/soak-session-evidence.js';

test('missing or malformed archived RPC metrics remain unknown', () => {
  assert.equal(readSoakSessionEvidence(undefined), null);
  assert.deepEqual(readSoakSessionEvidence({
    gatePassed: 'true',
    rateLimitPct: '0',
    failedRpcCount: -1,
    alert: '',
  }), {
    gatePassed: null,
    rateLimitPct: null,
    failedRpcCount: null,
    alert: null,
  });
  assert.deepEqual(readSoakSessionEvidence({
    gatePassed: true,
    rateLimitPct: 0,
    failedRpcCount: 0,
    alert: 'Observed session completed its gate.',
  }), {
    gatePassed: true,
    rateLimitPct: 0,
    failedRpcCount: 0,
    alert: 'Observed session completed its gate.',
  });
});

test('historical session results cannot be worded as current permission', () => {
  assert.equal(getSoakSessionGateLabel(true), 'PASSED · SESSION RESULT');
  assert.equal(getSoakSessionGateLabel(false), 'BLOCKED · SESSION RESULT');
  assert.equal(getSoakSessionGateLabel(null), 'UNVERIFIED');
  assert.equal(readSoakQualityScore(undefined), null);
  assert.equal(readSoakQualityScore('0'), null);
  assert.equal(readSoakQualityScore(0), 0);
  assert.equal(readSoakQualityScore(100), 100);
  assert.equal(readSoakQualityScore(100.1), null);
});

test('SoakTelemetry labels the selected session and missing RPC data as unverified', async () => {
  const source = await readFile(new URL('../src/components/SoakTelemetry.jsx', import.meta.url), 'utf8');
  assert.match(source, /SESSION GATE RESULT:/);
  assert.match(source, /UNVERIFIED/);
  assert.doesNotMatch(source, /APPROVED TO RUN/);
  assert.doesNotMatch(source, /rpcHealth\?\.failedRpcCount \?\? 0/);
  assert.match(source, /qualityScore === null \? 'Unknown'/);
  assert.doesNotMatch(source, /baselineQualityScore \?\? 0/);
});

test('RPC status endpoint uses source-qualified live and session health fields', async () => {
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(source, /buildRpcStatusPayload\(liveData\)/);
  assert.doesNotMatch(source, /rpcHealth:\s*liveData\.session\?\.rpcHealth/);
});
