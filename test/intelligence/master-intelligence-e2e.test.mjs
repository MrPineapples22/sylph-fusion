import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';

test('MasterIntelligenceEngine end-to-end: processes synthetic launch, verifies all phases, produces Aether Flux viewmodel', async () => {
  const engine = new MasterIntelligenceEngine();

  // Verify IntegrationKernel registered all major components
  const scorecard = engine.kernel.generateIntegrationScorecard();
  assert.ok(scorecard.totalComponents >= 18, 'Must track at least 18 major subsystems');
  assert.equal(scorecard.degradedOrFailedCount, 0);

  const eventTime = 1_000_000;
  const canonicalEvent = {
    eventId: 'evt_launch_001',
    eventType: 'TOKEN_CREATE',
    mint: 'So11111111111111111111111111111111111111112',
    signature: '5abc123...',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 20,
    monotonicTimestamp: 10020,
    slot: 250_000,
    parentSlot: 249_999,
    blockhash: 'Bhash123...',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 12.5,
      priceSol: 0.00002,
    },
    sourceConfidence: 0.99,
    freshnessMs: 20,
    provenance: ['PUMP_PORTAL_WS'],
  };

  // Test Case 1: Healthy organic token launch
  const resultOrganic = await engine.processEvent(canonicalEvent, {
    tokenAgeSec: 25,
    rawWallets: [
      { address: 'w1', solFundedAmount: 2.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 1.5 },
      { address: 'w2', solFundedAmount: 1.5, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 1.2 },
      { address: 'w3', solFundedAmount: 3.0, parentFundingAddress: 'kraken_hot', buyVolumeSol: 2.5 },
      { address: 'w4', solFundedAmount: 0.8, parentFundingAddress: 'bybit_hot', buyVolumeSol: 0.7 },
      { address: 'w5', solFundedAmount: 5.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 4.1 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 120,
    liquiditySol: 60,
    txCount: 45,
  });

  assert.equal(resultOrganic.decision, 'AUTHORIZED_BUY');
  assert.ok(resultOrganic.allocatedSol > 0);
  assert.ok(resultOrganic.traceHash.length > 0);

  // Verify Aether Flux View Model preserves existing GUI table contract
  const vm = resultOrganic.viewModel;
  assert.equal(vm.symbol, 'SO11');
  assert.equal(vm.txs, 45);
  assert.equal(vm.audits, 'PASSED');
  assert.equal(vm.rug, 'CLEAN');
  assert.ok(vm.hsi < 50, 'HSI suspicion must be low (<50) for organic launch');
  assert.ok(vm.links.solscan.includes(canonicalEvent.mint));
  assert.ok(vm.links.pump.includes(canonicalEvent.mint));
  assert.equal(vm.advancedDiagnostics.safetyStatus, 'GREEN_OPERATIONAL');

  // Verify TokenUIState contract (Sections LXIV - LXXVII)
  assert.ok(vm.tokenUIState, 'TokenUIState must be populated for Aether Flux UI inspector');
  assert.equal(vm.tokenUIState.overview.currentStatus, 'PAPER_CANDIDATE');
  assert.equal(vm.tokenUIState.overview.rug, 'CLEAN');
  assert.ok(vm.tokenUIState.overview.safetyConfidence >= 90);
  assert.ok(vm.tokenUIState.forecast.pSurvive15m > 0);
  assert.equal(vm.tokenUIState.walletEntity.rawBuyers, 5);
  assert.equal(vm.tokenUIState.walletEntity.effectiveParticipants, 5);
  assert.equal(vm.tokenUIState.walletEntity.suspectedCoordination, false);
  assert.ok(vm.tokenUIState.evidence.supporting.length >= 3);
  assert.ok(vm.tokenUIState.council.councilConfidence > 0);
  assert.ok(vm.tokenUIState.decisionExplanation.whatSylphBelieves.includes('Token exhibits legitimate organic buying momentum'));
  assert.equal(vm.tokenUIState.specialStates.safeStateVerified, true);

  // Verify Point-in-Time Feature Store recorded snapshot
  const snapshot = engine.featureStore.getSnapshot(`snap_${canonicalEvent.eventId}`);
  assert.ok(snapshot !== undefined);
  assert.equal(snapshot?.mint, canonicalEvent.mint);

  // Test Case 2: Malicious token with active freeze authority -> must be RISK_REJECTED
  const resultMalicious = await engine.processEvent(
    {
      ...canonicalEvent,
      eventId: 'evt_launch_malicious',
      mint: 'BadToken1111111111111111111111111111111111111',
    },
    {
      tokenAgeSec: 10,
      rawWallets: [{ address: 'w1', solFundedAmount: 10.0, buyVolumeSol: 5.0 }],
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: true, // Malicious backdoor
      hasMintAuthority: false,
      marketCapSol: 50,
      liquiditySol: 20,
      txCount: 12,
    }
  );

  assert.ok(
    resultMalicious.decision === 'RISK_REJECTED' || resultMalicious.decision === 'SAFETY_LOCKED',
    'Freeze authority must be rejected'
  );
  assert.equal(resultMalicious.allocatedSol, 0);

  // Test Case 3: Sybil wash network -> High deception gap -> must NOT buy
  const resultSybil = await engine.processEvent(
    {
      ...canonicalEvent,
      eventId: 'evt_launch_sybil',
      mint: 'SybilToken11111111111111111111111111111111111',
    },
    {
      tokenAgeSec: 15,
      // 10 wallets all funded by the exact same deployer wallet -> 0 entropy
      rawWallets: Array.from({ length: 10 }, (_, i) => ({
        address: `sybil_wallet_${i}`,
        solFundedAmount: 1.0,
        parentFundingAddress: 'shared_deployer_insider',
        buyVolumeSol: 0.9,
      })),
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      marketCapSol: 80,
      liquiditySol: 30,
      txCount: 20,
    }
  );

  assert.notEqual(resultSybil.decision, 'AUTHORIZED_BUY');
  assert.equal(resultSybil.allocatedSol, 0);
  assert.ok(resultSybil.viewModel.advancedDiagnostics.deceptionGap > 0);
});

test('StrategyGovernance: Manifest creation, promotion gates, and safety certification', () => {
  const engine = new MasterIntelligenceEngine();

  const manifest = engine.governance.createManifest(
    'strat_institutional_momentum',
    '1.0.0',
    {
      hsiMinParticipation: 65,
      pumpScoreMinVelocity: 50,
      podMaxProfitOverhang: 15,
      maxClusterConcentrationPct: 20,
      maxPositionSol: 2.0,
      minRiskRewardRatio: 2.5,
      requireHumanSignoff: true,
    },
    '1.0.0',
    'world_model_v1'
  );

  assert.equal(manifest.state, 'PROPOSED');
  assert.ok(manifest.strategyHash.length > 0);

  // Test self-promotion block without human signoff (Section 88 invariant)
  assert.throws(
    () => {
      engine.governance.promoteToChampion('strat_institutional_momentum', '1.0.0', false);
    },
    /Section 88 Invariant/,
    'Must reject self-promotion without human approval'
  );

  // Promote with human signoff
  const champion = engine.governance.promoteToChampion('strat_institutional_momentum', '1.0.0', true);
  assert.equal(champion.state, 'CHAMPION');

  // Verify production gates & safety certificate
  const gateReport = engine.governance.evaluateProductionGates({
    isDataFeedLive: true,
    isChainReconciliationClean: true,
    isModelCalibrated: true,
    isMemoryRetrievalLeakFree: true,
    isPortfolioTailRiskWithinLimit: true,
    isRiskFirewallApproved: true,
    isExecutionRouterOperational: true,
    isKeySecurityVerified: true,
    isOperationsClean: true,
    isSafetyMonitorGreen: true,
  });

  assert.equal(gateReport.isLiveExecutionReady, true);
  assert.equal(gateReport.isAnalyticsReady, true);

  const cert = engine.governance.generateSafetyCertificate('build_2026_09_18_release', 'code_hash_final', gateReport);
  assert.equal(cert.isCertifiedForLive, true);
  assert.ok(cert.safetyConstitutionHash.startsWith('sha256_'));
});
