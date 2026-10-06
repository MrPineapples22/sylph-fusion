/**
 * SYLPH FUSION — PIPELINE COMPONENT CONTRACT SMOKE TESTS
 * Specifications: User Audit Section 23 (Connection Tests)
 *
 * Exercises selected module contracts with synthetic fixtures. These tests
 * instantiate modules directly and do not prove live Engine wiring.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { IngestionGapReconciler } from '../../dist/platform/ingestion/gap-reconciler.js';
import {
  envelopeFromSylphEvent,
} from '../../dist/platform/pipeline/adapters/canonical-event-adapter.js';
import {
  envelopeRoot,
} from '../../dist/platform/pipeline/fusion-envelope.js';
import { FusionJournal } from '../../dist/platform/pipeline/fusion-journal.js';
import {
  initializeReducedState,
  reduceFusionTransition,
} from '../../dist/platform/pipeline/fusion-reducer.js';
import {
  buildCandidateSnapshot,
} from '../../dist/candidate-snapshot.js';
import { HierarchicalRegimeEngine } from '../../dist/intelligence/signals/regime.js';
import { PhaseTransitionDetector } from '../../dist/intelligence/signals/phase-transition.js';
import {
  SignalFamilyAggregator,
  certifySignalPortfolio,
} from '../../dist/intelligence/signal-ecology/index.js';
import {
  computeOrthogonalizedAlpha,
} from '../../dist/intelligence/alpha-reality/index.js';
import {
  CapitalOrchestratorX,
} from '../../dist/intelligence/control/capital-orchestrator-x/index.js';
import { CanaryInvariantController } from '../../dist/intelligence/certification/safe-canary/index.js';
import { CapitalKernel } from '../../dist/intelligence/capital/capital-kernel.js';
import {
  compileTradeAccounting,
} from '../../dist/intelligence/economics/profit-compiler/index.js';
import { DoubleEntryJournal } from '../../dist/platform/ledger/double-entry.js';
import {
  ConservationProofAuthority,
  OutcomeMaturityGate,
} from '../../dist/platform/pipeline/conservation-proofs.js';
import { RealizedEdgeLedger } from '../../dist/platform/pipeline/realized-edge-ledger.js';

test('SMOKE 1: standalone discovery and canonical adapter preserve transaction identity', () => {
  const slot = 320000000n;
  const signature = '5TestSigDiscoveryToCanonical11111111111111111111111111111111111111111111111111111111111';
  const mint = 'MintWiring111111111111111111111111111111111111';
  const now = Date.now();

  // 1. Discovery
  const gapReconciler = new IngestionGapReconciler();
  gapReconciler.registerSlot(Number(slot), 1, false);

  // 2. Canonical event
  const canonicalEvent = {
    eventId: `evt_${slot}_1`,
    canonicalKey: `fact_${mint}_${slot}`,
    correlationId: `corr_${mint}_${slot}`,
    sequence: 1,
    eventType: 'TOKEN_DISCOVERED',
    source: 'HELIOS_WSS',
    slot: Number(slot),
    observedAt: now,
    receivedAt: now,
    transactionSignature: signature,
    payload: { mint, slot: Number(slot), signature },
    evidenceFingerprint: createHash('sha256').update(signature).digest('hex'),
  };

  // 3. FusionEnvelope
  const envelope = envelopeFromSylphEvent(canonicalEvent);
  assert.equal(envelope.observedSlot, slot);
  assert.equal(envelope.economicFactId, canonicalEvent.canonicalKey);
  assert.equal(envelope.traceId, canonicalEvent.correlationId);
  assert.ok(envelope.evidenceRoot);
});

test('SMOKE 2: canonical adapter, journal and reducer accept one evidence identity', () => {
  const slot = 320000000n;
  const mint = 'MintWiring111111111111111111111111111111111111';
  const now = Date.now();

  const canonicalEvent = {
    eventId: `evt_wiring_2`,
    canonicalKey: `fact_wiring_2`,
    correlationId: `corr_wiring_2`,
    sequence: 2,
    eventType: 'SWAP_EXECUTED',
    source: 'YELLOWSTONE_GRPC',
    slot: Number(slot),
    observedAt: now,
    receivedAt: now,
    payload: { mint, amountLamports: 100_000_000n },
    evidenceFingerprint: createHash('sha256').update('evidence_2').digest('hex'),
  };

  const envelope = envelopeFromSylphEvent(canonicalEvent);
  const initial = initializeReducedState(envelope);
  assert.equal(initial.state, 'OBSERVED');

  const journal = new FusionJournal();
  journal.append({
    journalEntryId: 'entry_wire_2',
    envelopeId: envelope.envelopeId,
    economicFactId: envelope.economicFactId,
    fromState: 'OBSERVED',
    toState: 'EVIDENCE_CERTIFIED',
    previousStateRoot: initial.stateRoot,
    nextStateRoot: createHash('sha256').update(envelope.evidenceRoot).digest('hex'),
    envelopeRoot: envelopeRoot(envelope),
    certificateHash: 'cert_cov_wire_2',
    observedAt: new Date().toISOString(),
  });
  assert.equal(journal.length(), 1);
  assert.equal(journal.verify().valid, true);

  const reduced = reduceFusionTransition(initial, 'EVIDENCE_CERTIFIED', {
    evidenceRoot: envelope.evidenceRoot,
    coverageCertificate: 'cert_cov_wire_2',
  });
  assert.equal(reduced.state, 'EVIDENCE_CERTIFIED');
  assert.notEqual(reduced.stateRoot, initial.stateRoot);
});

test('SMOKE 3: candidate snapshot and intelligence modules accept a synthetic fixture', () => {
  const mint = 'MintWiring111111111111111111111111111111111111';
  const slot = 320000000n;
  const now = Date.now();

  const snapshot = buildCandidateSnapshot({
    mint,
    poolAddress: mint,
    slot: Number(slot),
    eventSignature: `sig_${mint}`,
    observedAtMs: now - 500,
    decisionAtMs: now,
    policyContext: {
      policyVersion: 'wiring-v1',
      maxSlippageBps: 150,
      targetSizeLamports: '100000000',
      priorityFeeMultiplier: 1,
      exitLadderConfigHash: 'ladder-hash-wire-3',
    },
    evaluationDisposition: 'cleared',
    microstructure: {
      buyerCount5m: 15,
      buyTransactionCount: 20,
      sellTransactionCount: 2,
      buySellRatio: 10.0,
      buyerArrivalVelocityPerSec: 1.5,
      creatorWalletHashed: 'creator_hashed_wire_3',
    },
    curveState: {
      tokenAgeSeconds: 15,
      realSolReservesLamports: '32500000000',
      virtualSolReservesLamports: '32500000000',
      virtualTokenReserves: '1073000000000000',
      curveCompletionPct: 32.5,
      reserveDriftPct: 1.2,
    },
    transport: {
      discoverySource: 'HELIOS_WSS',
      landingRoute: 'HELIOS_DIRECT',
      expectedLandingSlots: 2,
    },
  });
  assert.equal(snapshot.microstructure.buyerCount5m, 15);

  const regimeEngine = new HierarchicalRegimeEngine();
  const regimeVerdict = regimeEngine.evaluate({
    solReturn24hPct: 5.0,
    runnerRatePct: 8.0,
    launchFrequencyPerMin: 12.0,
    medianLiquiditySol: 25.0,
    rpcDropRatePct: 0.1,
    manipulationPrevalencePct: 5.0,
  });
  assert.equal(regimeVerdict.majorRegime, 'RISK_ON');

  const phaseEngine = new PhaseTransitionDetector();
  const phaseReport = phaseEngine.recordMetrics(mint, {
    ActorGrowth: 15,
    FreshCapital: 4.0,
    EconomicVolume: 5.0,
    Liquidity: 32.5,
  }, now, Number(slot));
  assert.equal(phaseReport.mint, mint);

  const specialistPredictions = [
    {
      specialistId: 'spec_wiring_alpha',
      version: '1.0.0',
      role: 'ALPHA',
      target: mint,
      horizonSec: 30,
      pointEstimate: 0.08,
      quantiles: { p10: 0.02, p25: 0.05, p50: 0.08, p75: 0.11, p90: 0.15 },
      probabilityMass: 0.85,
      evidenceDegree: 0.9,
      latencyBudgetMs: 50,
      predictedAtMs: now,
    },
  ];

  const aggregator = new SignalFamilyAggregator();
  const aggResult = aggregator.aggregate(specialistPredictions);
  assert.ok(aggResult.roleAverages.ALPHA > 0);

  const orthogonalAlpha = computeOrthogonalizedAlpha(
    [0.08, 0.04, 0.05, 0.06, 0.02],
    [150, 75, 80, 90, 40],
    [30, 15, 20, 25, 10],
    [0.02, 0.01, 0.01, 0.01, 0.01]
  );
  assert.ok(orthogonalAlpha.residualAlphaBps > 0);
});

test('SMOKE 4: isolated orchestrator output is denied by an observe-only capital kernel', () => {
  const mint = 'MintWiring111111111111111111111111111111111111';
  const slot = 320000000n;
  const now = Date.now();

  const capitalOrchestrator = new CapitalOrchestratorX();
  const actionIntent = capitalOrchestrator.computeNextIntent({
    currentSlot: slot,
    unknownSettlementCount: 0,
    survivalDeficitUsd: 0,
    emergencyExitReserveLamports: 10_000_000n,
    availableCashLamports: 5_000_000_000n,
    candidateProofRoot: 'root_proof_wire_4',
    clearedBids: [
      {
        bidId: 'bid_wire_4',
        strategyId: 'strat_wire_4',
        mint,
        resourceDemands: {
          CAPITAL: 500,
          EXIT_CAPACITY: 200,
          TAIL_RISK_CAPACITY: 50,
          CONCENTRATION_CAPACITY: 100,
          EXECUTION_BANDWIDTH: 1,
          FEE_BUDGET: 5,
          UNKNOWN_SETTLEMENT_CAPACITY: 0,
          ATTENTION_COMPUTE: 10,
        },
        expectedSurplusUsd: 12.0,
        certaintyEquivalentReturnBps: 110,
        proofArtifactRoot: 'root_proof_wire_4',
        validUntilSlot: slot + 50n,
        submittedAtMs: now,
      },
    ],
  });
  assert.equal(actionIntent.action, 'OPEN');

  // Risk Check
  const canaryController = new CanaryInvariantController();
  const riskCheck = canaryController.canAuthorizeNewExposure(mint);
  assert.equal(riskCheck.allowed, true);

  // Capital Kernel Authority (fail-closed check)
  const capitalKernel = new CapitalKernel({ initialAuthority: 'A0_OBSERVE_ONLY' });
  const authorityDecision = capitalKernel.verifyCapitalAction({
    action_type: 'INCREASE_EXPOSURE',
    proposed_delta_sol: actionIntent.allocationSol,
    confirmed_cash_sol: 10,
    reserved_cash_sol: 0,
    emergency_reserve_sol: 2,
    current_open_positions_count: 0,
    unresolved_intents_count: 0,
    unknown_capital_sol: 0,
    has_active_reservation: true,
    has_commit_certificate: true,
    has_valid_survival_certificate: true,
    request_control_epoch: 1,
    active_control_epoch: 1,
    request_revocation_epoch: 1,
    active_revocation_epoch: 1,
    is_proof_revoked: false,
    is_lease_valid: true,
  });
  // Must fail closed under A0_OBSERVE_ONLY
  assert.equal(authorityDecision.is_authorized, false);
});

test('SMOKE 5: accounting, conservation and maturity modules accept a paper fixture', () => {
  const tradeId = 'trade_wire_5';
  const mint = 'MintWiring111111111111111111111111111111111111';
  const entryCost = 100_000_000n;
  const exitProceeds = 115_000_000n;
  const networkFees = 5_000n;
  const priorityFees = 10_000n;
  const tokensTraded = 1_000_000_000n;
  const expectedPnl = 14_985_000n; // 115M - 100M - 15K

  // 1. Accounting & Double Entry
  const accounting = compileTradeAccounting({
    actualEntryCostLamports: entryCost,
    actualExitProceedsLamports: exitProceeds,
    networkFeesLamports: networkFees,
    priorityFeesLamports: priorityFees,
    jitoTipsLamports: 0n,
    routeFeesLamports: 0n,
  });
  assert.equal(accounting.isAccountingBalanced, true);
  assert.equal(accounting.realizedNetPnLLamports, expectedPnl);

  const doubleEntry = new DoubleEntryJournal();
  doubleEntry.postNetworkFriction(`fric_${tradeId}`, accounting.totalExplicitFeesLamports, 'Wiring test fees');
  const conserved = doubleEntry.checkConservation().conserved;
  assert.equal(conserved, true);

  // 2. Conservation Proof Authority
  const conservation = new ConservationProofAuthority();
  const proof = conservation.certifyConservation(
    `lot_${tradeId}`,
    mint,
    tokensTraded,
    tokensTraded,
    0n,
    entryCost,
    entryCost,
    0n,
    exitProceeds,
    accounting.totalExplicitFeesLamports,
    expectedPnl,
    new Date().toISOString()
  );
  assert.equal(proof.isConserved, true);

  // 3. Outcome Maturity Gate
  const maturityGate = new OutcomeMaturityGate();
  const matureCert = maturityGate.evaluateMaturity({
    tradeId,
    economicFactId: `fact_${tradeId}`,
    accountMode: 'paper',
    settledSlot: 320000000n,
    currentSlot: 320000200n,
    settledAtMs: Date.now() - 120_000,
    currentAtMs: Date.now(),
    minMaturityDelayMs: 60_000,
    minMaturitySlotDelta: 100n,
    mfePct: 35.0,
    maePct: 2.0,
    realizedNetPnLLamports: expectedPnl,
  });
  assert.equal(matureCert.isMature, true);
  assert.equal(matureCert.learningReady, true);

  // 4. Realized Edge Ledger
  const edgeLedger = new RealizedEdgeLedger();
  const edgeEntry = edgeLedger.append({
    economicFactId: `fact_${tradeId}`,
    mint,
    stages: {
      predictedEdgeLamports: 10_000_000n,
      decisionEdgeLamports: 10_000_000n,
      submissionEdgeLamports: 10_000_000n,
      landingEdgeLamports: expectedPnl,
      settlementEdgeLamports: expectedPnl,
      realizedNetEdgeLamports: expectedPnl,
    },
    feesAndTipsLamports: accounting.totalExplicitFeesLamports,
    slippageAndImpactLamports: 0n,
    capitalTimeAndFrictionLamports: 0n,
  });
  assert.ok(edgeEntry.recordId);
});
