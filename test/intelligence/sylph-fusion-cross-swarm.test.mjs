import { test } from 'node:test';
import assert from 'node:assert/strict';

// Sol Agent 1: Solana Data / Truth Engine
import {
  TxV1TruthEngine,
  EconomicDeltaEngine,
  TruthClassificationValidator,
} from '../../dist/platform/ingestion/truth-x.js';

// Sol Agent 2: Market Microstructure Engineer
import {
  AuthenticDemandEngine,
  SellHazardEngine,
  MevContaminationEngine,
} from '../../dist/intelligence/microstructure/microstructure-x.js';

// Sol Agent 3: Execution Engineer
import {
  LockGraphEngine,
  AllInBreakevenEngine,
  AlphaTtlEngine,
  GenerationFencedRetryEngine,
} from '../../dist/platform/execution/execution-x.js';

// Sol Agent 4: Risk / Capital / Portfolio Engineer
import {
  OptimalExecutableSizeEngine,
} from '../../dist/platform/risk/capital-risk-x.js';

// Sol Agent 5: ML / MULTIPLIER-X Engineer & NEXUS-MX
import {
  TailLatticeEngine,
  MultiStateRunnerEngine,
} from '../../dist/intelligence/science/multiplier-x.js';

import {
  computeLineageDigest,
  createJournalEnvelope,
  computeCapitalBackedMultiplier,
  ManipulationFirewall,
  LiquidityRealityEngine,
  RealizedEVEngine,
  MultiplierCertificateAuthority,
} from '../../dist/intelligence/science/nexus-mx.js';

// Sol Agent 6: Testing / Certification / Observability Engineer
import {
  AlphaCourtEngine,
  ProductionCertificationAuthority,
} from '../../dist/intelligence/science/alpha-court-x.js';

// Astra: Architecture, Signing Firewall & Formal Invariants
import {
  TokenCapabilityFirewallX,
  ProgramIdentityFirewallX,
} from '../../dist/platform/security/trade-certificate-x.js';

