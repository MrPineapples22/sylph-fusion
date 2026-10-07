import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../../dist/store.js';
import {
  ExecutionRegretEngine,
  CounterfactualRegretStore,
} from '../../dist/intelligence/forensics/counterfactual-regret-store.js';
import { AutomaticFalsificationAgent } from '../../dist/platform/adversarial/automatic-falsification-agent.js';
import { EntityControlX } from '../../dist/platform/security/entity-control-x.js';

test('Store: persists and retrieves CounterfactualEvaluations via SQLite WAL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-cfr-'));
  const store = new Store(join(dir, 'state.sqlite'));

  try {
    const regretEval = ExecutionRegretEngine.evaluateDecisionRegret({
      decisionId: 'dec_durable_1',
      opportunityId: 'opp_durable_1',
      tokenId: 'token_durable_A',
      slot: 500_000,
      actionTaken: 'FAST_BUY',
      expectedNetEvBps: 350,
      expectedSlippageBps: 80,
      realizedPnlBps: -100,
      realizedSlippageBps: 120,
      realizedTipLamports: 150_000n,
      discoveryLagMs: 140,
      peakObservedPriceBps: 150,
    });

    await store.saveCounterfactualEvaluation(regretEval);
    await store.saveCounterfactualEvaluation(regretEval);

    const loaded = await store.getCounterfactualEvaluation(regretEval.evaluationId);
    assert.ok(loaded);
    assert.equal(loaded.evaluationId, regretEval.evaluationId);
    assert.equal(loaded.tokenId, 'token_durable_A');
    assert.equal(loaded.realizedPnlBps, -100);
    assert.deepEqual(loaded.evidenceLineage, regretEval.evidenceLineage);
    assert.ok(loaded.scenarios.every(s => s.evidenceClass === 'MODELLED_COUNTERFACTUAL_SCENARIO'));

    const tokenList = await store.getCounterfactualEvaluationsForToken('token_durable_A');
    assert.equal(tokenList.length, 1);
    assert.equal(tokenList[0].evaluationId, regretEval.evaluationId);
    await assert.rejects(
      store.saveCounterfactualEvaluation({ ...regretEval, tokenId: 'token_changed' }),
      /COUNTERFACTUAL_ID_CONTENT_CONFLICT/
    );
    assert.equal((await store.getCounterfactualEvaluationsForToken('token_durable_A')).length, 1);
    assert.equal((await store.getCounterfactualEvaluationsForToken('token_changed')).length, 0);
  } finally {
    await store.close();
  }
});

test('Store: preserves distinct counterfactual observations for one opportunity and slot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-cfr-distinct-observations-'));
  const store = new Store(join(dir, 'state.sqlite'));
  const input = {
    decisionId: 'dec_same_slot_observation', opportunityId: 'opp_same_slot_observation',
    tokenId: 'token_same_slot_observation', slot: 500_020, actionTaken: 'FAST_BUY',
    expectedNetEvBps: 350, expectedSlippageBps: 80, realizedPnlBps: -100,
    realizedSlippageBps: 120, realizedTipLamports: 150_000n, discoveryLagMs: 140,
  };
  const originalNow = Date.now;
  let first;
  let second;
  try {
    Date.now = () => 1_800_000_000_000;
    first = ExecutionRegretEngine.evaluateDecisionRegret(input);
    Date.now = () => 1_800_000_000_001;
    second = ExecutionRegretEngine.evaluateDecisionRegret(input);
  } finally {
    Date.now = originalNow;
  }

  try {
    assert.notEqual(first.evaluationId, second.evaluationId);
    await store.saveCounterfactualEvaluation(first);
    await store.saveCounterfactualEvaluation(second);
    assert.deepEqual(await store.getCounterfactualEvaluation(first.evaluationId), first);
    assert.deepEqual(await store.getCounterfactualEvaluation(second.evaluationId), second);
    assert.equal((await store.getCounterfactualEvaluationsForToken(input.tokenId)).length, 2);
  } finally {
    await store.close();
  }
});

test('Store: persists and retrieves FalsificationReport via SQLite WAL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-falsify-'));
  const store = new Store(join(dir, 'state.sqlite'));

  try {
    const report = AutomaticFalsificationAgent.falsifyOpportunity({
      mint: 'MINT_STORE_FALSIFY',
      slot: 600_000,
      poolSolReserve: 50,
      latentInventoryFraction: 0.35,
      expectedNetEvBps: 180,
      alphaHalfLifeMs: 1000,
      maxSlippageBps: 100,
      washTradingProbability: 0.20,
    });

    await store.saveFalsificationReport(report);
    await store.saveFalsificationReport(report);

    const loaded = await store.getFalsificationReport(report.reportId);
    assert.ok(loaded);
    assert.equal(loaded.reportId, report.reportId);
    assert.equal(loaded.mint, 'MINT_STORE_FALSIFY');
    assert.equal(loaded.isThesisFalsified, report.isThesisFalsified);
    assert.deepEqual(loaded.evidenceLineage, report.evidenceLineage);
    assert.ok(loaded.stressScenariosTested.every(s => s.evidenceClass === 'MODELLED_STRESS_SCENARIO'));
    await assert.rejects(
      store.saveFalsificationReport({ ...report, mint: 'MINT_CHANGED' }),
      /FALSIFICATION_ID_CONTENT_CONFLICT/
    );
    assert.equal((await store.getFalsificationReport(report.reportId)).mint, 'MINT_STORE_FALSIFY');
  } finally {
    await store.close();
  }
});

