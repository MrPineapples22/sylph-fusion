import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

    const loaded = await store.getCounterfactualEvaluation(regretEval.evaluationId);
    assert.ok(loaded);
    assert.equal(loaded.evaluationId, regretEval.evaluationId);
    assert.equal(loaded.tokenId, 'token_durable_A');
    assert.equal(loaded.realizedPnlBps, -100);

    const tokenList = await store.getCounterfactualEvaluationsForToken('token_durable_A');
    assert.equal(tokenList.length, 1);
    assert.equal(tokenList[0].evaluationId, regretEval.evaluationId);
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

    const loaded = await store.getFalsificationReport(report.reportId);
    assert.ok(loaded);
    assert.equal(loaded.reportId, report.reportId);
    assert.equal(loaded.mint, 'MINT_STORE_FALSIFY');
    assert.equal(loaded.isThesisFalsified, report.isThesisFalsified);
  } finally {
    await store.close();
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
