import test from 'node:test';
import assert from 'node:assert/strict';
import { missingSimulationRiskCertificate, SimulationRiskEnvelopeEngine } from '../../src/platform/execution/simulation-risk-envelope.ts';

test('missing simulation produces an explicit unapproved research certificate', () => {
  const certificate = missingSimulationRiskCertificate({ mint: 'mint-a', slot: 99, evaluatedAtMs: 1000 });
  assert.equal(certificate.isApproved, false);
  assert.equal(certificate.verdict, 'SIMULATION_REQUIRED');
  assert.equal(certificate.rejectionReason, 'SIMULATION_EVIDENCE_MISSING');
  assert.equal(certificate.authority, 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY');
  assert.match(certificate.certificateHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(certificate), true);
});

const validEvidence = (patch = {}) => ({
  simulationId: 'simulation-1', mint: 'mint-a', slot: 9, simulatedAtMs: 950,
  computeUnitsConsumed: 100_000, computeUnitsLimit: 200_000, isSimulationSuccess: true,
  expectedSolOut: 0.5, expectedTokenOut: 100, expectedSlippageBps: 100, priorityFeeLamports: 25_000n, tipLamports: 50_000n,
  ...patch,
});

test('risk evaluator rejects missing notional and malformed values instead of defaulting them', () => {
  const engine = new SimulationRiskEnvelopeEngine();
  const context = { nowMs: 1000, tradeNotionalSol: 0.5 };
  assert.equal(engine.evaluateSimulation(validEvidence(), { nowMs: 1000 }).isApproved, false);
  for (const patch of [
    { expectedSlippageBps: Number.NaN },
    { expectedSolOut: Number.POSITIVE_INFINITY },
    { expectedTokenOut: -1 },
    { computeUnitsConsumed: 10.5 },
    { isSimulationSuccess: 'true' },
    { tipLamports: -1n },
    { priorityFeeLamports: '100' },
  ]) {
    const result = engine.evaluateSimulation(validEvidence(patch), context);
    assert.equal(result.isApproved, false, JSON.stringify(patch, (_, value) => typeof value === 'bigint' ? value.toString() : value));
    assert.equal(result.verdict, 'MALFORMED_EVIDENCE');
  }
});

test('risk certificate binds economic outputs and fees and enforces configured drawdown', () => {
  const engine = new SimulationRiskEnvelopeEngine({ maxDailyDrawdownSol: 1.0 });
  const baseContext = { nowMs: 1000, tradeNotionalSol: 0.5, dailyDrawdownSol: 0.5 };
  const baseline = engine.evaluateSimulation(validEvidence(), baseContext);
  const differentOutput = engine.evaluateSimulation(validEvidence({ expectedSolOut: 0.49 }), baseContext);
  const differentTip = engine.evaluateSimulation(validEvidence({ tipLamports: 50_001n }), baseContext);
  const differentPriorityFee = engine.evaluateSimulation(validEvidence({ priorityFeeLamports: 25_001n }), baseContext);
  const drawdown = engine.evaluateSimulation(validEvidence(), { ...baseContext, dailyDrawdownSol: 1.1 });
  assert.equal(baseline.isApproved, true);
  assert.notEqual(baseline.certificateHash, differentOutput.certificateHash);
  assert.notEqual(baseline.certificateHash, differentTip.certificateHash);
  assert.notEqual(baseline.certificateHash, differentPriorityFee.certificateHash);
  assert.equal(drawdown.verdict, 'DAILY_DRAWDOWN_LIMIT_EXCEEDED');
  assert.equal(drawdown.isApproved, false);

  const cappedEngine = new SimulationRiskEnvelopeEngine({ maxPriorityFeeLamports: 25_000n });
  const priorityFeeCap = cappedEngine.evaluateSimulation(validEvidence({ priorityFeeLamports: 25_001n }), baseContext);
  assert.equal(priorityFeeCap.verdict, 'PRIORITY_FEE_CAP_EXCEEDED');
  assert.equal(priorityFeeCap.isApproved, false);
});
