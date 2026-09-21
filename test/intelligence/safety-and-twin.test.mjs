import test from 'node:test';
import assert from 'node:assert/strict';

import { SafetyConstitution } from '../../dist/intelligence/safety/constitution.js';
import { SafetyMonitor } from '../../dist/intelligence/safety/safety-monitor.js';
import { DigitalTwin } from '../../dist/intelligence/twin/digital-twin.js';

test('SafetyConstitution defines 10 invariant categories and immutable rules', () => {
  const rules = SafetyConstitution.getRules();
  assert.ok(rules.length >= 10, 'Should define at least 10 primary constitution rules');

  const categories = new Set(rules.map((r) => r.category));
  assert.equal(categories.size, 10, 'Should cover all 10 safety categories');
  assert.ok(categories.has('CAPITAL'));
  assert.ok(categories.has('SECURITY'));
  assert.ok(categories.has('TEMPORAL'));
  assert.ok(categories.has('EXECUTION'));
  assert.ok(categories.has('POSITION'));

  for (const rule of rules) {
    assert.ok(rule.isHardConstraint, `Rule ${rule.ruleId} must be a hard constraint`);
  }

  const hash = SafetyConstitution.getConstitutionHash();
  assert.ok(hash.startsWith('sha256_'), 'Should return deterministic constitution hash');
});

test('SafetyMonitor enforces fail-closed capital authority on any critical violation', () => {
  const monitor = new SafetyMonitor();

  // 1. Clean nominal conditions
  const cleanVerdict = monitor.evaluate({
    isConservationIdentityValid: true,
    isReconciliationClean: true,
    rpcHealthyCount: 3,
    maxQuoteAgeObservedMs: 450,
    emergencyStopActive: false,
    activeViolations: [],
  });

  assert.equal(cleanVerdict.canAuthorizeNewCapital, true);
  assert.equal(cleanVerdict.safetyStatus, 'GREEN_OPERATIONAL');
  assert.equal(cleanVerdict.activeViolations.length, 0);

  // 2. Capital conservation broken -> must lock
  const conservationFailVerdict = monitor.evaluate({
    isConservationIdentityValid: false,
    isReconciliationClean: true,
    rpcHealthyCount: 3,
    maxQuoteAgeObservedMs: 450,
    emergencyStopActive: false,
    activeViolations: [],
  });
  assert.equal(conservationFailVerdict.canAuthorizeNewCapital, false);
  assert.equal(conservationFailVerdict.safetyStatus, 'RED_LOCKED');
  assert.ok(conservationFailVerdict.activeViolations.some((v) => v.includes('CAPITAL_CONSERVATION_FAILURE')));

  // 3. Stale quote (>2500ms) -> must lock
  const staleQuoteVerdict = monitor.evaluate({
    isConservationIdentityValid: true,
    isReconciliationClean: true,
    rpcHealthyCount: 2,
    maxQuoteAgeObservedMs: 3100,
    emergencyStopActive: false,
    activeViolations: [],
  });
  assert.equal(staleQuoteVerdict.canAuthorizeNewCapital, false);
  assert.equal(staleQuoteVerdict.safetyStatus, 'RED_LOCKED');
  assert.ok(staleQuoteVerdict.activeViolations.some((v) => v.includes('DATA_FRESHNESS_FAILURE')));

  // 4. Emergency stop -> must lock
  const emergencyVerdict = monitor.evaluate({
    isConservationIdentityValid: true,
    isReconciliationClean: true,
    rpcHealthyCount: 2,
    maxQuoteAgeObservedMs: 200,
    emergencyStopActive: true,
    activeViolations: [],
  });
  assert.equal(emergencyVerdict.canAuthorizeNewCapital, false);
  assert.equal(emergencyVerdict.safetyStatus, 'RED_LOCKED');
  assert.ok(emergencyVerdict.activeViolations.some((v) => v.includes('OPERATOR_EMERGENCY_STOP')));
});

test('DigitalTwin provides virtual Solana clock and deterministic replay fingerprinting', () => {
  const twin1 = new DigitalTwin(1_000_000, 100);
  const twin2 = new DigitalTwin(1_000_000, 100);

  const mockEvents = [
    { eventId: 'evt_1', slot: 101 },
    { eventId: 'evt_2', slot: 102 },
    { eventId: 'evt_3', slot: 105 },
    { eventId: 'evt_4', slot: 110 },
  ];

  const codeHash = 'code_hash_v1_test';
  const configHash = 'config_hash_v1_test';

  const fp1 = twin1.replayEventStream(mockEvents, codeHash, configHash);
  const fp2 = twin2.replayEventStream(mockEvents, codeHash, configHash);

  assert.equal(fp1.datasetHash, fp2.datasetHash, 'Dataset hash must be identical');
  assert.equal(fp1.finalStateHash, fp2.finalStateHash, 'Final state hash must be deterministic');
  assert.equal(fp1.eventsProcessed, 4);

  // Advance clock manually
  twin1.advanceSlot(5, 2000);
  const clock = twin1.getVirtualClock();
  assert.equal(clock.virtualSlot, 115);
});
