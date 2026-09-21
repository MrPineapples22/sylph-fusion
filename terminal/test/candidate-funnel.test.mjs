import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFunnelFromSession } from '../soak-reader.mjs';

test('computeFunnelFromSession calculates pass-through counts and drop-offs across all 7 gates', () => {
  const rejectionMap = new Map([
    ['all RPC endpoints failed', 34],
    ['unsupported curve mode', 12],
    ['insufficient real reserves', 6],
    ['creator concentration', 5],
    ['rug report rejected', 3],
    ['reserve_drift', 4],
    ['insufficient_cash_or_reserve', 2],
  ]);

  const totalRejections = [...rejectionMap.values()].reduce((a, b) => a + b, 0); // 66
  const fillsCount = 4;

  const funnel = computeFunnelFromSession({
    rejectionMap,
    totalRejections,
    fillsCount,
    candidatesCount: 70,
  });

  assert.equal(funnel.discovered, 70);
  assert.ok(funnel.aged <= funnel.discovered, 'Aged must not exceed discovered');
  assert.ok(funnel.buyerThreshold <= funnel.aged, 'Buyer threshold must not exceed aged');
  assert.ok(funnel.safetyPassed <= funnel.buyerThreshold, 'Safety passed must not exceed buyer threshold');
  assert.ok(funnel.driftPassed <= funnel.safetyPassed, 'Drift passed must not exceed safety passed');
  assert.ok(funnel.eligible <= funnel.driftPassed, 'Eligible must not exceed drift passed');
  assert.equal(funnel.paperFilled, 4, 'Paper filled matches fills count');

  assert.equal(funnel.stageDropOffs.length, 6);
  assert.match(funnel.stageDropOffs[1].topReason, /RPC rate limits/);
  assert.match(funnel.stageDropOffs[2].topReason, /Safety gate/);
  assert.match(funnel.stageDropOffs[3].topReason, /Reserve drift/);
});

test('computeFunnelFromSession handles empty session with zero candidates and zero fills gracefully', () => {
  const funnel = computeFunnelFromSession({
    rejectionMap: new Map(),
    totalRejections: 0,
    fillsCount: 0,
    candidatesCount: 0,
  });

  assert.equal(funnel.discovered, 0);
  assert.equal(funnel.aged, 0);
  assert.equal(funnel.buyerThreshold, 0);
  assert.equal(funnel.safetyPassed, 0);
  assert.equal(funnel.driftPassed, 0);
  assert.equal(funnel.eligible, 0);
  assert.equal(funnel.paperFilled, 0);
  assert.equal(funnel.stageDropOffs.length, 6);
  assert.equal(funnel.stageDropOffs[0].dropCount, 0);
});
