import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PolicyEngine,
  DEFAULT_PRODUCTION_POLICY,
} from '../../dist/intelligence/policies/policy-bundle.js';

import {
  ExecutionAuthorityEngine,
  PositionReconciler,
} from '../../dist/intelligence/execution/execution-authority.js';

import {
  ContractRegistry,
  ConnectionRegistry,
  ConnectionAuditor,
} from '../../dist/intelligence/governance/contract-registry.js';

import {
  ProjectionEngine,
  UniversalWhyEngine,
  CommandBus,
} from '../../dist/intelligence/projections/projection-engine.js';

import {
  AlertEngine,
  WorkScheduler,
} from '../../dist/intelligence/runtime/operating-modes.js';

import {
  CanonicalTokenStore,
} from '../../dist/intelligence/truth/canonical-store.js';

test('Policy Engine: Enforces startup compatibility and token qualification thresholds', () => {
  const policyEngine = new PolicyEngine();
  const store = new CanonicalTokenStore();

  // Test 1: Compatible system versions
  const compValid = policyEngine.verifyCompatibility({
    pumpVersion: 16,
    hsiVersion: 10,
    podVersion: 9,
    evidenceVersion: 8,
    graphVersion: 7,
    worldModelVersion: 5,
  });
  assert.equal(compValid.isCompatible, true);

  // Test 2: Incompatible system version
  const compInvalid = policyEngine.verifyCompatibility({
    pumpVersion: 10, // requires >= 15
    hsiVersion: 10,
    podVersion: 9,
    evidenceVersion: 8,
    graphVersion: 7,
    worldModelVersion: 5,
  });
  assert.equal(compInvalid.isCompatible, false);
  assert.ok(compInvalid.incompatibleDetails[0].includes('Pump version'));

  // Test 3: Token qualification
  const token = store.registerToken({
    mint: 'MintQual1111111111111111111111111111111111',
    symbol: 'QUAL',
    name: 'Qualified Token',
    creatorAddress: 'CreatorQual',
    initialLiquiditySol: 30.0,
  });

  const qualRes = policyEngine.evaluateQualification(token);
  assert.equal(qualRes.qualified, true);
});

test('Execution Authority & Position Reconciler: Checks authority level and reconciles on-chain reality', () => {
  const execAuth = new ExecutionAuthorityEngine('SIMULATE');
  const reconciler = new PositionReconciler();
  const mint = 'MintExec1111111111111111111111111111111111';

  // In SIMULATE authority, isAuthorizedForLive must be false
  const { intent, isAuthorizedForLive } = execAuth.createIntent({
    decisionId: 'dec_01',
    mint,
    side: 'BUY',
    sizeSol: 0.5,
    expectedPriceSol: 0.0001,
  });
  assert.equal(isAuthorizedForLive, false);
  assert.equal(intent.authorityLevel, 'SIMULATE');

  // Position reconciliation
  const saved = new Map([[mint, 1000000n]]);
  const onChain = new Map([[mint, 950000n]]); // Discrepancy: on chain is 950k

  const results = reconciler.reconcile(saved, onChain);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'CORRECTED');
  assert.equal(results[0].discrepancyTokens, -50000n);
});

test('Connection Auditor: Empirically audits contracts and connections without hardcoding', () => {
  const contractRegistry = new ContractRegistry();
  const connectionRegistry = new ConnectionRegistry();

  contractRegistry.registerContract({
    subsystemId: 'sub_feed',
    name: 'Yellowstone Feed',
    version: '1.0.0',
    consumes: [],
    produces: ['CanonicalEvent'],
    dependencies: [],
    timeoutMs: 500,
    failureMode: 'FAIL_CLOSED',
    owner: 'Core Team',
  });

  connectionRegistry.registerConnection({
    connectionId: 'conn_feed_to_store',
    sourceComponent: 'sub_feed',
    targetComponent: 'sub_store',
    contractId: 'sub_feed',
    isRequired: true,
    testCoverageId: 'test_feed_to_store',
  });

  const auditor = new ConnectionAuditor(contractRegistry, connectionRegistry);

  // When both components exist
  const auditGood = auditor.auditAllConnections(new Set(['sub_feed', 'sub_store']));
  assert.equal(auditGood.connectedCount, 1);
  assert.equal(auditGood.scorePct, 100);

  // When target is missing
  const auditMissing = auditor.auditAllConnections(new Set(['sub_feed']));
  assert.equal(auditMissing.missingCount, 1);
  assert.equal(auditMissing.scorePct, 0);
});

test('Universal Why Engine & Projections: Provides complete causal explanation and incremental rendering', () => {
  const store = new CanonicalTokenStore();
  const projectionEngine = new ProjectionEngine();
  const mint = 'MintWhy111111111111111111111111111111111111';

  const token = store.registerToken({
    mint,
    symbol: 'WHY',
    name: 'Why Token',
    creatorAddress: 'CreatorWhy',
    initialLiquiditySol: 25.0,
  });

  const why = projectionEngine.whyEngine.explainToken(token);
  assert.ok(why.whyPump.includes('PumpScore'));
  assert.ok(why.whyHsi.includes('HSI'));
  assert.ok(why.whyPod.includes('PoD'));
  assert.ok(why.whatChanged.length > 0);
  assert.ok(why.whatMatters.length > 0);
  assert.ok(why.whatBreaksThis.length > 0);

  // Project Table Row
  const row = projectionEngine.projectTokenRow(token);
  assert.equal(row.symbol, 'WHY');
  assert.equal(row.liquidityFormatted, '25.0 SOL');
  assert.equal(row.statusBadge, 'ACTIVE');
});

test('UI Command Bus, Work Scheduler & Alert Engine: Routes user commands and manages alert lifecycle', () => {
  const commandBus = new CommandBus();
  const alertEngine = new AlertEngine();
  const scheduler = new WorkScheduler();

  let auditDispatched = false;
  commandBus.registerHandler('MANUAL_AUDIT', (cmd) => {
    auditDispatched = true;
  });

  const res = commandBus.dispatch({
    commandId: 'cmd_1',
    type: 'MANUAL_AUDIT',
    mint: 'MintCmd11111111111111111111111111111111111',
    requestedAtMs: Date.now(),
  });
  assert.equal(res.accepted, true);
  assert.equal(auditDispatched, true);

  // Alert Lifecycle: OPEN -> RESOLVED
  const alert = alertEngine.openAlert({
    severity: 'WARNING',
    title: 'High Slippage Risk',
    message: 'Liquidity thin on curve',
  });
  assert.equal(alert.status, 'OPEN');

  const resolved = alertEngine.resolveAlert(alert.alertId);
  assert.equal(resolved?.status, 'RESOLVED');

  // Work Scheduler: Survival mode permits P0/P1 only
  scheduler.setMode('SURVIVAL');
  assert.equal(scheduler.shouldExecute('P0_RISK_EXECUTION'), true);
  assert.equal(scheduler.shouldExecute('P1_CANONICAL_STATE'), true);
  assert.equal(scheduler.shouldExecute('P4_RESEARCH'), false);
});
