import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoalLoopMonitor } from '../terminal/goal-loop-health.mjs';

test('GoalLoopMonitor.isHealthy() returns true when all stages are fresh', () => {
  const now = 1_700_000_000_000;
  const monitor = new GoalLoopMonitor();
  for (const stage of GoalLoopMonitor.STAGES) {
    monitor.recordStage(stage, now);
  }
  assert.equal(monitor.isHealthy(now), true, 'All stages just recorded should be healthy');
});

test('GoalLoopMonitor.isHealthy() returns false when a stage is stale', () => {
  const now = 1_700_000_000_000;
  const monitor = new GoalLoopMonitor();
  for (const stage of GoalLoopMonitor.STAGES) {
    monitor.recordStage(stage, now);
  }
  // Advance time beyond the INGESTION cadence (default 2000ms)
  const future = now + 3000;
  assert.equal(monitor.isHealthy(future), false, 'INGESTION stage should be stale after 3s');
});

test('GoalLoopMonitor.isHealthy() returns false when no stages have ever fired', () => {
  const monitor = new GoalLoopMonitor();
  assert.equal(monitor.isHealthy(), false, 'No stages recorded should be unhealthy');
});

test('GoalLoopMonitor.getHealth() returns per-stage detail', () => {
  const now = 1_700_000_000_000;
  const monitor = new GoalLoopMonitor();
  monitor.recordStage('INGESTION', now);
  monitor.recordStage('FRESHNESS', now);
  monitor.recordStage('EVALUATION', now);
  monitor.recordStage('RECONCILIATION', now);
  monitor.recordStage('RENDER', now);

  const health = monitor.getHealth(now);
  assert.equal(health.stages.length, 5, 'Must have 5 stages');
  assert.equal(health.healthy, true);
  for (const s of health.stages) {
    assert.equal(s.fresh, true, `${s.stage} should be fresh`);
    assert.equal(s.ageMs, 0, `${s.stage} age should be 0`);
    assert.ok(s.cadenceMs > 0, `${s.stage} cadence should be positive`);
  }
});

test('GoalLoopMonitor tracks consecutive healthy and unhealthy checks', () => {
  const monitor = new GoalLoopMonitor();
  const now = 1_700_000_000_000;
  for (const stage of GoalLoopMonitor.STAGES) {
    monitor.recordStage(stage, now);
  }

  let health = monitor.getHealth(now);
  assert.equal(health.consecutiveHealthy, 1);
  assert.equal(health.consecutiveUnhealthy, 0);

  health = monitor.getHealth(now);
  assert.equal(health.consecutiveHealthy, 2);
  assert.equal(health.consecutiveUnhealthy, 0);

  // Make stale
  health = monitor.getHealth(now + 10000);
  assert.equal(health.consecutiveHealthy, 0);
  assert.equal(health.consecutiveUnhealthy, 1);
});

test('GoalLoopMonitor rejects invalid stage names', () => {
  const monitor = new GoalLoopMonitor();
  monitor.recordStage('INVALID_STAGE', Date.now());
  // Should not create an entry for invalid stage
  const health = monitor.getHealth();
  const invalidStage = health.stages.find(s => s.stage === 'INVALID_STAGE');
  assert.equal(invalidStage, undefined, 'Invalid stage should not appear');
});

test('GoalLoopMonitor supports custom cadences', () => {
  const now = 1_700_000_000_000;
  const monitor = new GoalLoopMonitor({
    cadences: { INGESTION: 500, FRESHNESS: 500, EVALUATION: 500, RECONCILIATION: 500, RENDER: 500 },
  });
  for (const stage of GoalLoopMonitor.STAGES) {
    monitor.recordStage(stage, now);
  }
  assert.equal(monitor.isHealthy(now + 400), true, 'Should be healthy within custom cadence');
  assert.equal(monitor.isHealthy(now + 600), false, 'Should be stale beyond custom cadence');
});

test('GoalLoopMonitor.healthCheckIntervalMs returns configured interval', () => {
  const monitor = new GoalLoopMonitor({ healthCheckIntervalMs: 2000 });
  assert.equal(monitor.healthCheckIntervalMs, 2000);
});

test('GoalLoopMonitor.STAGES returns all 5 operational stages', () => {
  const stages = GoalLoopMonitor.STAGES;
  assert.equal(stages.length, 5);
  assert.deepEqual(stages, ['INGESTION', 'FRESHNESS', 'EVALUATION', 'RECONCILIATION', 'RENDER']);
});

test('FRESHNESS stage cadence defaults to 5000ms matching DISCOVERY_FRESH_MS', () => {
  const monitor = new GoalLoopMonitor();
  const now = 1_700_000_000_000;
  monitor.recordStage('FRESHNESS', now);
  
  const health = monitor.getHealth(now);
  const freshnessStage = health.stages.find(s => s.stage === 'FRESHNESS');
  assert.equal(freshnessStage.cadenceMs, 5000, 'FRESHNESS cadence must match ≤5s firewall');
});
