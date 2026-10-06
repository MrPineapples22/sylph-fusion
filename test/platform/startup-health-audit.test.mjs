import assert from 'node:assert/strict';
import test from 'node:test';
import { StartupHealthAuditor } from '../../dist/platform/assurance/startup-health-audit.js';

test('STARTUP SELF-TEST: exercises 15 subsystem APIs without claiming live runtime health', async () => {
  const report = await StartupHealthAuditor.performHealthAudit();

  assert.equal(typeof report.timestamp, 'string');
  assert.equal(report.records.length, 15);

  const statuses = Object.fromEntries(report.records.map((r) => [r.name, r.status]));

  // Verify all expected subsystems exist and have expected statuses
  assert.equal(statuses['Discovery'], 'SELF_TEST_PASS');
  assert.equal(statuses['Canonical Events'], 'SELF_TEST_PASS');
  assert.equal(statuses['FusionEnvelope'], 'SELF_TEST_PASS');
  assert.equal(statuses['Journal'], 'SELF_TEST_PASS');
  assert.equal(statuses['Reducer'], 'SELF_TEST_PASS', JSON.stringify(report.records.find((record) => record.name === 'Reducer')));
  assert.equal(statuses['ASTRA'], 'SELF_TEST_PASS');
  assert.equal(statuses['Regime Engine'], 'SELF_TEST_PASS');
  assert.equal(statuses['Phase Detector'], 'SELF_TEST_PASS');
  assert.equal(statuses['Divergence Engine'], 'SELF_TEST_PASS');
  assert.equal(statuses['Adversarial Intelligence'], 'SELF_TEST_PASS');
  assert.equal(statuses['Risk'], 'SELF_TEST_PASS');
  assert.equal(statuses['Execution Authority'], 'SELF_TEST_PASS');
  assert.equal(statuses['Paper Execution'], 'SELF_TEST_PASS');
  assert.equal(statuses['Reconciliation'], 'SELF_TEST_PASS');
  assert.equal(statuses['Calibration'], 'SELF_TEST_PARTIAL');

  // Overall status must be healthy
  assert.equal(report.selfTestsPassed, true);
  assert.equal(report.runtimeHealth, 'UNKNOWN');

  // Verify formatted report contains key headers
  const text = report.formattedSummary;
  assert.match(text, /SYLPH FUSION STARTUP SELF-TEST/);
  assert.match(text, /Discovery\s+SELF_TEST_PASS/);
  assert.match(text, /Paper Execution\s+SELF_TEST_PASS/);
  assert.match(text, /Calibration\s+SELF_TEST_PARTIAL/);
  assert.match(text, /Runtime Health: UNKNOWN/);
});
