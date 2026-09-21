import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafetyGuardianEngine } from '../../dist/intelligence/guardian/safety-guardian.js';
import { PhoenixRecoveryEngine } from '../../dist/intelligence/phoenix/recovery-engine.js';
import { ArchimedesScientificMemory } from '../../dist/intelligence/archimedes/scientific-memory.js';

test('GUARDIAN - Predictive Safety Boundaries, Near-Miss Events & Safety Debt', () => {
  const guardian = new SafetyGuardianEngine();

  // 1. Nominal Envelope
  const nominal = guardian.evaluateBoundaries({
    execution_latency_ms: 120,
    feed_age_ms: 50,
    liquidity_depth_sol: 25.0,
    queue_depth: 2,
    capital_drawdown_pct: 3.0,
    rpc_error_rate_pct: 0.2,
  });

  assert.ok(nominal.overall_margin_pct > 50);
  assert.equal(nominal.barrier_erosion_detected, false);

  // 2. Near-Miss Condition: High latency (1,350ms, close to 1,500ms unsafe threshold)
  const nearMiss = guardian.evaluateBoundaries({
    execution_latency_ms: 1350,
    feed_age_ms: 50,
    liquidity_depth_sol: 25.0,
    queue_depth: 2,
    capital_drawdown_pct: 3.0,
    rpc_error_rate_pct: 0.2,
  });

  const latencyBoundary = nearMiss.active_boundaries.find((b) => b.name === 'execution_latency');
  assert.ok(latencyBoundary);
  assert.ok(latencyBoundary.distance_to_unsafe_pct < 20);
  assert.ok(nearMiss.safety_debt_score > 0); // Safety debt accumulated
  assert.ok(guardian.getNearMisses().length > 0);
});

test('PHOENIX - 14-Stage Recovery Machine, Priority Order & Epoch Invalidation', () => {
  const phoenix = new PhoenixRecoveryEngine();
  assert.equal(phoenix.getStatus().current_stage, 'NORMAL');
  assert.equal(phoenix.getStatus().authority_epoch, 1);
  assert.equal(phoenix.getStatus().new_entries_permitted, true);

  // 1. Trigger Failure Incident
  phoenix.triggerIncident('RPC Quorum Loss Crash', 448280050);
  const statusFail = phoenix.getStatus();
  assert.equal(statusFail.current_stage, 'FAILURE');
  assert.equal(statusFail.authority_epoch, 2); // Authority epoch bumped! Zombie permits invalidated
  assert.equal(statusFail.new_entries_permitted, false); // New entries locked!
  assert.equal(statusFail.emergency_exits_available, false);

  // 2. Advance through stages
  let stage = statusFail.current_stage;
  while (stage !== 'POSITION_RECONCILIATION') {
    stage = phoenix.advanceRecoveryStage();
  }

  // At POSITION_RECONCILIATION: emergency exits are restored, but new entries remain blocked!
  const statusExits = phoenix.getStatus();
  assert.equal(statusExits.emergency_exits_available, true);
  assert.equal(statusExits.new_entries_permitted, false);

  // 3. Unknown Transaction Reconciliation
  const purgeResolution = phoenix.reconcileUnknownTransaction('sig_123', true); // Blockhash expired
  assert.equal(purgeResolution.reconciled_action, 'PURGE_EXPIRED');

  // 4. Return to Normal
  phoenix.resetToNormal(448280100);
  assert.equal(phoenix.getStatus().current_stage, 'NORMAL');
  assert.equal(phoenix.getStatus().new_entries_permitted, true);
});

test('ARCHIMEDES - Hypothesis Registry, Applicability Envelopes & Contradictions', () => {
  const archimedes = new ArchimedesScientificMemory();
  const summary = archimedes.getSummary();

  assert.ok(summary.establishedCount >= 1);
  assert.ok(summary.falsifiedCount >= 1);

  // 1. Applicability Envelope Verification
  // Within envelope for fresh capital velocity (regime: RISK_ON, age: 60s, liq: $10,000)
  const validCheck = archimedes.verifyApplicability('hyp_fresh_capital_velocity', {
    regime: 'RISK_ON',
    token_age_sec: 60,
    liquidity_usd: 10000,
    crowding_pct: 30,
    horizon: 'SHORT_5M',
  });
  assert.equal(validCheck.applicable, true);

  // Outside envelope: Token age = 5s (min is 15s)
  const invalidAge = archimedes.verifyApplicability('hyp_fresh_capital_velocity', {
    regime: 'RISK_ON',
    token_age_sec: 5,
    liquidity_usd: 10000,
    crowding_pct: 30,
    horizon: 'SHORT_5M',
  });
  assert.equal(invalidAge.applicable, false);
  assert.ok(invalidAge.reason.includes('Token age'));

  // Outside envelope: Falsified hypothesis cannot be used
  const falsifiedCheck = archimedes.verifyApplicability('hyp_naive_hsi_alone', {
    regime: 'RISK_ON',
    token_age_sec: 60,
    liquidity_usd: 10000,
    crowding_pct: 30,
    horizon: 'MOMENTUM_1M',
  });
  assert.equal(falsifiedCheck.applicable, false);
  assert.ok(falsifiedCheck.reason.includes('FALSIFIED'));
});
