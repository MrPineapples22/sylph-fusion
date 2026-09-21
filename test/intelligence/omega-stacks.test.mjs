import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  HamiltonOmegaEngine,
  ZenoOmegaEngine,
  GramianOmegaEngine,
  ManeuverOmegaEngine,
  MarshalOmegaEngine,
  DijkstraOmegaEngine,
  PetriOmegaEngine,
  LamportOmegaEngine,
  ChandraOmegaEngine,
  ShannonOmegaEngine,
  OmegaControlOrchestrator,
} from '../../dist/intelligence/control/omega-control.js';

import {
  KalmanOmegaEngine,
  ParmenidesOmegaEngine,
  SavageOmegaEngine,
  BellmanOmegaEngine,
  BernoulliOmegaEngine,
  SimonOmegaEngine,
  KahnemanOmegaEngine,
  ExpertiseOmegaEngine,
  DiversityOmegaEngine,
  DelphiOmegaEngine,
  ArrowOmegaEngine,
  GodelOmegaEngine,
  OmegaEpistemicOrchestrator,
} from '../../dist/intelligence/epistemic/omega-epistemic.js';

import {
  AristotleOmegaEngine,
  HurwiczOmegaEngine,
  LucasOmegaEngine,
  KydlandOmegaEngine,
  OmegaGovernanceOrchestrator,
} from '../../dist/intelligence/governance/omega-governance.js';

import {
  MetronUnits,
  TheseusIdentity,
  HephaestusSemantics,
} from '../../dist/intelligence/semantics/metron-theseus.js';

import { NexusCanonicalState } from '../../dist/intelligence/nexus/canonical-nexus.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';

