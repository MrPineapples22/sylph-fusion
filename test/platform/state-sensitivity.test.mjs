import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StateSensitivityAnalyzer,
} from '../../dist/platform/simulation/state-sensitivity.js';

test('StateSensitivityAnalyzer: fails closed to 1-slot lease when scenarios are empty', () => {
  const report = StateSensitivityAnalyzer.analyzeSensitivity({
    baseSlot: 200,
    requestedComputeUnits: 100_000,
    scenarios: [],
  });

  assert.equal(report.isHighSensitivity, true);
  assert.equal(report.stateSensitivityIndex, 1.0);
  assert.equal(report.recommendedLeaseSlots, 1);
  assert.match(report.rationale, /HIGH_SENSITIVITY/);
});

test('StateSensitivityAnalyzer: detects output and CU drift across adjacent slots', () => {
  const scenarios = [
    { slotOffset: -1, simulatedOutputLamports: 1_000_000n, simulatedComputeUnits: 45_000, simulatedSuccess: true },
    { slotOffset: 0,  simulatedOutputLamports: 1_000_000n, simulatedComputeUnits: 45_000, simulatedSuccess: true },
    { slotOffset: 1,  simulatedOutputLamports: 950_000n,   simulatedComputeUnits: 55_000, simulatedSuccess: true }, // 5% drop, +10k CU
  ];

  const report = StateSensitivityAnalyzer.analyzeSensitivity({
    baseSlot: 300,
    requestedComputeUnits: 100_000,
    scenarios,
    alphaHalfLifeMs: 2000,
  });

  assert.equal(report.baseSlot, 300);
  assert.equal(report.maxOutputDriftBps, 500); // 5% drop
  assert.ok(report.recommendedLeaseSlots >= 1);
  assert.ok(report.stateSensitivityIndex > 0);
});

test('StateLeaseV2: enforces slot boundary validity and rejects retrograde or expired slots', () => {
  const report = StateSensitivityAnalyzer.analyzeSensitivity({
    baseSlot: 500,
    requestedComputeUnits: 80_000,
    scenarios: [
      { slotOffset: 0, simulatedOutputLamports: 2_000_000n, simulatedComputeUnits: 35_000, simulatedSuccess: true },
      { slotOffset: 1, simulatedOutputLamports: 1_990_000n, simulatedComputeUnits: 35_500, simulatedSuccess: true },
    ],
    alphaHalfLifeMs: 1600, // ~4 slots max
  });

  const lease = StateSensitivityAnalyzer.issueLease('intent_state_test_01', report, 1600);

  assert.equal(lease.baseSlot, 500);
  assert.ok(lease.expirySlot > 500);
  assert.ok(lease.leaseHash.length === 64);

  // Valid slot inside lease window
  const validCheck = StateSensitivityAnalyzer.validateLease(lease, 501);
  assert.equal(validCheck.isValid, true);
  assert.ok(validCheck.remainingSlots >= 0);

  // Retrograde slot (< baseSlot)
  const retroCheck = StateSensitivityAnalyzer.validateLease(lease, 499);
  assert.equal(retroCheck.isValid, false);
  assert.match(retroCheck.reason, /INVALID_SLOT_RETROGRADE/);

  // Expired slot (> expirySlot)
  const expiredCheck = StateSensitivityAnalyzer.validateLease(lease, lease.expirySlot + 1);
  assert.equal(expiredCheck.isValid, false);
  assert.match(expiredCheck.reason, /LEASE_EXPIRED/);
});
