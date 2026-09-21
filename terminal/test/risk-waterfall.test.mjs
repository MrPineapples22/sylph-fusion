import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRiskWaterfall } from '../src/risk-waterfall-eval.js';

test('evaluateRiskWaterfall computes stepped capital deductions correctly when capacity is open', () => {
  const res = evaluateRiskWaterfall({
    cash: '1000000000', // 1.0 SOL
    positions: [
      { asset: 'P1', cost: '100000000' }, // 0.1 SOL
    ],
    pending: null,
    limits: {
      reserve: '50000000',   // 0.05 SOL
      exposure: '500000000',  // 0.5 SOL max exposure
      buy: '100000000',       // 0.1 SOL
      positions: 3,
    },
    solPriceUsd: 150,
  });

  assert.equal(res.status, 'CAPACITY_OPEN');
  assert.equal(res.canEnter, true);
  assert.equal(res.metrics.totalCashSol, 1.0);
  assert.equal(res.metrics.reserveFloorSol, 0.05);
  assert.equal(res.metrics.operableCashSol, 0.95);
  assert.equal(res.metrics.activeExposureSol, 0.1);
  assert.equal(res.metrics.remainingExposureCapacitySol, 0.4);
  assert.equal(res.metrics.pendingCommitmentSol, 0.0);
  assert.equal(res.metrics.availableEntryBudgetSol, 0.4); // Limited by exposure ceiling (0.4 SOL < 0.95 SOL operable)

  // Verify 5 waterfall steps
  assert.equal(res.steps.length, 5);
  assert.equal(res.steps[0].id, 'gross_cash');
  assert.equal(res.steps[0].amountSol, 1.0);
  assert.equal(res.steps[1].id, 'reserved_floor');
  assert.equal(res.steps[1].amountSol, -0.05);
  assert.equal(res.steps[2].id, 'active_exposure');
  assert.equal(res.steps[2].amountSol, 0.1);
  assert.equal(res.steps[3].id, 'pending_hold');
  assert.equal(res.steps[3].amountSol, 0.0);
  assert.equal(res.steps[4].id, 'available_budget');
  assert.equal(res.steps[4].amountSol, 0.4);
});

test('evaluateRiskWaterfall identifies bottlenecks: HALTED, EXPOSURE_CAPPED, RESERVE_LOCKED', () => {
  // 1. Safety Halted
  const haltedRes = evaluateRiskWaterfall({
    cash: '1000000000',
    limits: { reserve: '50000000', exposure: '500000000', buy: '100000000' },
    halted: true,
  });
  assert.equal(haltedRes.status, 'SAFETY_HALTED');
  assert.equal(haltedRes.canEnter, false);
  assert.equal(haltedRes.metrics.availableEntryBudgetSol, 0.0);

  // 2. Exposure Capped
  const exposureRes = evaluateRiskWaterfall({
    cash: '2000000000', // 2.0 SOL
    positions: [
      { cost: '250000000' },
      { cost: '250000000' }, // Total 0.5 SOL = 100% of max exposure
    ],
    limits: { reserve: '50000000', exposure: '500000000', buy: '100000000', positions: 3 },
  });
  assert.equal(exposureRes.status, 'EXPOSURE_CAPPED');
  assert.equal(exposureRes.canEnter, false);
  assert.equal(exposureRes.metrics.availableEntryBudgetSol, 0.0);
  assert.equal(exposureRes.metrics.exposureUtilizationPct, 100.0);

  // 3. Max Positions Reached
  const maxPosRes = evaluateRiskWaterfall({
    cash: '2000000000',
    positions: [
      { cost: '10000000' },
      { cost: '10000000' },
      { cost: '10000000' },
    ],
    limits: { reserve: '50000000', exposure: '500000000', buy: '100000000', positions: 3 },
  });
  assert.equal(maxPosRes.status, 'MAX_POSITIONS_REACHED');
  assert.equal(maxPosRes.canEnter, false);

  // 4. Reserve Locked (Cash < Buy + Reserve)
  const lockedRes = evaluateRiskWaterfall({
    cash: '120000000', // 0.12 SOL < 0.15 SOL (0.1 buy + 0.05 reserve)
    limits: { reserve: '50000000', exposure: '500000000', buy: '100000000' },
  });
  assert.equal(lockedRes.status, 'RESERVE_LOCKED');
  assert.equal(lockedRes.canEnter, false);
  assert.equal(lockedRes.metrics.availableEntryBudgetSol, 0.0);
});

test('evaluateRiskWaterfall accounts for pending order holds and serializes entry lane', () => {
  const res = evaluateRiskWaterfall({
    cash: '1000000000',
    pending: {
      side: 'buy',
      mint: 'MintPending1111111111111111111111111111',
      requested: '100000000', // 0.1 SOL hold
    },
    limits: { reserve: '50000000', exposure: '500000000', buy: '100000000' },
  });

  assert.equal(res.status, 'PENDING_LANE_BUSY');
  assert.equal(res.canEnter, false);
  assert.equal(res.metrics.pendingCommitmentSol, 0.1);
});
