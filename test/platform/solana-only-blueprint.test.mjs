/**
 * SYLPH FUSION — SOLANA-ONLY INTEGRATION BLUEPRINT TEST SUITE
 * Complete test suite verifying the 45-section Solana-Only Integration Architecture.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSolanaMarketIR,
  validateSolanaMarketIR,
  hashSolanaMarketIR,
  LocalMarketUniverse,
  ProtocolCompatibilityRegistry,
  createProtocolLease,
  ProtocolMutationTester,
  SolanaSensorTournament,
  SolanaTransportTournament,
  SolanaArbitrageGraph,
  SolanaMarketMakingEngine,
  SolanaCapacityEngine,
  SolanaStrategyEcology,
  SolanaPlannerVoi,
  SolanaMarketTwinResidualAuditor,
  BasisPointEngineeringLedger,
  SolanaAlphaFactory,
} from '../../dist/platform/solana/index.js';

import {
  ResearchTruthFirewall,
} from '../../dist/intelligence/research/research-truth-firewall.js';

describe('SYLPH FUSION — Solana-Only Integration Blueprint', () => {

  test('Section 1: SolanaMarketIR normalizes market state and validates safety invariants', () => {
    const validIR = createSolanaMarketIR({
      mint: 'So11111111111111111111111111111111111111112',
      tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      token2022Extensions: [],
      programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
      poolId: 'pool_raydium_sol_usdc_001',
      poolType: 'RAYDIUM_AMM',
      baseAsset: 'SOL',
      quoteAsset: 'USDC',
      reserves: {
        base: 50_000_000_000_000n, // 50,000 SOL
        quote: 7_500_000_000_000n, // 7.5M USDC
      },
      liquidityLamports: 50_000_000_000_000n,
      priceSol: 1.0,
      priceUsd: 150.0,
      feeModel: { baseFeeBps: 25, creatorFeeBps: 0, dynamicFeeBps: 0 },
      transferFees: { feeBps: 0, maxFeeLamports: 0n },
      creatorFees: { creatorBps: 0, recipient: '11111111111111111111111111111111' },
      mintAuthority: null,
      freezeAuthority: null,
      delegates: [],
      creator: 'creator_sol_genesis',
      funder: 'funder_sol_prime',
      holders: { count: 1250, top10ConcentrationBps: 1850 },
      walletClusters: ['cluster_organic_retail'],
      slot: 280_000_000n,
      blockHeight: 250_000_000n,
      observedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      availableAt: new Date().toISOString(),
      knownAt: new Date().toISOString(),
      source: 'GEYSER_SHRED_RECONCILED',
      freshnessMs: 45,
    });

    assert.equal(validIR.irVersion, '1.0.0');
    assert.equal(validIR.poolType, 'RAYDIUM_AMM');
    assert.ok(validIR.evidenceRoot.length > 20);

    const validation = validateSolanaMarketIR(validIR);
    assert.equal(validation.valid, true);
    assert.equal(validation.violations.length, 0);

    // Fail-closed invariant: active freeze authority is rejected
    const honeypotIR = createSolanaMarketIR({
      ...validIR,
      freezeAuthority: 'attacker_freeze_admin',
    });
    const honeypotVal = validateSolanaMarketIR(honeypotIR);
    assert.equal(honeypotVal.valid, false);
    assert.ok(honeypotVal.violations.some(v => v.includes('freeze authority')));

    // Fail-closed invariant: dangerous concentration (> 80%) is rejected
    const concentratedIR = createSolanaMarketIR({
      ...validIR,
      holders: { count: 10, top10ConcentrationBps: 8500 },
    });
    const concVal = validateSolanaMarketIR(concentratedIR);
    assert.equal(concVal.valid, false);
    assert.ok(concVal.violations.some(v => v.includes('holder concentration')));
  });

  test('Section 2: LocalMarketUniverse eliminates hot-path remote I/O and provides point-in-time snapshots', () => {
    const universe = new LocalMarketUniverse();
    const mintA = 'TokenMintA1111111111111111111111111111111111';

    const snap1 = createSolanaMarketIR({
      mint: mintA,
      tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      token2022Extensions: [],
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      poolId: 'pump_curve_001',
      poolType: 'PUMP_FUN',
      baseAsset: 'TOKEN_A',
      quoteAsset: 'SOL',
      reserves: { base: 100_000_000n, quote: 30_000_000_000n },
      liquidityLamports: 30_000_000_000n,
      priceSol: 0.0003,
      priceUsd: 0.045,
      feeModel: { baseFeeBps: 100, creatorFeeBps: 0, dynamicFeeBps: 0 },
      transferFees: { feeBps: 0, maxFeeLamports: 0n },
      creatorFees: { creatorBps: 0, recipient: 'creator_1' },
      mintAuthority: null,
      freezeAuthority: null,
      delegates: [],
      creator: 'creator_1',
      funder: 'funder_1',
      holders: { count: 85, top10ConcentrationBps: 2200 },
      walletClusters: [],
      slot: 1000n,
      blockHeight: 900n,
      observedAt: new Date(Date.now() - 200).toISOString(),
      receivedAt: new Date().toISOString(),
      availableAt: new Date().toISOString(),
      knownAt: new Date().toISOString(),
      source: 'PUMP_INGESTION_WORKER',
      freshnessMs: 200,
    });

    universe.updateSnapshot(snap1);

    // Hot-path retrieval performs zero RPC calls
    const fetched = universe.getSnapshot(mintA);
    assert.ok(fetched !== null);
    assert.equal(fetched.poolType, 'PUMP_FUN');
    assert.equal(universe.isFresh(mintA, 500), true);
    assert.equal(universe.isFresh(mintA, 50), false); // older than 50ms

    // Update with later slot snapshot
    const snap2 = createSolanaMarketIR({
      ...snap1,
      slot: 1010n,
      priceSol: 0.00035,
      observedAt: new Date().toISOString(),
    });
    universe.updateSnapshot(snap2);

    // Latest snapshot
    assert.equal(universe.getSnapshot(mintA)?.slot, 1010n);

    // Point-in-time check prevents lookahead bias
    const historic = universe.getPointInTimeSnapshot(mintA, 1005n);
    assert.ok(historic !== null);
    assert.equal(historic.slot, 1000n);
    assert.equal(historic.priceSol, 0.0003);

    // Metrics summary
    const metrics = universe.getMetrics();
    assert.equal(metrics.totalTrackedMints, 1);
    assert.equal(metrics.snapshotsByPoolType.PUMP_FUN, 1);
    assert.equal(metrics.snapshotsByPoolType.RAYDIUM_AMM, 0);
  });

  test('Sections 34 & 35: ProtocolCompatibilityLease enforces fail-closed execution and passes mutation tests', () => {
    const reg = new ProtocolCompatibilityRegistry();
    const raydiumProgram = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

    const lease = createProtocolLease({
      protocolName: 'Raydium AMM v4',
      programId: raydiumProgram,
      programBinaryHash: '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      idlVersion: '4.1.0',
      feeModelVersion: '1.0.0-fixed-25bps',
      swapMathVersion: 'constant-product-v4',
      token2022Support: {
        transferFeeTested: true,
        transferHookTested: true,
        metadataPointerTested: true,
        defaultAccountStateTested: true,
      },
      testedVectorsCount: 250,
      lastVerifiedSlot: 280_000_000n,
      expirySlot: 280_050_000n,
      isCertified: true,
    });

    reg.registerLease(lease);

    // Current slot within lease boundary
    const verified = reg.verifyCompatibility(raydiumProgram, 280_010_000n, lease.programBinaryHash);
    assert.equal(verified.valid, true);

    // Expired slot triggers fail-closed OPEN_BLOCKED
    const expired = reg.verifyCompatibility(raydiumProgram, 280_060_000n, lease.programBinaryHash);
    assert.equal(expired.valid, false);
    assert.equal(expired.action, 'OPEN_BLOCKED');
    assert.match(expired.reason, /LEASE_EXPIRED/);

    // Mutated program binary triggers fail-closed OPEN_BLOCKED
    const mutatedBinary = reg.verifyCompatibility(raydiumProgram, 280_010_000n, '0xmutatedbinary1234');
    assert.equal(mutatedBinary.valid, false);
    assert.equal(mutatedBinary.action, 'OPEN_BLOCKED');
    assert.match(mutatedBinary.reason, /PROGRAM_BINARY_MUTATED/);

    // Section 35: Mutation Testing suite assertions
    assert.equal(ProtocolMutationTester.simulateFeeChange(lease).valid, false);
    assert.equal(ProtocolMutationTester.simulateSlotExpiry(lease).valid, false);
    assert.equal(ProtocolMutationTester.simulateBinaryUpgrade(lease, '0xbadupgradedhash').valid, false);
  });

  test('Sections 9 & 10: ResearchTruthFirewall keeps caller claims diagnostic and research-only', () => {
    const firewall = new ResearchTruthFirewall();

    // Self-asserted green booleans/statistics are diagnostics, never certification.
    const passingCandidate = {
      strategyId: 'sol_launch_continuation_alpha_01',
      features: ['buyer_velocity', 'creator_history', 'initial_liquidity_depth'],
      signalSignificanceSamples: [
        {
          featureName: 'buyer_velocity',
          sampleCount: 250,
          meanFutureReturnBps: 85,
          randomBaselineReturnBps: -12,
          pValue: 0.001,
          maximumFavorableExcursionBps: 180,
          maximumAdverseExcursionBps: -40,
          rugAvoidanceRatePct: 82.5,
          statisticallySignificant: true,
        },
      ],
      temporalLeakageVerified: true,
      knowledgeCutValid: true,
      recursiveStateStable: true,
      clusterLeakageClean: true,
      protocolCompatibilityCertified: true,
      walkForwardFoldsPassed: 4, // >= 3
      sealedHoldoutPositive: true,
      monteCarloRuinProbabilityPct: 0.2, // < 1.0%
    };

    const evalPassed = firewall.evaluateCandidate(passingCandidate);
    assert.equal(evalPassed.status, 'RESEARCH_ONLY');
    assert.equal(evalPassed.evidenceStatus, 'UNVERIFIED_CALLER_ASSERTIONS');
    assert.equal(evalPassed.gatesPassed, 9);
    assert.equal(evalPassed.totalGates, 9);
    assert.match(evalPassed.graduationHash, /^[a-f0-9]+$/);
    assert.match(evalPassed.candidateClaimsHash, /^[a-f0-9]+$/);
    assert.throws(() => { evalPassed.signalSignificance[0].meanFutureReturnBps = 999; }, TypeError);
    assert.throws(() => { evalPassed.gateResults[0].passed = false; }, TypeError);
    assert.equal(evalPassed.signalSignificance[0].meanFutureReturnBps, 85);
    assert.equal(evalPassed.gateResults[0].passed, true);

    // Flawed candidate failing signal significance (weak random noise feature)
    const weakCandidate = {
      ...passingCandidate,
      strategyId: 'sol_weak_noise_strategy',
      signalSignificanceSamples: [
        {
          featureName: 'unfiltered_volume_burst',
          sampleCount: 50,
          meanFutureReturnBps: 5,
          randomBaselineReturnBps: 6,
          pValue: 0.45, // not significant
          maximumFavorableExcursionBps: 20,
          maximumAdverseExcursionBps: -90,
          rugAvoidanceRatePct: 40.0,
          statisticallySignificant: false,
        },
      ],
    };

    const evalWeak = firewall.evaluateCandidate(weakCandidate);
    assert.equal(evalWeak.status, 'RESEARCH_ONLY');
    assert.ok(evalWeak.gateResults.some(g => g.gateId === 'SIGNAL_SIGNIFICANCE_GATE' && !g.passed));

    // Flawed candidate with temporal leakage
    const leakingCandidate = {
      ...passingCandidate,
      strategyId: 'sol_future_leaker',
      temporalLeakageVerified: false,
    };
    const evalLeak = firewall.evaluateCandidate(leakingCandidate);
    assert.equal(evalLeak.status, 'RESEARCH_ONLY');
    assert.ok(evalLeak.gateResults.some(g => g.gateId === 'TEMPORAL_LEAKAGE_GATE' && !g.passed));

    // Contradictory significance assertions cannot make the significance gate green.
    const contradictoryCandidate = {
      ...passingCandidate,
      signalSignificanceSamples: [{
        ...passingCandidate.signalSignificanceSamples[0],
        pValue: 0.8,
        statisticallySignificant: true,
      }],
    };
    const contradictory = firewall.evaluateCandidate(contradictoryCandidate);
    assert.equal(contradictory.status, 'RESEARCH_ONLY');
    assert.ok(contradictory.gateResults.some(g => g.gateId === 'SIGNAL_SIGNIFICANCE_GATE' && !g.passed));

    // Every supplied claim, including the feature set, participates in the claim hash.
    const changedFeatureClaim = firewall.evaluateCandidate({ ...passingCandidate, features: ['different_feature'] });
    assert.notEqual(changedFeatureClaim.candidateClaimsHash, evalPassed.candidateClaimsHash);
    const changedMetricClaim = firewall.evaluateCandidate({
      ...passingCandidate,
      signalSignificanceSamples: [{ ...passingCandidate.signalSignificanceSamples[0], meanFutureReturnBps: 86 }],
    });
    assert.notEqual(changedMetricClaim.candidateClaimsHash, evalPassed.candidateClaimsHash);

    assert.throws(() => firewall.evaluateCandidate({ ...passingCandidate, monteCarloRuinProbabilityPct: Number.NaN }), /finite/);
    assert.throws(() => firewall.evaluateCandidate({ ...passingCandidate, monteCarloRuinProbabilityPct: -1 }), /between 0 and 100/);
    assert.throws(() => firewall.evaluateCandidate({
      ...passingCandidate,
      signalSignificanceSamples: [{ ...passingCandidate.signalSignificanceSamples[0], pValue: Number.POSITIVE_INFINITY }],
    }), /finite/);
    const emptySampleClaim = firewall.evaluateCandidate({
      ...passingCandidate,
      signalSignificanceSamples: [{ ...passingCandidate.signalSignificanceSamples[0], sampleCount: 0 }],
    });
    assert.ok(emptySampleClaim.gateResults.some(g => g.gateId === 'SIGNAL_SIGNIFICANCE_GATE' && !g.passed));
  });

  test('Sections 5 & 6: SolanaSensorTournament reports telemetry without inventing economic value', () => {
    const tournament = new SolanaSensorTournament();

    const event1 = 'evt_pump_mint_001';
    tournament.recordReceipt({
      eventId: event1,
      sensorType: 'SHREDS',
      slot: 1000n,
      receiverClockId: 'test-host-boot-1',
      firstSeenAtMs: 1000,
      correctlyDecodedAtMs: 1005,
      canonicalAtMs: 1020,
      latencyMs: 5,
      decodeSuccess: true,
      isStale: false,
    });

    tournament.recordReceipt({
      eventId: event1,
      sensorType: 'GEYSER',
      slot: 1000n,
      receiverClockId: 'test-host-boot-1',
      firstSeenAtMs: 1012,
      correctlyDecodedAtMs: 1014,
      canonicalAtMs: 1020,
      latencyMs: 14,
      decodeSuccess: true,
      isStale: false,
    });

    tournament.recordReceipt({
      eventId: event1,
      sensorType: 'RPC_PRIMARY',
      slot: 1000n,
      receiverClockId: 'test-host-boot-1',
      firstSeenAtMs: 1080,
      correctlyDecodedAtMs: 1085,
      canonicalAtMs: 1090,
      latencyMs: 85,
      decodeSuccess: true,
      isStale: false,
    });

    const ranking = tournament.evaluateTournament();
    assert.ok(ranking.length > 0);
    // Shreds won the event race
    const shredsAgg = ranking.find(r => r.sensorType === 'SHREDS');
    assert.ok(shredsAgg !== undefined);
    assert.equal(shredsAgg.winsCount, 1);
    assert.equal(shredsAgg.economicValueState, 'UNKNOWN');
    assert.equal(shredsAgg.edgePreservedLamports, null);
    assert.equal(shredsAgg.providerCostLamports, null);
    assert.equal(shredsAgg.economicValueLamports, null);

    // A repeated sensor/event pair cannot rewrite previously observed evidence.
    assert.throws(() => tournament.recordReceipt({
      eventId: event1,
      sensorType: 'SHREDS',
      slot: 1000n,
      receiverClockId: 'test-host-boot-1',
      firstSeenAtMs: 1000,
      correctlyDecodedAtMs: 1006,
      canonicalAtMs: 1020,
      latencyMs: 5,
      decodeSuccess: true,
      isStale: false,
    }), /Conflicting sensor receipt/);
    assert.throws(() => tournament.recordReceipt({
      eventId: event1,
      sensorType: 'RPC_FALLBACK',
      slot: 1001n,
      receiverClockId: 'test-host-boot-1',
      firstSeenAtMs: 1000,
      correctlyDecodedAtMs: 1006,
      canonicalAtMs: 1020,
      latencyMs: 5,
      decodeSuccess: true,
      isStale: false,
    }), /agree on slot/);
    assert.throws(() => tournament.recordReceipt({
      eventId: event1,
      sensorType: 'RPC_FALLBACK',
      slot: 1000n,
      receiverClockId: 'different-host-boot',
      firstSeenAtMs: 1000,
      correctlyDecodedAtMs: 1006,
      canonicalAtMs: 1020,
      latencyMs: 5,
      decodeSuccess: true,
      isStale: false,
    }), /share a receiver clock/);

    // Section 6: Shadow Universe counterfactual evaluation
    const shadow = tournament.evaluateShadowUniverse('GEYSER');
    assert.equal(shadow.hypotheticalPrimarySensor, 'GEYSER');
    assert.equal(shadow.eventsConsidered, 1);
    assert.equal(shadow.eventsWithComparableReceipts, 1);
    assert.equal(shadow.pairedDecodeLatencyAdvantageMs, -9);
    assert.equal(shadow.economicImpactLamports, null);
    assert.equal(shadow.reliabilityImpact, 'UNKNOWN');
  });

  test('Sections 25–29: SolanaTransportTournament enforces Same Economic Generation and optimizes landing cost', () => {
    const transport = new SolanaTransportTournament();

    // Section 26: Same Economic Generation registration
    const packet = {
      economicFactId: 'fact_sol_alpha_88',
      executionGenerationId: 'gen_001',
      exactTransactionSignature: 'sig_exact_tx_777',
      transactionPayloadHash: '0xpayload1234',
      authorizedLanes: ['JITO_BUNDLE', 'DIRECT_TPU', 'SWQOS_LANE'],
      maxAllowedLanes: 3,
      dispatchTimestampMs: Date.now(),
    };

    const firstRegistration = transport.registerEconomicGeneration(packet);
    assert.equal(firstRegistration.permitted, true);

    // Duplicate economic intent must be strictly blocked
    const duplicate = transport.registerEconomicGeneration(packet);
    assert.equal(duplicate.permitted, false);
    assert.match(duplicate.violation, /DUPLICATE_ECONOMIC_GENERATION_ERROR/);

    // Section 27: Landing Cost Optimizer
    const optimization = transport.optimizeLane({
      estimatedGrossEdgeLamports: 2_500_000n, // 0.0025 SOL edge
      congestionMultiplier: 1.2,
      targetProgram: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    });
    assert.ok(optimization.selectedLane !== undefined);
    assert.ok(optimization.expectedNetEdgeLamports > 0n);

    // Section 29: RouteRegret recording
    const regret = transport.recordExecutionOutcome({
      economicFactId: 'fact_sol_alpha_88',
      actualLane: 'JITO_BUNDLE',
      actualRealizedBps: 80,
      counterfactualLane: 'DIRECT_TPU',
      counterfactualEstimatedBps: 95,
    });
    assert.equal(regret.routeRegretBps, 15); // TPU would have been +15 bps better
  });

  test('Sections 19 & 20: SolanaArbitrageGraph detects cycles and evaluates completion risk & atomicity premium', () => {
    const arbGraph = new SolanaArbitrageGraph();

    // Pool 1: SOL -> USDC (Raydium)
    arbGraph.updateEdge({
      edgeId: 'edge_sol_usdc_ray',
      poolId: 'pool_ray',
      protocol: 'RAYDIUM',
      baseToken: 'SOL',
      quoteToken: 'USDC',
      rate: 152.0,
      feeBps: 25,
      impactBps: 5,
      availableCapacityLamports: 50_000_000_000n,
      freshnessMs: 50,
      executionProbability: 0.98,
    });

    // Pool 2: USDC -> SOL (Orca Whirlpool with dislocation)
    arbGraph.updateEdge({
      edgeId: 'edge_usdc_sol_orca',
      poolId: 'pool_orca',
      protocol: 'ORCA_WHIRLPOOL',
      baseToken: 'USDC',
      quoteToken: 'SOL',
      rate: 1 / 148.0, // Dislocated rate creating gross profit
      feeBps: 30,
      impactBps: 5,
      availableCapacityLamports: 50_000_000_000n,
      freshnessMs: 40,
      executionProbability: 0.96,
    });

    const cycles = arbGraph.findProfitableCycles({
      rootToken: 'SOL',
      notionalLamports: 5_000_000_000n, // 5 SOL
      estimatedTipFeeLamports: 100_000n,
      minProfitBps: 10,
    });

    assert.equal(cycles.length, 1);
    const cycle = cycles[0];
    assert.equal(cycle.legs.length, 2);
    assert.equal(cycle.isSingleAtomicTransaction, true);
    assert.ok(cycle.atomicityPremiumLamports > 0n);
    assert.ok(cycle.robustArbProfitLamports > 0n);
    assert.ok(cycle.profitBps > 100); // Substantial gross edge net of costs
  });

  test('Sections 21–24: SolanaMarketMakingEngine tracks adverse selection and reference market divergence', () => {
    const mmEngine = new SolanaMarketMakingEngine();

    // Baseline quote
    const initialQuote = mmEngine.calculateQuote({
      poolId: 'clob_sol_usdc_01',
      fairMidPriceSol: 150.0,
      volatilityBps: 15,
      bidQueueDepth: 2,
      askQueueDepth: 3,
    });
    assert.equal(initialQuote.quoteStatus, 'ACTIVE');
    assert.equal(initialQuote.spreadBps, 35); // 20 base + 15 vol

    // Section 22: Inject toxic adverse fills (we buy, then price systematically collapses)
    for (let i = 0; i < 15; i++) {
      mmEngine.recordPostFillObservation({
        fillId: `fill_${i}`,
        fillPriceSol: 150.0,
        fillSide: 'BUY',
        filledAtMs: Date.now() - (15 - i) * 1000,
        price10ms: 149.9,
        price50ms: 149.8,
        price250ms: 149.5,
        price1s: 148.5, // -1.0% drop after fill -> severe adverse selection
        price5s: 147.0,
      });
    }

    assert.ok(mmEngine.getAdverseSelectionScore() > 60);

    // Recomputed quote must widen or halt
    const defensiveQuote = mmEngine.calculateQuote({
      poolId: 'clob_sol_usdc_01',
      fairMidPriceSol: 148.0,
      volatilityBps: 20,
      bidQueueDepth: 5,
      askQueueDepth: 5,
    });
    assert.ok(defensiveQuote.quoteStatus === 'WIDENED_ADVERSE' || defensiveQuote.quoteStatus === 'HALTED');
    assert.ok(defensiveQuote.spreadBps > initialQuote.spreadBps);

    // Section 23: Reference Market Guardian detects divergent reference price
    const guardianCheck = mmEngine.checkReferenceMarket({
      referenceSource: 'BINANCE_SOL_USDC_CEX',
      referencePriceSol: 145.0,
      localQuoteMidPriceSol: 148.0, // 2.0% divergence
      maxAllowedDivergenceBps: 30, // 30 bps threshold
    });
    assert.equal(guardianCheck.cancelRecommended, true);
    assert.ok(guardianCheck.divergenceBps > 150);

    // Section 24: Queue Position Valuation
    // When price improvement (67 bps) significantly exceeds lost queue seniority (20 bps) -> reprice
    const repriceEvalAccept = mmEngine.evaluateRepriceVsQueueSeniority({
      currentQueuePosition: 10,
      currentPriceSol: 148.0,
      targetPriceSol: 149.0, // 67.5 bps improvement
      estimatedFillProbAtCurrentPosition: 0.20,
    });
    assert.equal(repriceEvalAccept.shouldReprice, true);

    // When price improvement (6.7 bps) does not justify losing front queue position (40 bps) -> hold position
    const repriceEvalReject = mmEngine.evaluateRepriceVsQueueSeniority({
      currentQueuePosition: 20,
      currentPriceSol: 148.0,
      targetPriceSol: 148.1, // 6.7 bps improvement
      estimatedFillProbAtCurrentPosition: 0.60,
    });
    assert.equal(repriceEvalReject.shouldReprice, false);
  });

  test('Sections 16–18: SolanaCapacityEngine verifies Exit Before Entry, capacity curves & capital-time alpha', () => {
    // Section 16: Exit Before Entry with healthy deep liquidity
    const healthyExit = SolanaCapacityEngine.simulateExitBeforeEntry({
      proposedNotionalLamports: 1_000_000_000n, // 1 SOL
      poolLiquidityLamports: 500_000_000_000n, // 500 SOL
      hasFallbackRoute: true,
      jitoAvailable: true,
    });
    assert.equal(healthyExit.entryPermitted, true);
    assert.equal(healthyExit.canEvacuateAllTranches, true);

    // Hostile pool with paper-thin liquidity where 75% liquidation suffers catastrophic slippage
    const dangerousExit = SolanaCapacityEngine.simulateExitBeforeEntry({
      proposedNotionalLamports: 25_000_000_000n, // 25 SOL
      poolLiquidityLamports: 30_000_000_000n, // 30 SOL
      hasFallbackRoute: false,
      jitoAvailable: false,
    });
    assert.equal(dangerousExit.entryPermitted, false);
    assert.match(dangerousExit.refusalReason, /EXIT_STRESS_FAILURE/);

    // Section 17: Capacity curve sizing
    const curve = SolanaCapacityEngine.calculateCapacityCurve({
      mint: 'So11111111111111111111111111111111111111112',
      grossEdgeBps: 200,
      poolLiquidityUsd: 15_000,
    });
    assert.ok(curve.maximumEdgePreservingSizeUsd > 0);
    assert.ok(curve.optimalPositionUsd <= curve.maximumEdgePreservingSizeUsd);

    // Section 18: Capital-Time Alpha
    const fastTradeAlpha = SolanaCapacityEngine.computeCapitalTimeAlpha({
      netPnLLamports: 50_000_000n, // +0.05 SOL
      capitalCommittedLamports: 1_000_000_000n, // 1 SOL
      holdingTimeSeconds: 30, // 30 seconds
    });
    const slowTradeAlpha = SolanaCapacityEngine.computeCapitalTimeAlpha({
      netPnLLamports: 100_000_000n, // +0.10 SOL
      capitalCommittedLamports: 1_000_000_000n, // 1 SOL
      holdingTimeSeconds: 3600, // 1 hour
    });
    // Fast trade produces higher capital-time efficiency
    assert.ok(fastTradeAlpha > slowTradeAlpha);
  });

  test('Sections 11–15 & 40–42: SolanaStrategyEcology computes fingerprints, Anti-Portfolio Shapley values, and luck adjustment', () => {
    const ecology = new SolanaStrategyEcology();

    // Strategy A
    ecology.registerStrategy({
      strategyId: 'sol_strat_a',
      family: 'LAUNCH_CONTINUATION',
      informationSource: 'GEYSER_LOGS',
      featureFamilies: ['BUYER_VELOCITY', 'CURVE_PROGRESS'],
      decisionHorizonMs: 500,
      entryMechanism: 'IMMEDIATE_SWAP',
      exitMechanism: 'TRAILING_STOP',
      executionType: 'JITO_BUNDLE',
      primaryRiskFactor: 'DEV_DUMP',
    });

    // Strategy B: Identical duplicate under different name
    ecology.registerStrategy({
      strategyId: 'sol_strat_b',
      family: 'LAUNCH_CONTINUATION',
      informationSource: 'GEYSER_LOGS',
      featureFamilies: ['BUYER_VELOCITY', 'CURVE_PROGRESS'],
      decisionHorizonMs: 500,
      entryMechanism: 'IMMEDIATE_SWAP',
      exitMechanism: 'TRAILING_STOP',
      executionType: 'JITO_BUNDLE',
      primaryRiskFactor: 'DEV_DUMP',
    });

    // Similarity engine detects synthetic duplicate
    const similarity = ecology.computeSimilarity('sol_strat_a', 'sol_strat_b');
    assert.equal(similarity, 1.0);

    // Section 13 & 14: Anti-Portfolio and Filter Shapley attribution
    ecology.recordRejectedTrade({
      candidateMint: 'mint_rug_01',
      rejectedAt: new Date().toISOString(),
      rejectedByFilters: ['DEV_WALLET_CLUSTER_FILTER', 'TOKEN_2022_TRANSFER_FEE_FILTER'],
      futureMaxGainBps: 20,
      futureMaxDrawdownBps: -9900,
      isRugged: true,
      avoidedLossLamports: 1_000_000_000n, // 1 SOL loss avoided
      missedProfitLamports: 20_000_000n, // 0.02 SOL missed
    });

    const filterScores = ecology.evaluateFilterEconomicContributions();
    assert.equal(filterScores.length, 2);
    // Both filters receive equal Shapley credit for avoiding the rug
    assert.equal(filterScores[0].netEconomicValueLamports, filterScores[1].netEconomicValueLamports);
    assert.equal(filterScores[0].rugsAvoidedCount, 1);

    // Section 40: Luck-Adjusted Performance
    const normal = SolanaStrategyEcology.computeLuckAdjustedReturn(150, 120, 20);
    assert.equal(normal, 150); // z = 1.5, within normal distribution

    const fluke = SolanaStrategyEcology.computeLuckAdjustedReturn(500, 100, 25);
    assert.ok(fluke < 500); // z = 16.0 extreme fluke dampened significantly
  });

  test('Sections 4, 8, 30, 33: SolanaPlannerVoi evaluates Value of Information, crowding cost, and predictive prewarming', () => {
    // Section 8: VOI evaluation where waiting for data provides positive net value
    const waitDecision = SolanaPlannerVoi.evaluateInformationTradeoff({
      featureName: 'CREATOR_HISTORICAL_SOL_BALANCE',
      currentEstimatedEdgeLamports: 1_000_000n,
      edgeHalfLifeMs: 5000,
      estimatedQueryLatencyMs: 100, // 100ms query
      probDecisionFlips: 0.40, // 40% chance feature flips decision
      expectedFlipEconomicImpactLamports: 2_000_000n, // avoids 0.002 SOL loss
    });
    assert.equal(waitDecision.action, 'WAIT');
    assert.ok(waitDecision.netInformationValueLamports > 0n);

    // Fast-decaying arbitrage signal where waiting destroys edge
    const actDecision = SolanaPlannerVoi.evaluateInformationTradeoff({
      featureName: 'SLOW_HOLDER_HISTOGRAM',
      currentEstimatedEdgeLamports: 1_500_000n,
      edgeHalfLifeMs: 80, // 80ms half-life (fast arb)
      estimatedQueryLatencyMs: 70, // 70ms query decays almost all edge
      probDecisionFlips: 0.05,
      expectedFlipEconomicImpactLamports: 500_000n,
    });
    assert.equal(actDecision.action, 'ACT');

    // Section 33: Crowding cost deduction under network congestion
    const penalty = SolanaPlannerVoi.computeCrowdingPenalty(10_000_000n, {
      currentSlot: 280_000_000n,
      priorityFeeP95Lamports: 500_000n,
      jitoTipP95Lamports: 2_000_000n,
      writableAccountContentionIndex: 0.9, // heavy contention
      clusterCuPressurePct: 95, // heavy CU pressure
      failureBurstDetected: true,
    });
    assert.ok(penalty.crowdingPenaltyLamports > 0n);
    assert.ok(penalty.netEdgeAfterCrowdingLamports < 10_000_000n);

    // Section 4: Predictive Prewarming
    const planner = new SolanaPlannerVoi();
    const candidateMint = 'So11111111111111111111111111111111111111113';
    planner.prewarmOpportunity({
      targetMint: candidateMint,
      creatorWallet: 'creator_wallet_alpha',
      associatedTokenAccount: 'ata_account_alpha',
      addressLookupTable: 'alt_table_alpha',
      targetPoolAccount: 'pool_account_alpha',
    });

    const prewarmed = planner.getPrewarmedState(candidateMint);
    assert.ok(prewarmed !== null);
    assert.equal(prewarmed.isReadyForInstantBuild, true);
    assert.equal(prewarmed.associatedTokenAccount, 'ata_account_alpha');
  });

  test('Sections 36 & 44: SolanaMarketTwinResidualAuditor detects drift and BasisPointEngineeringLedger tracks upgrades', () => {
    const auditor = new SolanaMarketTwinResidualAuditor();

    // Normal execution with minor expected slippage
    const obsNormal = auditor.auditExecution({
      signature: 'sig_audit_normal_001',
      mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      slot: 280_000_100n,
      predicted: {
        outputLamports: 1_000_000_000n,
        feeLamports: 50_000n,
        slippageBps: 20,
        landingLatencyMs: 300,
        computeUnits: 120_000,
      },
      actual: {
        outputLamports: 998_000_000n,
        feeLamports: 50_000n,
        slippageBps: 25,
        landingLatencyMs: 320,
        computeUnits: 122_000,
      },
    });
    assert.equal(obsNormal.hasUnexplainedResidual, false);
    assert.equal(obsNormal.routeResidualBps, 5);

    // Anomalous execution with severe price slippage drift (> 150 bps)
    const obsAnomalous = auditor.auditExecution({
      signature: 'sig_audit_anomaly_002',
      mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      slot: 280_000_105n,
      predicted: {
        outputLamports: 1_000_000_000n,
        feeLamports: 50_000n,
        slippageBps: 20,
        landingLatencyMs: 300,
        computeUnits: 120_000,
      },
      actual: {
        outputLamports: 975_000_000n, // 250 bps loss vs predicted
        feeLamports: 50_000n,
        slippageBps: 270,
        landingLatencyMs: 400,
        computeUnits: 125_000,
      },
    });
    assert.equal(obsAnomalous.hasUnexplainedResidual, true);
    assert.ok(obsAnomalous.anomalyReason?.includes('PRICE_RESIDUAL_ANOMALY'));
    assert.equal(auditor.getActiveAnomalyCount(), 1);

    // Section 44: Basis-Point Engineering Accounting
    const engLedger = new BasisPointEngineeringLedger();
    const upgrade = engLedger.registerUpgradeImpact({
      upgradeName: 'Optimized Jito direct bundle routing and binary deserialization',
      deployedAtSlot: 280_000_500n,
      routingImprovementBps: 18,
      slippageImprovementBps: 12,
      failureReductionPct: 35.0,
      cumulativeEconomicGainLamports: 5_000_000_000n,
    });
    assert.equal(upgrade.routingImprovementBps, 18);
    assert.equal(upgrade.failureReductionPct, 35.0);
    assert.equal(engLedger.getUpgrades().length, 1);
  });

  test('Section 45: SolanaAlphaFactory coordinates 17 Alpha species and arbitrates top verified opportunity', () => {
    const protoReg = new ProtocolCompatibilityRegistry();
    const raydiumLease = createProtocolLease({
      protocolName: 'RAYDIUM_AMM',
      programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
      programBinaryHash: 'raydium_certified_hash_v4',
      idlVersion: '4.0.0',
      feeModelVersion: '25bps_fixed',
      swapMathVersion: 'cpmm_v1',
      token2022Support: false,
      testedVectorsCount: 150,
      lastVerifiedSlot: 280_000_000n,
      expirySlot: 290_000_000n,
      isCertified: true,
    });
    protoReg.registerLease(raydiumLease);

    const factory = new SolanaAlphaFactory(protoReg);

    // Proposal 1: High return, reasonable risk (Momentum breakout on Raydium AMM)
    factory.submitProposal({
      strategySpecies: 'MOMENTUM',
      strategyName: 'Raydium Volume Acceleration Hunter',
      targetMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      targetPoolId: 'pool_ray_bonk_sol',
      expectedExecutableReturnBps: 140, // +1.40%
      confidenceScorePct: 85,
      recommendedNotionalLamports: 1_000_000_000n, // 1 SOL
      holdingHorizonSeconds: 120, // 2 minutes
      expectedTailLossBps: 200,
      requiredCapacityLamports: 10_000_000_000n,
      correlationRiskDiscountPct: 5,
    });

    // Proposal 2: Ultra-high return but excessive tail loss and long holding time (Launch continuation)
    factory.submitProposal({
      strategySpecies: 'LAUNCH_INTELLIGENCE',
      strategyName: 'Pump.fun High-Risk Curve Scalper',
      targetMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      targetPoolId: 'pool_ray_bonk_sol',
      expectedExecutableReturnBps: 300,
      confidenceScorePct: 40, // low confidence
      recommendedNotionalLamports: 1_000_000_000n,
      holdingHorizonSeconds: 3600, // 1 hour holding
      expectedTailLossBps: 1200, // heavy tail risk
      requiredCapacityLamports: 5_000_000_000n,
      correlationRiskDiscountPct: 10,
    });

    // Proposal 3: Unregistered target without Market IR (must fail gating)
    factory.submitProposal({
      strategySpecies: 'CROSS_DEX_ARBITRAGE',
      strategyName: 'Ghost Route Scalp',
      targetMint: 'UnregisteredMintAddress111111111111111111111',
      targetPoolId: 'pool_unregistered',
      expectedExecutableReturnBps: 500,
      confidenceScorePct: 99,
      recommendedNotionalLamports: 1_000_000_000n,
      holdingHorizonSeconds: 10,
      expectedTailLossBps: 50,
      requiredCapacityLamports: 1_000_000_000n,
      correlationRiskDiscountPct: 0,
    });

    const marketBonk = createSolanaMarketIR({
      mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      token2022Extensions: [],
      programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
      poolId: 'pool_ray_bonk_sol',
      poolType: 'RAYDIUM_AMM',
      baseAsset: 'BONK',
      quoteAsset: 'SOL',
      reserves: {
        base: 1_000_000_000_000_000n,
        quote: 500_000_000_000n,
      },
      liquidityLamports: 50_000_000_000n,
      priceSol: 0.0000005,
      priceUsd: 0.000075,
      feeModel: { baseFeeBps: 25, creatorFeeBps: 0, dynamicFeeBps: 0 },
      transferFees: { feeBps: 0, maxFeeLamports: 0n },
      creatorFees: { creatorBps: 0, recipient: '11111111111111111111111111111111' },
      mintAuthority: null,
      freezeAuthority: null,
      delegates: [],
      creator: 'creator_bonk',
      funder: 'funder_bonk',
      holders: { count: 5000, top10ConcentrationBps: 2500 },
      walletClusters: ['cluster_organic'],
      slot: 280_000_050n,
      blockHeight: 250_000_050n,
      observedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      availableAt: new Date().toISOString(),
      knownAt: new Date().toISOString(),
      source: 'GEYSER_SHRED_RECONCILED',
      freshnessMs: 50,
    });

    const verdict = factory.arbitrateOpportunities({
      marketIRs: [marketBonk],
      currentSlot: 280_000_050n,
      solPriceUsd: 150,
    });

    assert.ok(verdict.winningProposal !== null);
    assert.equal(verdict.winningProposal.strategySpecies, 'MOMENTUM');
    assert.equal(verdict.winningProposal.strategyName, 'Raydium Volume Acceleration Hunter');
    assert.ok(verdict.answerSummary.includes('Raydium Volume Acceleration Hunter'));

    // Check that ghost proposal was blocked by missing Market IR gate
    const ghostRank = verdict.rankedProposals.find(r => r.proposal.strategySpecies === 'CROSS_DEX_ARBITRAGE');
    assert.ok(ghostRank !== undefined);
    assert.equal(ghostRank.passGating, false);
    assert.ok(ghostRank.rejectionReason?.includes('MISSING_MARKET_IR'));
  });

});