test('Store: rejects counterfactual rows whose indexed columns disagree with their immutable JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-cfr-corrupt-'));
  const path = join(dir, 'state.sqlite');
  const store = new Store(path);
  const regretEval = ExecutionRegretEngine.evaluateDecisionRegret({
    decisionId: 'dec_corrupt_cfr', opportunityId: 'opp_corrupt_cfr', tokenId: 'token_corrupt_cfr',
    slot: 500_010, actionTaken: 'FAST_BUY', expectedNetEvBps: 350, expectedSlippageBps: 80,
    realizedPnlBps: -100, realizedSlippageBps: 120, realizedTipLamports: 150_000n, discoveryLagMs: 140,
  });
  await store.saveCounterfactualEvaluation(regretEval);
  await store.close();

  const db = new DatabaseSync(path);
  db.prepare('UPDATE counterfactual_regrets SET token_id=? WHERE evaluation_id=?').run('tampered-index', regretEval.evaluationId);
  db.close();

  const reopened = new Store(path);
  try {
    await assert.rejects(reopened.saveCounterfactualEvaluation(regretEval), /COUNTERFACTUAL_ROW_INCONSISTENT/);
  } finally {
    await reopened.close();
  }
});

test('Store: rejects falsification rows whose indexed columns disagree with their immutable JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-falsify-corrupt-'));
  const path = join(dir, 'state.sqlite');
  const store = new Store(path);
  const report = AutomaticFalsificationAgent.falsifyOpportunity({
    mint: 'MINT_CORRUPT_FALSIFY', slot: 600_010, poolSolReserve: 50,
    latentInventoryFraction: 0.35, expectedNetEvBps: 180, alphaHalfLifeMs: 1000,
    maxSlippageBps: 100, washTradingProbability: 0.20,
  });
  await store.saveFalsificationReport(report);
  await store.close();

  const db = new DatabaseSync(path);
  db.prepare('UPDATE falsification_reports SET mint=? WHERE report_id=?').run('TAMPERED_MINT', report.reportId);
  db.close();

  const reopened = new Store(path);
  try {
    await assert.rejects(reopened.saveFalsificationReport(report), /FALSIFICATION_ROW_INCONSISTENT/);
  } finally {
    await reopened.close();
  }
});

test('Store: persists and retrieves EntityControlEvaluation via SQLite WAL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-entity-'));
  const store = new Store(join(dir, 'state.sqlite'));

  try {
    const evalResult = EntityControlX.evaluateSupply({
      mint: 'MINT_STORE_ENTITY',
      totalSupplyRaw: 1_000_000_000n,
      holdings: [
        { address: 'w1', balanceRaw: 200_000_000n, rootFunder: 'root_A' },
        { address: 'w2', balanceRaw: 200_000_000n, rootFunder: 'root_A' },
        { address: 'w3', balanceRaw: 600_000_000n, rootFunder: 'root_B' },
      ],
    });

    await store.saveEntityControlEvaluation(evalResult);

    const loaded = await store.getEntityControlEvaluation('MINT_STORE_ENTITY');
    assert.ok(loaded);
    assert.equal(loaded.mint, 'MINT_STORE_ENTITY');
    assert.equal(loaded.rawWalletCount, 3);
    assert.equal(loaded.resolvedEntityCount, 2);
  } finally {
    await store.close();
  }
});

test('CounterfactualRegretStore: write-through to DurableRegretJournal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-cfr-store-'));
  const store = new Store(join(dir, 'state.sqlite'));

  try {
    const regretStore = new CounterfactualRegretStore(100, store);

    const evalResult = ExecutionRegretEngine.evaluateDecisionRegret({
      decisionId: 'dec_wt_1',
      opportunityId: 'opp_wt_1',
      tokenId: 'token_wt_1',
      slot: 700_000,
      actionTaken: 'BREAKOUT_ENTER',
      expectedNetEvBps: 280,
      expectedSlippageBps: 60,
      realizedPnlBps: 200,
      realizedSlippageBps: 70,
      realizedTipLamports: 100_000n,
      discoveryLagMs: 80,
    });

    regretStore.recordEvaluation(evalResult);

    // Allow slight async write tick
    await new Promise(r => setTimeout(r, 50));

    const loaded = await store.getCounterfactualEvaluation(evalResult.evaluationId);
    assert.ok(loaded);
    assert.equal(loaded.decisionId, 'dec_wt_1');
    assert.equal(loaded.realizedPnlBps, 200);
  } finally {
    await store.close();
  }
});

test('CounterfactualRegretStore handles immutable journal rejection and exposes the failure', async () => {
  const regretStore = new CounterfactualRegretStore(10, {
    saveCounterfactualEvaluation: async () => { throw new Error('COUNTERFACTUAL_ID_CONTENT_CONFLICT'); },
  });
  const evaluation = ExecutionRegretEngine.evaluateDecisionRegret({
    decisionId: 'dec_handled_conflict', opportunityId: 'opp_handled_conflict', tokenId: 'token_handled_conflict',
    slot: 700_001, actionTaken: 'BREAKOUT_ENTER', expectedNetEvBps: 280, expectedSlippageBps: 60,
    realizedPnlBps: 200, realizedSlippageBps: 70, realizedTipLamports: 100_000n, discoveryLagMs: 80,
  });
  regretStore.recordEvaluation(evaluation);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(regretStore.getJournalHealth(), {
    failureCount: 1,
    lastError: 'COUNTERFACTUAL_ID_CONTENT_CONFLICT',
  });
});
