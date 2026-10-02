import test from 'node:test';
import assert from 'node:assert/strict';

import { TokenSemanticEngine } from '../../dist/platform/truth/token-semantic-root.js';
import { EnvironmentCertificationEngine } from '../../dist/platform/truth/runtime-program-root.js';
import { SimulationCertificateBuilder } from '../../dist/platform/simulation/simulation-certificate.js';
import { ExecutionCalibrationDataset } from '../../dist/platform/calibration/execution-calibration-dataset.js';
import { MarketAuthenticityEngine } from '../../dist/platform/authenticity/market-authenticity.js';

test('TokenSemanticEngine: evaluates Token-2022 extensions and enforces buy != sell path', () => {
  const mintClean = 'CleanMint111111111111111111111111111111111';
  const cleanSemantics = TokenSemanticEngine.evaluateSemantics({
    mint: mintClean,
    slot: 280_000_000,
    decodedState: {
      decimals: 6,
      rawSupply: 1_000_000_000_000n,
      isInitialized: true,
      mintAuthority: { kind: 'ABSENT_PROVEN' },
      freezeAuthority: { kind: 'ABSENT_PROVEN' },
      permanentDelegate: { kind: 'ABSENT_PROVEN' },
      transferHook: { kind: 'ABSENT_PROVEN' },
      parsedExtensions: [],
    },
  });

  assert.equal(cleanSemantics.isBuyPathFeasible, true);
  assert.equal(cleanSemantics.isSellPathFeasible, true);
  assert.equal(cleanSemantics.sellPathRiskFactors.length, 0);

  // Hostile Mint with Permanent Delegate & NonTransferable (Soulbound)
  const mintHostile = 'HostileTrapMint2222222222222222222222222222';
  const hostileSemantics = TokenSemanticEngine.evaluateSemantics({
    mint: mintHostile,
    slot: 280_000_001,
    decodedState: {
      decimals: 6,
      rawSupply: 1_000_000_000_000n,
      isInitialized: true,
      mintAuthority: { kind: 'ABSENT_PROVEN' },
      freezeAuthority: { kind: 'ABSENT_PROVEN' },
      permanentDelegate: { kind: 'PRESENT', authority: 'HostileDelegate1111111111111111111111111' },
      transferHook: { kind: 'ABSENT_PROVEN' },
      parsedExtensions: [9], // NonTransferable extension
    },
  });

  assert.equal(hostileSemantics.isBuyPathFeasible, false); // Non-transferable blocks buy & sell
  assert.equal(hostileSemantics.isSellPathFeasible, false); // SELL PATH BLOCKED
  assert.ok(hostileSemantics.sellPathRiskFactors.length >= 2);
  const sellCheck = TokenSemanticEngine.verifySellPath(hostileSemantics);
  assert.equal(sellCheck.isSellApproved, false);
});

test('EnvironmentCertificationEngine: certifies RuntimeRoot and ProgramRoots and detects drift', () => {
  const runtime = EnvironmentCertificationEngine.createRuntimeRoot({
    cluster: 'mainnet-beta',
    genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    epoch: 650,
    contextSlot: 280_000_000,
    agaveVersion: 'v4.3.0',
    activeFeatures: ['warp_core_v1', 'simd_0033'],
  });

  assert.ok(runtime.runtimeRootHash.length === 64);
  assert.equal(runtime.cluster, 'mainnet-beta');

  const progA = EnvironmentCertificationEngine.createProgramRoot({
    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun
    programDataAddress: 'ProgDataPump11111111111111111111111111111111',
    deploymentSlot: 200_000_000,
    executableBytecodeHash: 'bytecode_pump_v1',
  });

  assert.equal(progA.isImmutable, true);

  // Validate compatibility: identical runtime and program passes
  const validCheck = EnvironmentCertificationEngine.verifyCompatibility(runtime, runtime, [progA], [progA]);
  assert.equal(validCheck.isCompatible, true);

  // Bytecode drift invalidates environment
  const progMutated = EnvironmentCertificationEngine.createProgramRoot({
    programId: progA.programId,
    deploymentSlot: 200_000_100,
    executableBytecodeHash: 'bytecode_pump_MODIFIED_v2',
  });
  const driftCheck = EnvironmentCertificationEngine.verifyCompatibility(runtime, runtime, [progMutated], [progA]);
  assert.equal(driftCheck.isCompatible, false);
  assert.ok(driftCheck.invalidatedReasons[0].includes('PROGRAM_BYTECODE_MUTATED'));
});

