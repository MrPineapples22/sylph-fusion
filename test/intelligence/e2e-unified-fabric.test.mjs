import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';

test('Unified Fabric E2E: Full lifecycle from canonical event to OpportunityContract, AssuranceCase, and AetherFluxViewModel', async () => {
  const engine = new MasterIntelligenceEngine();

  const canonicalEvent = {
    eventId: 'evt_e2e_verified_001',
    eventType: 'TOKEN_CREATE',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    signature: 'sig_e2e_verified_signature_123',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: 1_700_000_000,
    receivedTimestampMs: 1_700_000_050,
    monotonicTimestamp: 50050,
    slot: 290_000,
    parentSlot: 289_999,
    blockhash: 'BhashE2E123',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 15.0,
      priceSol: 0.000025,
    },
    sourceConfidence: 0.99,
    freshnessMs: 50,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const context = {
    tokenAgeSec: 45,
    rawWallets: [
      { address: 'wallet_alpha_01', solFundedAmount: 5.0, parentFundingAddress: 'exchange_binance', buyVolumeSol: 3.5 },
      { address: 'wallet_beta_02', solFundedAmount: 4.0, parentFundingAddress: 'exchange_kraken', buyVolumeSol: 2.8 },
      { address: 'wallet_gamma_03', solFundedAmount: 6.0, parentFundingAddress: 'exchange_coinbase', buyVolumeSol: 4.0 },
      { address: 'wallet_delta_04', solFundedAmount: 3.0, parentFundingAddress: 'exchange_okx', buyVolumeSol: 2.1 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 150,
    liquiditySol: 75,
    txCount: 65,
  };

  const result = await engine.processEvent(canonicalEvent, context);

  // 1. Core decision verification
  assert.equal(result.decision, 'AUTHORIZED_BUY', 'Organic launch must qualify for authorization');
  assert.ok(result.allocatedSol > 0, 'Allocated SOL must be positive');
  assert.ok(result.traceId, 'Must have active trace ID');
  assert.ok(result.traceHash, 'Must have verifiable trace hash');

  // 2. Opportunity Contract verification (Parts XLIV & XLV)
  const opp = result.opportunityContract;
  assert.ok(opp, 'Must produce OpportunityContract');
  assert.equal(opp.mint, canonicalEvent.mint);
  assert.ok(opp.opportunityHalfLifeMs > 0, 'Must estimate opportunity half-life');
  assert.ok(typeof opp.expectedExecutableEdgePct === 'number', 'Must compute executable edge');
  assert.ok(opp.pTargetFirst >= 0 && opp.pTargetFirst <= 1, 'Path-dependent probability target first');
  assert.ok(opp.pStopFirst >= 0 && opp.pStopFirst <= 1, 'Path-dependent probability stop first');

  // 3. Runtime Assurance Case verification (Parts LXXXIV & LXXXV)
  const assurance = result.assuranceCase;
  assert.ok(assurance, 'Must generate DecisionAssuranceCase');
  assert.equal(assurance.operationalState, 'HEALTHY');
  assert.equal(assurance.isAuthorizedForExecution, true);
  assert.ok(assurance.assuranceScore >= 0.7, 'Assurance score must be high for clean pipeline');
  assert.ok(assurance.provenanceChain.length >= 3, 'Must contain complete provenance chain');

  // 4. 14-Dimension System Trust Vector verification (Part LXXXII)
  const tv = assurance.trustVector;
  assert.ok(tv.dataIntegrity >= 90);
  assert.ok(tv.dataFreshness >= 90);
  assert.ok(tv.stateConsistency === 100);
  assert.ok(tv.graphReliability >= 90);
  assert.ok(tv.featureReliability >= 90);
  assert.ok(tv.modelCompetence >= 80);
  assert.ok(tv.calibrationHealth >= 80);
  assert.ok(tv.decisionIntegrity === 100);
  assert.ok(tv.portfolioIntegrity === 100);
  assert.ok(tv.executionHealth === 100);
  assert.ok(tv.infrastructureHealth >= 90);

  // 5. Aether Flux Presentation ViewModel verification (Parts CXX - CXXV)
  const vm = result.viewModel;
  assert.ok(vm.time, 'ViewModel must have time');
  assert.ok(vm.symbol, 'ViewModel must have symbol');
  assert.ok(vm.txs > 0, 'ViewModel must have txs');
  assert.ok(vm.mcap > 0, 'ViewModel must have mcap');
  assert.ok(vm.liquidity > 0, 'ViewModel must have liquidity');
  assert.equal(vm.rug, 'CLEAN');
  assert.ok(typeof vm.hsi === 'number');
  assert.ok(typeof vm.pumpScore === 'number');
  assert.ok(['P', 'N', 'D'].includes(vm.podState), 'podState must be P, N, or D');
  assert.ok(['HIGH', 'MED', 'LOW'].includes(vm.conf), 'conf must be HIGH, MED, or LOW');
  assert.ok(vm.edge.includes('%'), 'edge must be formatted percentage');
  assert.ok(['OBSERVE', 'WATCH', 'QUALIFIED', 'EXECUTABLE', 'PROTECTED', 'ABSTAIN', 'REJECTED', 'DUMPING', 'ACTIVE', 'EXIT'].includes(vm.status), `Status '${vm.status}' must be one of the authoritative unified states`);
  assert.ok(vm.links.solscan.includes(canonicalEvent.mint));

  // 6. Continuous Connection Auditor verification (Parts XC & CXXXVIII)
  const audit = engine.runConnectionAudit();
  assert.equal(audit.passed, true, 'All registered pipeline edges must pass audit');
  assert.equal(audit.brokenEdges.length, 0, 'Must have 0 broken edges');
  assert.equal(audit.riskBypasses.length, 0, 'Must have 0 risk bypasses');
  assert.ok(audit.healthyConnectionsCount >= 10, 'Must have at least 10 verified connections');
});
