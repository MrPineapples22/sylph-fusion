import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Part XLIV & XLV - Master Intelligence Engine Scientific Stack E2E Integration', async () => {
  const master = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(master);

  const now = Date.now();
  const mint = 'SoLScientific11111111111111111111111111111111';

  // 1. Ingest Canonical Token Trade Event
  const canonicalEvent = {
    eventId: 'evt_scientific_e2e_001',
    canonicalKey: `291000:sig_e2e_sci_tx:0:0:TOKEN_BUY`,
    eventType: 'TOKEN_BUY',
    mint,
    signature: 'sig_e2e_sci_tx',
    instructionIndex: 0,
    innerInstructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceSequence: 10,
    commitment: 'confirmed',
    chainTime: now - 30,
    sourceTimestampMs: now - 30,
    observedAt: now - 25,
    receivedAt: now - 20,
    receivedTimestampMs: now - 20,
    decodedAt: now - 15,
    monotonicTimestamp: now,
    slot: 291_000,
    parentSlot: 290_999,
    blockhash: 'BlockhashScientific111111111111111111111111',
    transactionVersion: 'legacy',
    sequenceId: 10,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 12.0,
      priceSol: 0.000030,
    },
    sourceConfidence: 0.96,
    freshnessMs: 20,
    provenance: ['PUMP_PORTAL_WS'],
    schemaVersion: '1.0.0',
    decoderVersion: 'pump_v2',
    rawHash: 'hash_sci_raw',
  };

  // 2. Process Event through Orchestrator
  const result = await master.processEvent(canonicalEvent, {
    tokenAgeSec: 45,
    rawWallets: [
      { address: 'w_founder_sci', solFundedAmount: 6.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 2.0 },
      { address: 'w_buyer_alpha', solFundedAmount: 3.5, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 1.8 },
      { address: 'w_buyer_beta', solFundedAmount: 4.0, parentFundingAddress: 'kraken_hot', buyVolumeSol: 2.5 },
      { address: 'w_buyer_gamma', solFundedAmount: 2.2, parentFundingAddress: 'okx_hot', buyVolumeSol: 1.1 },
      { address: 'w_buyer_delta', solFundedAmount: 5.0, parentFundingAddress: 'bybit_hot', buyVolumeSol: 3.6 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 180,
    liquiditySol: 70,
    txCount: 45,
  });

  // 3. Verify Result & ViewModel
  assert.ok(result !== undefined);
  const vm = result.viewModel;
  assert.ok(vm !== undefined, 'Result must contain AetherFluxViewModel');

  // Verify Compact Primary Table Badges
  assert.ok(['STRONG', 'MIXED', 'WEAK', 'CONFLICT', 'UNKNOWN'].includes(vm.intel), `Intel badge must be valid, got ${vm.intel}`);
  assert.ok(['LOW', 'WATCH', 'HIGH', 'BLOCK'].includes(vm.risk), `Risk badge must be valid, got ${vm.risk}`);

  // 4. Verify Deep Scientific Telemetry Structure
  const sci = vm.blueprintTelemetry?.scientific;
  assert.ok(sci !== undefined, 'Blueprint telemetry must contain scientific sub-tree');

  // Check BOHR Competing Hypotheses
  assert.ok(sci.bohr.dominantHypothesis.length > 0);
  assert.ok(sci.bohr.materialAlternative.length > 0);
  assert.ok(sci.bohr.unknownMass >= 0.05, 'Bohr must maintain >= 5% UNKNOWN probability mass');

  // Check BAYES Belief Updating
  assert.ok(sci.bayes.priorProb > 0 && sci.bayes.priorProb < 1.0);
  assert.ok(sci.bayes.posteriorProb > 0 && sci.bayes.posteriorProb < 1.0);

  // Check PEARL Causal Identification
  assert.ok(
    ['IDENTIFIED', 'PLAUSIBLY_IDENTIFIED', 'PARTIALLY_IDENTIFIED', 'ASSUMPTION_SENSITIVE', 'NOT_IDENTIFIABLE', 'UNKNOWN'].includes(
      sci.pearl.identifiability
    )
  );
  assert.equal(sci.pearl.isSelfCaused, false);

  // Check EINSTEIN Reference Frames
  assert.ok(sci.einstein.velocityByAgeNormalized >= 0);
  assert.ok(sci.einstein.liquidityToMcapRatio >= 0);
  assert.ok(sci.einstein.volumeTurnoverNormalized >= 0);

  // Check DARWIN Strategy Ecology
  assert.equal(sci.darwin.activeStrategyId, 'breakout_momentum_v1');
  assert.equal(sci.darwin.lifecycleStage, 'ACTIVE');

  // Check MENDEL Gene Heredity
  assert.ok(sci.mendel.activeGeneCount >= 2);
  assert.equal(sci.mendel.interactionState, 'SYNERGISTIC');

  // Check PASTEUR Research Integrity
  assert.equal(sci.pasteur.temporalIntegrityValid, true, 'Temporal integrity must be clean (no lookahead leaks)');
  assert.equal(sci.pasteur.testExposureCount, 1);

  // Check CURIE Replicated Knowledge
  assert.ok(sci.curie.applicableClaimsCount >= 1);

  // Check Authoritative Capital Ledger
  assert.ok(sci.ledger.availableCashSol > 0);
  assert.equal(sci.ledger.hiddenGeneRisk, false);

  // Check Compact Module Health Strip
  assert.equal(sci.healthStrip.obs, 'OK');
  assert.equal(sci.healthStrip.bel, 'OK');
  assert.equal(sci.healthStrip.cau, 'OK');
  assert.equal(sci.healthStrip.knw, 'OK');
  assert.equal(sci.healthStrip.str, 'OK');
  assert.equal(sci.healthStrip.rsk, 'OK');
  assert.equal(sci.healthStrip.sys, 'OK');
  assert.equal(sci.healthStrip.aut, 'OK');

  // 5. Test FEYNMAN Structured Explanation Generation
  const explanation = master.generateFeynmanExplanation(mint);
  assert.ok(explanation.includes('CURRENT SCIENTIFIC INTERPRETATION'));
  assert.ok(explanation.includes('Dominant Hypothesis:'));
  assert.ok(explanation.includes('Material Alternative:'));
  assert.ok(explanation.includes('Causal Status:'));
});