test('SYLPH FUSION Cross-Swarm Integration: Sol Agents 1-6 & Astra Orchestration Loop', () => {
  const mint = 'SwarmRunnerToken11111111111111111111111111';
  const pool = 'PoolSwarm11111111111111111111111111111111111';
  const currentSlot = 320000;
  const nowMs = 1715000000000;

  // -------------------------------------------------------------------------
  // SOL AGENT 1: Solana Data / Truth Verification (TXV1, Deltas, Truth Classes)
  // -------------------------------------------------------------------------
  const decodedTx = TxV1TruthEngine.decodeTransaction({
    signature: '5K...dummySig',
    version: 'legacy',
    slot: currentSlot,
    rawMessageBytes: new Uint8Array([10, 20, 30, 40]),
    meta: { err: null, fee: 5000n },
    accountKeys: [mint, pool, 'Wallet1111111111111111111111111111111111111'],
    compiledInstructions: [{ programIdIndex: 1, accountIndices: [0, 2], data: new Uint8Array([1, 2, 3]) }],
  });
  assert.equal(decodedTx.version, 'LEGACY');
  assert.equal(decodedTx.accounts.length, 3);

  const deltaSummary = EconomicDeltaEngine.calculateDeltas({
    signature: '5K...dummySig',
    slot: currentSlot,
    feeLamports: 10_000n,
    priorityFeeLamports: 5_000n,
    preBalances: [
      { account: pool, lamports: 50_000_000_000n },
      { account: mint, lamports: 1_000_000_000n },
    ],
    postBalances: [
      { account: pool, lamports: 55_000_000_000n },
      { account: mint, lamports: 900_000_000n },
    ],
    preTokenBalances: [],
    postTokenBalances: [],
  });
  assert.equal(deltaSummary.lamportDeltas.find(d => d.account === pool)?.delta, 5_000_000_000n);

  const chainTruthObj = {
    truthClass: 'CHAIN_TRUTH',
    payload: { slot: currentSlot },
    slot: currentSlot,
    timestampMs: nowMs,
    providerId: 'helios_rpc',
    hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  };
  assert.ok(TruthClassificationValidator.isChainTruth(chainTruthObj));

  // -------------------------------------------------------------------------
  // SOL AGENT 2: Market Microstructure (Authentic Demand, Metaorders, MEV)
  // -------------------------------------------------------------------------
  const cleanBuyers = [
    { wallet: 'c1', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'c2', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.5 },
    { wallet: 'c3', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 2.0 },
    { wallet: 'c4', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.2 },
    { wallet: 'c5', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.8 },
    { wallet: 'c6', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 2.5 },
  ];
  const demand = AuthenticDemandEngine.evaluateDemand(mint, 25, cleanBuyers, []);
  assert.equal(demand.meetsAntiSniperBaseline, true);
  assert.equal(demand.passesUniqueBuyerCheck, true);
  assert.equal(demand.effectiveBuyerCount, 6);

  const trades = [
    { solAmount: 45, isMev: false },
    { solAmount: 50, isMev: false },
    { solAmount: 5, isMev: true },
  ];
  const mev = MevContaminationEngine.evaluateContamination(trades, mint);
  assert.equal(mev.isContaminated, false);
  assert.ok(mev.organicPriceDiscoveryRatio > 0.90);

  const holders = [
    { wallet: 'h1', balanceTokens: 10_000n, costBasisUsd: 0.0001, isDevOrCabal: false, acquisitionTimeMs: nowMs - 10000 },
  ];
  const sellHazard = SellHazardEngine.evaluateSellHazard(mint, 0.0002, holders, 'dev_wallet');
  assert.ok(sellHazard.devDumpHazard < 0.10);

  // -------------------------------------------------------------------------
  // SOL AGENT 3: Execution Contention & Alpha TTL (LockGraph, Breakeven, Fenced Retries)
  // -------------------------------------------------------------------------
  const lockGraph = new LockGraphEngine();
  const lockResult = lockGraph.acquireLocks('intent_swarm_001', {
    readAccounts: [mint],
    writableAccounts: [pool],
  });
  assert.equal(lockResult.hasConflict, false);

  const breakevenHurdle = AllInBreakevenEngine.calculateHurdle({
    notionalSol: 0.5,
    needsAtaCreation: true,
    ataCreationLamports: 2_039_000n,
    ataRentRecoveryAssumption: 'RECOVER_ON_CLOSE',
    baseFeeLamports: 5_000n,
    computeUnitLimit: 200_000,
    priorityFeeMicroLamports: 10_000n,
    jitoTipLamports: 10_000n,
    lpFeeBps: 100,
    expectedSlippageBps: 150,
  });
  assert.ok(breakevenHurdle.modeledHurdlePercentage > 0);
  assert.equal(breakevenHurdle.passesIllustrative15PctHurdle, true);

  const alphaTtl = AlphaTtlEngine.evaluateTtl({
    intentId: 'intent_swarm_001',
    elapsedSeconds: 2,
    blockhashTtlSeconds: 60,
    quoteTtlSeconds: 15,
    alphaTtlSeconds: 20,
    riskTtlSeconds: 30,
    capabilityTtlSeconds: 300,
    grossAlphaEv: 0.15,
    feeCostSol: 0.005,
  });
  assert.equal(alphaTtl.effectiveTtlSeconds, 15);
  assert.equal(alphaTtl.isExpired, false);

  const retryFencer = new GenerationFencedRetryEngine();
  const gen1 = retryFencer.createInitialGeneration('intent_swarm_001', 'tx_hash_001');
  assert.equal(gen1.activeGeneration, 1);
  assert.equal(retryFencer.validateGeneration('intent_swarm_001', 1), true);
  assert.equal(retryFencer.validateGeneration('intent_swarm_001', 2), false);

  // -------------------------------------------------------------------------
  // SOL AGENT 4: Risk & Capital Allocation (Optimal Sizing & Hurdle)
  // -------------------------------------------------------------------------
  const sizeSizing = OptimalExecutableSizeEngine.calculateSize({
    availableCapitalSol: 10,
    poolReserveSol: 30,
    halfKellyFraction: 0.10,
    expectedNetReturnPct: 25,
    frictionSol: 0.01,
  });
  assert.ok(sizeSizing.suggestedResearchSizeSol > 0);
  assert.equal(sizeSizing.isApproved, false);
  assert.equal(sizeSizing.authority, 'RESEARCH_ONLY');

  // -------------------------------------------------------------------------
  // SOL AGENT 5: ML / MULTIPLIER-X Gen-2 & NEXUS-MX
  // -------------------------------------------------------------------------
  const lineage = {
    tokenEpisodeId: 'ep_swarm_001',
    eventJournalOffset: 500,
    canonicalSnapshotId: 'snap_swarm_500',
    featureSnapshotId: 'feat_swarm_500',
    modelGeneration: 'gen2_v1',
    configurationEpoch: 1,
    riskEpoch: 1,
    executionGeneration: gen1.activeGeneration,
  };
  const lineageDigest = computeLineageDigest(lineage);
  assert.equal(lineageDigest.length, 64);

  const envelope = createJournalEnvelope('solana_wss', '2.0', { mint, slot: currentSlot }, { slot: currentSlot, mint });
  assert.ok(envelope.journalId.startsWith('jnl_'));

  const cbm = computeCapitalBackedMultiplier(0.0001, 25.0, 30.0, 0.00018);
  assert.ok(cbm.capitalBackedMultiple >= 1.5);

  const lattice = TailLatticeEngine.enforceLatticeMonotonicity({
    p2x: 0.85,
    p5x: 0.55,
    p10x: 0.30,
    p20x: 0.12,
    p50x: 0.04,
    p100x: 0.015,
    pCapturable2x: 0.80,
    pCapturable10x: 0.25,
    pCapturable100x: 0.010,
  });
  assert.ok(lattice.p100x <= lattice.p50x);
  assert.ok(lattice.p50x <= lattice.p20x);
  assert.ok(lattice.p20x <= lattice.p10x);
  assert.ok(lattice.p10x <= lattice.p5x);
  assert.ok(lattice.p5x <= lattice.p2x);
  assert.ok(lattice.pCapturable100x <= lattice.p100x);

  const runnerState = MultiStateRunnerEngine.evaluateRunner({
    currentMultiplier: 5.5,
    effectiveBuyers: 15,
    sellHazard: 0.2,
    liquidityDepthSol: 50,
    mfePct: 450,
    maePct: -12,
  });
  assert.equal(runnerState.currentState, 'S2_5X');
  assert.ok(runnerState.netExecutableEv > 0); assert.equal(runnerState.authority, 'RESEARCH_ONLY');

  const exitCurve = LiquidityRealityEngine.computeRealizableExitCurve(5.0, 65_000, 2);
  assert.ok(exitCurve.realizableMultipleAt100Usd > exitCurve.realizableMultipleAt1000Usd);

  const multipliers = {
    p2x: lattice.p2x, p3x: 0.65, p5x: lattice.p5x, p10x: lattice.p10x,
    p20x: lattice.p20x, p50x: lattice.p50x, p100x: lattice.p100x,
    expectedTimeToTouchSec: { touch2x: 35, touch5x: 120, touch10x: 350 },
  };
  const risks = {
    collapseHazardRate: 0.08, rugHazardRate: 0.01, liquidityDrainHazardRate: 0.02,
    manipulationHazardRate: 0.03, migrationStallHazardRate: 0.02, compositeFailureHazard: 0.14,
  };
  const capturability = {
    totalLatencyBudgetMs: 280, expectedSlippageBps: 110, expectedPriceImpactBps: 75,
    jitoTipEfficiency: 0.95, pFill: 0.97, pExit: 0.96, capturableUpsideRatio: 0.88,
  };
  const ev = RealizedEVEngine.calculateEV(multipliers, risks, capturability);
  assert.equal(ev.isViable, true);
  assert.ok(ev.expectedValueSolPerSol > 0.20);

  const cert = MultiplierCertificateAuthority.issueCertificate(
    lineage,
    mint,
    { grossBuySol: 85, grossSellSol: 15, organicBuySol: 80, organicSellSol: 10, organicNetSol: 70, newCapitalSol: 60, recycledCapitalSol: 10, freshCapitalRatio: 0.85, creatorFundedRatio: 0.0, capitalVelocity: 1.8, capitalAcceleration: 0.3, capitalPersistence: 0.94 },
    { washProbability: 0.04, atomicSelfCancelProbability: 0.01, bundlerProbability: 0.05, txPaddingProbability: 0.02, lpiProbability: 0.03, coordinatedDumpProbability: 0.04, creatorSybilProbability: 0.01, fundingClusterProbability: 0.02, volumeAuthenticity: 0.96, participationAuthenticity: 0.94, manipulationConfidence: 0.96 },
    exitCurve,
    multipliers,
    risks,
    { epistemicUncertainty: 0.07, aleatoricUncertainty: 0.08, dataQualityUncertainty: 0.02, totalUncertaintyMargin: 0.10 },
    capturability,
    { evidenceQuality: 96, capitalBackedMomentum: 90, executableLiquidity: 92, entityAdjustedParticipation: 89, controllerAdjustedWalletQuality: 94, competingFailureHazard: 14, realizableExecutionQuality: 91, marketRegimeScore: 88, compositeScore: 91 }
  );
  assert.equal(cert.decision, 'ENTER_ELIGIBLE');

  // -------------------------------------------------------------------------
  // SOL AGENT 6: Alpha Court Pre-Registration & Gate Evaluation
  // -------------------------------------------------------------------------
  const court = new AlphaCourtEngine();
  court.preRegisterHypothesis({
    trialId: 'trial_swarm_001',
    hypothesis: 'Organic fresh capital acceleration > 0.25 with effective buyers >= 5 predicts clean 5x first-passage',
    featureName: 'OrganicFreshCapitalAccel_60s',
    targetBarrier: '5X',
    targetHorizon: '1h',
  });

  const courtVerdict = court.adjudicateFeature({
    trialId: 'trial_swarm_001',
    walkForwardIc: 0.045,
    entityHoldoutIc: 0.028,
    regimeRobustnessScore: 0.82,
    netExecutableEvSol: 0.08,
    latencySurvivalRatio: 0.72,
    ablationDeltaBrierScore: 0.008,
  });
  assert.equal(courtVerdict.allCourtsPassed, true);
  assert.equal(courtVerdict.promotionVerdict, 'SURVIVED_RESEARCH_COURTS');

  const releaseGates = ProductionCertificationAuthority.evaluateAllGates({
    transactionCompletenessPassed: true,
    versionCompatibilityPassed: true,
    parserAgreementPassed: true,
    providerQuorumPassed: true,
    pointInTimeCorrectnessPassed: true,
    calibrationSharpnessPassed: true,
    deterministicIntentsPassed: true,
    retrySafetyPassed: true,
    isolatedSigningPassed: true,
    reservationCorrectnessPassed: true,
    restartSafetyPassed: true,
    realizedNetPnlProofPassed: true,
  });
  assert.equal(releaseGates.allGatesPassed, true);
  assert.equal(releaseGates.liveCapitalAuthorization, 'BLOCKED_FAIL_CLOSED');

  // -------------------------------------------------------------------------
  // ASTRA: Security Boundaries & Token Capabilities (Token-2022, Programs, Signing)
  // -------------------------------------------------------------------------
  const capabilityEpoch = TokenCapabilityFirewallX.certifyCapabilityEpoch(mint, 1, {
    freezeAuthority: null,
    mintAuthority: null,
    permanentDelegate: null,
    transferFeeBps: 0,
    isPaused: false,
  });
  assert.equal(capabilityEpoch.isFreezeAuthorityRevoked, true);
  assert.equal(capabilityEpoch.isMintAuthorityRevoked, true);
  assert.equal(capabilityEpoch.isPermanentDelegateRevoked, true);
  assert.equal(capabilityEpoch.hash.length, 64);

  const programFirewall = new ProgramIdentityFirewallX();
  const programRecord = {
    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun
    executableHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    codeEpoch: 1,
    isCertified: true,
  };
  programFirewall.certifyProgram(programRecord);
  assert.ok(programFirewall.isProgramEpochCertified(programRecord.programId, programRecord.executableHash, 1));

  const exitProof = TokenCapabilityFirewallX.generateExitabilityProof(mint, 65.0, sizeSizing.suggestedResearchSizeSol);
  assert.equal(exitProof.isExitable, true);
  assert.ok(exitProof.maxExitImpactBps <= 500);

  // Invariant 27 / Section 45: AI models and derived intelligence cannot sign or approve capital
  assert.equal(cert.decision, 'ENTER_ELIGIBLE');
  assert.equal(courtVerdict.authority, 'RESEARCH_ONLY');
  assert.equal(courtVerdict.isProductionApproved, false);
});