test('SimulationCertificateBuilder: isolates Shadow vs Exact Final lanes and certifies execution', () => {
  const runtime = EnvironmentCertificationEngine.createRuntimeRoot({ epoch: 650, contextSlot: 280_000_000 });
  const prog = EnvironmentCertificationEngine.createProgramRoot({
    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    deploymentSlot: 200_000_000,
    executableBytecodeHash: 'bytecode_001',
  });

  const shadowCert = SimulationCertificateBuilder.buildCertificate({
    lane: 'SHADOW_SIMULATION',
    transactionVersion: 'v0',
    messageHash: 'msg_hash_001',
    wireTransactionHash: '',
    routeHash: 'route_hash_pump',
    quoteHash: 'quote_hash_1',
    accountKeys: ['account_pool', 'account_vault'],
    provider: 'rpc-fast',
    runtimeRoot: runtime,
    programRoots: [prog],
    minContextSlot: 280_000_000,
    simulationSlot: 280_000_002,
    blockhash: 'recent_bh_001',
    lastValidBlockHeight: 300_000_000,
    unitsConsumed: 45_000,
    requestedComputeLimit: 80_000,
    priorityFeeLamports: 5000n,
    preSolLamports: 10_000_000_000n,
    postSolLamports: 9_990_000_000n,
    preTokensRaw: 0n,
    postTokensRaw: 1_000_000n,
    simulatedOutputRaw: 1_000_000n,
  });

  assert.equal(shadowCert.simulationLane, 'SHADOW_SIMULATION');
  assert.equal(shadowCert.sigVerify, false);
  assert.equal(shadowCert.isSimulationSuccess, true);

  // Exact Final requires sigVerify = true
  const finalCert = SimulationCertificateBuilder.buildCertificate({
    lane: 'EXACT_FINAL_SIMULATION',
    transactionVersion: 'v0',
    messageHash: 'msg_hash_002',
    wireTransactionHash: 'signed_wire_bytes_hash_001',
    routeHash: 'route_hash_pump',
    quoteHash: 'quote_hash_2',
    accountKeys: ['account_pool', 'account_vault'],
    provider: 'rpc-jito-engine',
    runtimeRoot: runtime,
    programRoots: [prog],
    minContextSlot: 280_000_000,
    simulationSlot: 280_000_005,
    blockhash: 'recent_bh_002',
    lastValidBlockHeight: 300_000_000,
    unitsConsumed: 46_200,
    requestedComputeLimit: 80_000,
    priorityFeeLamports: 10_000n,
    preSolLamports: 10_000_000_000n,
    postSolLamports: 9_985_000_000n,
    preTokensRaw: 0n,
    postTokensRaw: 1_000_000n,
    simulatedOutputRaw: 1_000_000n,
  });

  assert.equal(finalCert.simulationLane, 'EXACT_FINAL_SIMULATION');
  assert.equal(finalCert.sigVerify, true);
  assert.equal(finalCert.replaceRecentBlockhash, false);
});

test('ExecutionCalibrationDataset: calculates precise empirical slippage and drift metrics', () => {
  const dataset = new ExecutionCalibrationDataset();

  const record = dataset.recordExecution({
    intentId: 'intent_calib_001',
    mint: 'MintCalib11111111111111111111111111111111111111',
    dex: 'PUMP_BONDING_CURVE',
    route: 'DIRECT_PUMP',
    poolSolLiquidity: 45.0,
    orderSizeSol: 1.0,
    quotedOutputRaw: 100_000n,
    simulatedOutputRaw: 99_500n,
    landedOutputRaw: 98_000n,
    quotedPriceSolPerToken: 0.0001,
    simulatedPriceSolPerToken: 0.0001005,
    landedPriceSolPerToken: 0.0001020,
    simulatedCU: 50_000,
    landedCU: 52_000,
    quoteSlot: 280_000_000,
    simulationSlot: 280_000_001,
    landingSlot: 280_000_004,
  });

  assert.equal(record.quoteErrorRaw, -500n);
  assert.equal(record.executionStateDriftRaw, -1500n);
  assert.equal(record.realizedQuoteSlippageRaw, -2000n);
  assert.equal(record.cuError, 2000);
  assert.equal(record.landingDriftSlots, 3);

  const calibration = dataset.getCalibrationSummary('PUMP_BONDING_CURVE');
  assert.ok(calibration);
  assert.equal(calibration.sampleCount, 1);
  assert.ok(calibration.medianRealizedSlippageBps > 0);
});

test('MarketAuthenticityEngine: detects Sybil swarms, computes cost-to-fake, and issues certificate', () => {
  // Manipulated Token: 100 wallets funded by same entity, 40% wash trading, 30% insider supply
  const hostileCert = MarketAuthenticityEngine.evaluateAuthenticity({
    mint: 'HostileSybilMint111111111111111111111111111',
    walletCount: 100,
    uniqueEntityCount: 4, // 100 wallets -> 4 entities
    washTradingVolumeSol: 40.0,
    totalVolumeSol: 100.0,
    creatorControlledSupplyPct: 15.0,
    insiderSupplyPct: 18.0,
    coordinatedSupplyPct: 5.0,
    funderConcentrationScore: 0.88,
    sustainedCapitalInflowSol: 1.0,
    sellerAbsorptionRate: 0.20,
    observationSlot: 280_000_000,
    observedAtMs: Date.now(),
  });

  assert.equal(hostileCert.isApprovedForCapital, false);
  assert.ok(hostileCert.probabilities.pWash > 0.4);
  assert.ok(hostileCert.probabilities.pAuthentic < 0.5);
  assert.ok(hostileCert.cheapSignalsDetected.length >= 2);

  // Authentic Token: 30 wallets -> 26 distinct entities, <5% wash, 1% dev holding
  const cleanCert = MarketAuthenticityEngine.evaluateAuthenticity({
    mint: 'CleanOrganicMint222222222222222222222222222',
    walletCount: 30,
    uniqueEntityCount: 26,
    washTradingVolumeSol: 2.0,
    totalVolumeSol: 50.0,
    creatorControlledSupplyPct: 1.0,
    insiderSupplyPct: 2.0,
    coordinatedSupplyPct: 0.0,
    funderConcentrationScore: 0.15,
    sustainedCapitalInflowSol: 25.0,
    sellerAbsorptionRate: 0.85,
    observationSlot: 280_000_000,
    observedAtMs: Date.now(),
  });

  assert.equal(cleanCert.isApprovedForCapital, true);
  assert.ok(cleanCert.probabilities.pAuthentic > 0.7);
  assert.ok(cleanCert.manipulationResistanceScore >= 0.6);
  assert.ok(cleanCert.durableSignalsVerified.length >= 2);
});