describe('Critical Control Stack (Omega-Control)', () => {
  test('HAMILTON-Ω: Computes reachability tube and bounds safe position size', () => {
    const hamilton = new HamiltonOmegaEngine();
    const tube = hamilton.evaluateReachability({
      liquidityUsd: 10000,
      volatilityBps: 200,
      positionSizeSol: 1.5,
      feedLatencyMs: 800,
    });
    assert.equal(tube.viable, true);
    assert.ok(tube.maxSafePositionSol > 0);
    assert.equal(tube.maxSafeSlippageBps, 150);

    // Stale feed must fail reachability
    const staleTube = hamilton.evaluateReachability({
      liquidityUsd: 10000,
      volatilityBps: 200,
      positionSizeSol: 1.5,
      feedLatencyMs: 6000,
    });
    assert.equal(staleTube.viable, false);
  });

  test('ZENO-Ω: Enforces constraint feasibility and detects violations', () => {
    const zeno = new ZenoOmegaEngine();
    const pass = zeno.checkConstraints({
      availableCashSol: 10,
      requestedSizeSol: 2,
      maxConcentrationBps: 2000,
      currentExposureBps: 1000,
      isKillSwitchActive: false,
    });
    assert.equal(pass.feasible, true);
    assert.equal(pass.violatedConstraints.length, 0);

    const fail = zeno.checkConstraints({
      availableCashSol: 1,
      requestedSizeSol: 5,
      maxConcentrationBps: 2000,
      currentExposureBps: 1000,
      isKillSwitchActive: true,
    });
    assert.equal(fail.feasible, false);
    assert.ok(fail.violatedConstraints.includes('KILL_SWITCH_ENGAGED'));
    assert.ok(fail.violatedConstraints.includes('INSUFFICIENT_UNCOMMITTED_CAPITAL'));
  });

  test('GRAMIAN-Ω: Computes controllability rank and contracts authority when degraded', () => {
    const gramian = new GramianOmegaEngine();
    const healthy = gramian.computeGramian({
      rpcReserveHealthy: true,
      signerReserveHealthy: true,
      computeReserveTight: false,
    });
    assert.equal(healthy.controlAuthority, 'STRONG');
    assert.equal(healthy.rank, 3);

    const degraded = gramian.computeGramian({
      rpcReserveHealthy: false,
      signerReserveHealthy: false,
      computeReserveTight: true,
    });
    assert.equal(degraded.controlAuthority, 'EXHAUSTED');
    assert.ok(degraded.rank < 3);
  });

  test('MANEUVER-Ω: Preserves safe non-trapping options', () => {
    const maneuver = new ManeuverOmegaEngine();
    const score = maneuver.assessManeuverability({
      independentExitRoutesCount: 3,
      isRouteCongested: false,
      stressedExitCoveragePct: 85,
    });
    assert.equal(score.isManeuverable, true);
    assert.equal(score.preservedSafeOptionsCount, 3);
    assert.ok(score.trappedProbability < 0.5);
  });

  test('MARSHAL-Ω: Schedules corrective resources and evaluates corrective mode', () => {
    const marshal = new MarshalOmegaEngine();
    const sched = marshal.scheduleResources('EMERGENCY');
    assert.equal(sched.allocatedPriority, 'EMERGENCY');
    assert.equal(sched.computeBudgetUnits, 400_000);

    assert.equal(marshal.getCorrectiveMode(0.8, 0), 'NORMAL');
    assert.equal(marshal.getCorrectiveMode(2.5, 0), 'STRESSED');
    assert.equal(marshal.getCorrectiveMode(4.0, 0), 'CRITICAL');
    assert.equal(marshal.getCorrectiveMode(6.5, 0), 'SURVIVAL');
    assert.equal(marshal.getCorrectiveMode(12.0, 6), 'RECOVERY');
  });

  test('DIJKSTRA-Ω & PETRI-Ω: Verifies concurrency progress and transition interleavings', () => {
    const dijkstra = new DijkstraOmegaEngine();
    const progress = dijkstra.auditProgress(true, true);
    assert.equal(progress.deadlock, 'NONE');
    assert.equal(progress.livelock, 'NONE');
    assert.equal(progress.economicProgressVerified, true);

    const petri = new PetriOmegaEngine();
    assert.equal(petri.verifyInterleaving('AUTH', 'INTENT'), true);
    assert.equal(petri.verifyInterleaving('SIGN', 'AUTH'), true);
    assert.equal(petri.verifyInterleaving('EXECUTE', 'SIGN'), true);
    assert.equal(petri.verifyInterleaving('RECONCILE', 'EXECUTE'), true);
    assert.equal(petri.verifyInterleaving('EXECUTE', 'INTENT'), false); // Illegal bypass
  });

  test('LAMPORT-Ω & CHANDRA-Ω: Fences stale writers and monitors distributed convergence', () => {
    const lamport = new LamportOmegaEngine();
    const epoch = lamport.getAuthorityEpoch();
    assert.ok(epoch >= 800);
    assert.equal(lamport.fenceWriter(epoch), true);
    assert.equal(lamport.fenceWriter(epoch - 1), false); // Stale writer fenced!
    assert.equal(lamport.getFencedCount(), 1);

    const chandra = new ChandraOmegaEngine();
    const dist = chandra.evaluateConvergence(epoch, 1);
    assert.equal(dist.economicConvergence, 'VERIFIED');
    assert.equal(dist.causalGaps, 'NONE');
  });

  test('SHANNON-Ω: Information Sufficiency fail-closed rule', () => {
    const shannon = new ShannonOmegaEngine();
    // Fresh feed: entries allowed
    const fresh = shannon.evaluateSufficiency({
      feedAgeSec: 0.8,
      slotLag: 1,
      hasExecutionDiscrepancy: false,
      isCapitalVerified: true,
      isPositionReconciled: true,
    });
    assert.equal(fresh.capabilities.enter, 'ALLOWED');
    assert.equal(fresh.capabilities.exit, 'AVAILABLE');

    // Stale feed (> 1.5s): entries strictly blocked, but protective exits preserved!
    const degraded = shannon.evaluateSufficiency({
      feedAgeSec: 3.5,
      slotLag: 1,
      hasExecutionDiscrepancy: false,
      isCapitalVerified: true,
      isPositionReconciled: true,
    });
    assert.equal(degraded.capabilities.enter, 'BLOCKED');
    assert.equal(degraded.capabilities.exit, 'AVAILABLE');
    assert.equal(degraded.capabilities.reduce, 'AVAILABLE');
  });
});

