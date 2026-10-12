import test from 'node:test';
import assert from 'node:assert/strict';
import { RevocationEngine } from '../../dist/intelligence/revocation/revocation-engine.js';

test('REQ-012: RevocationEngine Monotonic Epoch TOCTOU Fence & Selective Scope Revalidation', async (t) => {
  await t.test('1. Monotonic epoch advancement on trigger and resolution', () => {
    const engine = new RevocationEngine();
    assert.equal(engine.getCurrentEpoch(), 1);
    assert.equal(engine.getActiveRevocationsCount(), 0);

    const record = engine.triggerRevocation({
      scope: 'TOKEN',
      target_entity_id: 'mint_risky_token_01',
      priority: 'R2_BLOCK_NEW_EXPOSURE',
      reason: 'Sudden liquidity drain detected',
      slot: 100,
    });

    assert.equal(engine.getCurrentEpoch(), 2);
    assert.equal(engine.getActiveRevocationsCount(), 1);
    assert.equal(record.epoch, 2);

    const resolved = engine.resolveRevocation(record.revocation_id, 'Remediation confirmed', 150);
    assert.equal(resolved, true);
    assert.equal(engine.getActiveRevocationsCount(), 0);
    assert.equal(engine.getCurrentEpoch(), 3, 'Resolution must advance epoch monotonically');
    assert.equal(engine.getResolvedRevocations().length, 1);
  });

  await t.test('2. TOCTOU fence blocks stale request epochs immediately', () => {
    const engine = new RevocationEngine();
    const plannedEpoch = engine.getCurrentEpoch();

    // Trigger state change during transit
    engine.triggerRevocation({
      scope: 'STRATEGY',
      target_entity_id: 'strat_alpha',
      priority: 'R2_BLOCK_NEW_EXPOSURE',
      reason: 'Parameter update in progress',
      slot: 200,
    });

    // Check with stale epoch for an unrelated token
    const report = engine.verifyRevocationBarrier({
      token_mint: 'mint_clean_token',
      intent_id: 'intent_123',
      strategy_id: 'strat_beta',
      route_name: 'route_orca',
      request_revocation_epoch: plannedEpoch, // Stale!
    });

    assert.equal(report.is_cleared_to_sign, false, 'Stale epoch must fail barrier');
    assert.equal(report.active_revocation_epoch, engine.getCurrentEpoch());
    assert.ok(report.blocking_revocations.some(r => r.reason.includes('Revocation epoch advanced')));
  });

  await t.test('3. Selective scopes enforce isolation: only targeted entities blocked', () => {
    const engine = new RevocationEngine();

    // Trigger route-specific revocation
    engine.triggerRevocation({
      scope: 'ROUTE',
      target_entity_id: 'route_congested_pool',
      priority: 'R2_BLOCK_NEW_EXPOSURE',
      reason: 'RPC timeout on congested pool',
      slot: 300,
    });

    const activeEpoch = engine.getCurrentEpoch();

    // Blocked on congested route
    const blockedRouteReport = engine.verifyRevocationBarrier({
      token_mint: 'mint_gem',
      intent_id: 'intent_1',
      strategy_id: 'strat_1',
      route_name: 'route_congested_pool',
      request_revocation_epoch: activeEpoch,
    });
    assert.equal(blockedRouteReport.is_cleared_to_sign, false);
    assert.equal(blockedRouteReport.blocking_revocations[0].scope, 'ROUTE');

    // Cleared on alternative healthy route
    const clearedRouteReport = engine.verifyRevocationBarrier({
      token_mint: 'mint_gem',
      intent_id: 'intent_2',
      strategy_id: 'strat_1',
      route_name: 'route_healthy_pool',
      request_revocation_epoch: activeEpoch,
    });
    assert.equal(clearedRouteReport.is_cleared_to_sign, true);
  });

  await t.test('4. Global revocation blocks all entities fail-closed', () => {
    const engine = new RevocationEngine();
    engine.triggerRevocation({
      scope: 'GLOBAL',
      target_entity_id: 'SYSTEM',
      priority: 'R5_GLOBAL_SIGNER_LOCK',
      reason: 'Global risk breaker triggered',
      slot: 400,
    });

    const report = engine.verifyRevocationBarrier({
      token_mint: 'any_mint',
      intent_id: 'any_intent',
      strategy_id: 'any_strat',
      route_name: 'any_route',
      request_revocation_epoch: engine.getCurrentEpoch(),
    });

    assert.equal(report.is_cleared_to_sign, false);
    assert.equal(report.blocking_revocations[0].scope, 'GLOBAL');
  });

  await t.test('5. ExpireRevocations cleans up aged transient circuit breakers', () => {
    const engine = new RevocationEngine();
    engine.triggerRevocation({
      scope: 'TOKEN',
      target_entity_id: 'mint_transient_spike',
      priority: 'R2_BLOCK_NEW_EXPOSURE',
      reason: 'Transient volatility breaker',
      slot: 500,
    });
    assert.equal(engine.getActiveRevocationsCount(), 1);

    // After 200 slots (maxAge = 300) -> not expired
    const expiredEarly = engine.expireRevocations(650, 300);
    assert.equal(expiredEarly, 0);
    assert.equal(engine.getActiveRevocationsCount(), 1);

    // After 400 slots -> expired
    const expired = engine.expireRevocations(901, 300);
    assert.equal(expired, 1);
    assert.equal(engine.getActiveRevocationsCount(), 0);
  });
});