describe('Epistemic & Adaptive Stacks (Omega-Epistemic)', () => {
  test('KALMAN-Ω: Evaluates model dynamics and detects residual drift', () => {
    const kalman = new KalmanOmegaEngine();
    const valid = kalman.evaluateModelDynamics({
      marketPredictionErrorBps: 30,
      liquiditySlippageResidualBps: 20,
      executionFillLatencyMs: 250,
    });
    assert.equal(valid.marketDynamics, 'VALID');

    const drifting = kalman.evaluateModelDynamics({
      marketPredictionErrorBps: 180,
      liquiditySlippageResidualBps: 90,
      executionFillLatencyMs: 1200,
    });
    assert.equal(drifting.marketDynamics, 'DEGRADED');
    assert.equal(drifting.liquidityDynamics, 'DEGRADED');
    assert.equal(drifting.affectedCapability, 'LARGE ENTRY');
  });

  test('PARMENIDES-Ω: Contradiction preservation', () => {
    const parmenides = new ParmenidesOmegaEngine();
    const report = parmenides.checkContradictions([
      { claim: 'ORGANIC_EXPANSION', confidence: 0.8 },
      { claim: 'SYBIL_CONCENTRATION', confidence: 0.85 },
    ]);
    assert.equal(report.hasContradictions, true);
    assert.ok(report.activeContradictions.includes('ORGANIC_FLOW_VS_SYBIL_CONCENTRATION'));
  });

  test('KAHNEMAN-Ω: Routes FAST vs SLOW reasoning lanes', () => {
    const kahneman = new KahnemanOmegaEngine();
    const fast = kahneman.routeReasoning({
      isNovelRegime: false,
      isLargePosition: false,
      feedHealthy: true,
      evidenceContradiction: false,
    });
    assert.equal(fast, 'FAST');

    const slow = kahneman.routeReasoning({
      isNovelRegime: true,
      isLargePosition: false,
      feedHealthy: true,
      evidenceContradiction: false,
    });
    assert.equal(slow, 'SLOW');

    const escalating = kahneman.routeReasoning({
      isNovelRegime: false,
      isLargePosition: false,
      feedHealthy: false, // Unhealthy feed escalates
      evidenceContradiction: false,
    });
    assert.equal(escalating, 'ESCALATING');
  });

  test('GÖDEL: Emits UNKNOWN on ontology gap rather than guessing', () => {
    const godel = new GodelOmegaEngine();
    assert.equal(godel.testOntology({ liquidity: 5000, mcap: 25000 }).evaluation, 'KNOWN');
    assert.equal(godel.testOntology({ liquidity: undefined, mcap: 25000 }).evaluation, 'UNKNOWN');
    assert.equal(godel.testOntology({ liquidity: NaN, mcap: 25000 }).evaluation, 'UNKNOWN');
  });
});

describe('Governance & Reflexivity Stack (Omega-Governance)', () => {
  test('HURWICZ-Ω: Detects metric gaming surfaces and issues certificate', () => {
    const hurwicz = new HurwiczOmegaEngine();
    const clean = hurwicz.auditMechanism({
      fillRate: 0.9,
      realizedAlphaBps: 50,
      candidateRecall: 0.85,
      downstreamWorkload: 100,
    });
    assert.equal(clean.auditPassed, true);
    assert.equal(clean.gamingSurfacesIdentified, 0);

    const gamed = hurwicz.auditMechanism({
      fillRate: 0.99,
      realizedAlphaBps: -40, // High fill rate with negative alpha indicates fill-rate gaming!
      candidateRecall: 0.85,
      downstreamWorkload: 100,
    });
    assert.equal(gamed.auditPassed, false);
    assert.ok(gamed.gamingSurfacesIdentified > 0);
  });

  test('LUCAS-Ω: Tracks policy epochs and models distribution shifts', () => {
    const lucas = new LucasOmegaEngine();
    const initialEpoch = lucas.getPolicyEpoch();
    assert.equal(initialEpoch, 'P42');
    const cert = lucas.evaluatePolicyShift(true);
    assert.equal(cert.responseShiftDetected, true);
    assert.equal(cert.performativeRisk, 'MODERATE');

    const nextEpoch = lucas.incrementPolicyEpoch();
    assert.equal(nextEpoch, 'P43');
  });

  test('KYDLAND-Ω: Enforces dynamic time consistency for sequential commitments', () => {
    const kydland = new KydlandOmegaEngine();
    const cert = kydland.verifyTimeConsistency();
    assert.equal(cert.timeConsistencyVerified, true);
    assert.equal(cert.activeCommitmentsCount, 7);
    assert.ok(cert.committedReserveSol > 0);
  });
});

describe('Semantics & Canonical Nexus', () => {
  test('METRON: Typed numeric safety contracts', () => {
    assert.equal(MetronUnits.lamportsToSol(1_000_000_000n), 1.0);
    assert.equal(MetronUnits.solToLamports(2.5), 2_500_000_000n);
    assert.equal(MetronUnits.bpsToFraction(150), 0.015);
    assert.equal(MetronUnits.fractionToBps(0.015), 150);

    assert.throws(() => MetronUnits.assertValidNumber(NaN, 'test'), /METRON_NUMERIC_SAFETY/);
    assert.throws(() => MetronUnits.assertValidNumber(Infinity, 'test'), /METRON_NUMERIC_SAFETY/);
  });

  test('THESEUS: Mint address dominance', () => {
    const mint = 'So11111111111111111111111111111111111111112';
    const dominance = TheseusIdentity.verifyMintDominance(mint, 'SOL');
    assert.equal(dominance.isDominant, true);
    assert.equal(dominance.canonicalKey, `MINT:${mint}`);
  });

  test('HEPHAESTUS: Program semantics and Token-2022 restrictions', () => {
    const spl = HephaestusSemantics.inspectProgramSemantics('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    assert.equal(spl.isStandardSpl, true);
    assert.equal(spl.isExecutionPermitted, true);

    const token2022WithFee = HephaestusSemantics.inspectProgramSemantics(
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      ['TransferFeeConfig']
    );
    assert.equal(token2022WithFee.isToken2022, true);
    assert.equal(token2022WithFee.hasTransferFee, true);
    assert.equal(token2022WithFee.isExecutionPermitted, false); // Blocked from autonomous execution
  });

  test('NEXUS: Canonical World State Pipeline and Knowledge Frontier', () => {
    const nexus = new NexusCanonicalState();
    const raw = nexus.ingestRawObservation('PumpPortal', { price: 0.0001, liquidity: 5000 });
    assert.ok(raw.observationId.startsWith('raw_'));

    const evidence = nexus.verifyEvidence(raw);
    assert.equal(evidence.isTrusted, true);

    const mint = 'So11111111111111111111111111111111111111112';
    const domainEvent = nexus.commitDomainEvent(evidence, 'PRICE_UPDATE', mint, {
      liquidityUsd: 6500,
      marketCapUsd: 30000,
    });
    assert.equal(domainEvent.mint, mint);

    const record = nexus.getTokenRecord(mint);
    assert.ok(record);
    assert.equal(record.liquidityUsd, 6500);

    const frontier = nexus.getKnowledgeFrontier();
    assert.ok(frontier.domainEventsCount >= 1);
  });
});

describe('Master Orchestrator Integration & System Omega State', () => {
  test('MasterIntelligenceEngine: Exposes the complete 10-section operational telemetry', () => {
    const master = new MasterIntelligenceEngine();
    const omegaState = master.getSystemOmegaState();

    // Verify all 10 sections requested in Sections 19-28 are present and populated
    assert.ok(omegaState.systemHealth, 'Section 19: systemHealth');
    assert.equal(omegaState.systemHealth.safeCore, 'READY');

    assert.ok(omegaState.marketTruth, 'Section 20: marketTruth');
    assert.ok(omegaState.informationSufficiency, 'Section 21: informationSufficiency');
    assert.equal(omegaState.informationSufficiency.capabilities.enter, 'ALLOWED');
    assert.equal(omegaState.informationSufficiency.capabilities.exit, 'AVAILABLE');

    assert.ok(omegaState.reasoning, 'Section 22: reasoning');
    assert.ok(omegaState.modelDynamics, 'Section 23: modelDynamics');
    assert.ok(omegaState.controlAuthority, 'Section 24: controlAuthority');
    assert.ok(omegaState.systemProgress, 'Section 25: systemProgress');
    assert.ok(omegaState.distributedState, 'Section 26: distributedState');
    assert.ok(omegaState.policyHealth, 'Section 27: policyHealth');
    assert.ok(omegaState.auditStatus, 'Section 28: auditStatus');
  });

  test('Degraded market feed contracts entry authority and switches operational mode', () => {
    const master = new MasterIntelligenceEngine();
    const degradedState = master.getSystemOmegaState({ feedAgeSec: 6.0, slotLag: 3 });

    assert.equal(degradedState.systemHealth.marketFeed, 'STALE');
    assert.equal(degradedState.systemHealth.currentMode, 'PROTECTIVE');
    assert.equal(degradedState.marketTruth.entryInformation, 'BLOCKED');
    assert.equal(degradedState.informationSufficiency.capabilities.enter, 'BLOCKED');
    assert.equal(degradedState.informationSufficiency.capabilities.exit, 'AVAILABLE'); // Exits remain available
  });
});
