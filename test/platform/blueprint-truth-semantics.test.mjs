import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

import { TokenSemanticEngine } from '../../dist/platform/truth/token-semantic-root.js';
const runtimeTestDist=process.env.RUNTIME_ROOT_SCHEMA_TEST_DIST;
const runtimeModule=runtimeTestDist?pathToFileURL(join(runtimeTestDist,'platform/truth/runtime-program-root.js')).href:
  new URL('../../dist/platform/truth/runtime-program-root.js',import.meta.url).href;
const certificateModule=runtimeTestDist?pathToFileURL(join(runtimeTestDist,'platform/simulation/simulation-certificate.js')).href:
  new URL('../../dist/platform/simulation/simulation-certificate.js',import.meta.url).href;
const {EnvironmentCertificationEngine}=await import(runtimeModule);
const {SimulationCertificateBuilder,verifySimulationCertificate}=await import(certificateModule);
import { ExecutionCalibrationDataset } from '../../dist/platform/calibration/execution-calibration-dataset.js';
import { MarketAuthenticityEngine } from '../../dist/platform/authenticity/market-authenticity.js';

function unknownErrorInput(runtimeRoot) {
  return {
    lane: 'SHADOW_SIMULATION', transactionVersion: 'v0', messageHash: 'm', wireTransactionHash: '', routeHash: 'r', quoteHash: 'q',
    accountKeys: [], provider: 'rpc', runtimeRoot, programRoots: [], commitment: 'confirmed', minContextSlot: runtimeRoot.contextSlot,
    simulationSlot: runtimeRoot.contextSlot, blockhash: 'bh', lastValidBlockHeight: 2, error: undefined, logs: [], invokedPrograms: [],
    unitsConsumed: 1, loadedAccountsDataSize: 0, requestedComputeLimit: 1, priorityFeeLamports: 0n, simulatedFeeLamports: 0n,
    preSolLamports: 0n, postSolLamports: 0n, preTokensRaw: 0n, postTokensRaw: 1n, simulatedOutputRaw: 1n, criticalAccounts: [],
  };
}

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

test('SimulationCertificateBuilder: binds simulation evidence and preserves outcome uncertainty', () => {
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
    commitment: 'confirmed',
    minContextSlot: 280_000_000,
    simulationSlot: 280_000_002,
    blockhash: 'recent_bh_001',
    lastValidBlockHeight: 300_000_000,
    error: null,
    logs: ['ok'],
    invokedPrograms: [prog.programId],
    unitsConsumed: 45_000,
    loadedAccountsDataSize: 1024,
    requestedComputeLimit: 80_000,
    priorityFeeLamports: 5000n,
    simulatedFeeLamports: 5000n,
    preSolLamports: 10_000_000_000n,
    postSolLamports: 9_990_000_000n,
    preTokensRaw: 0n,
    postTokensRaw: 1_000_000n,
    simulatedOutputRaw: 1_000_000n,
    criticalAccounts: ['account_pool'],
  });

  assert.equal(shadowCert.simulationLane, 'SHADOW_SIMULATION');
  assert.equal(shadowCert.sigVerify, false);
  assert.equal(shadowCert.isSimulationSuccess, true);
  assert.equal(shadowCert.simulationOutcome, 'SUCCESS');
  assert.match(shadowCert.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(verifySimulationCertificate(shadowCert), true);
  assert.ok(Object.isFrozen(shadowCert.runtimeRoot));
  assert.ok(Object.isFrozen(shadowCert.programRoots[0]));
  assert.ok(Object.isFrozen(shadowCert.programRoots[0].transitiveCpiProgramRoots));

  const mutatedInputRoot = { ...runtime };
  const mutatedInputProgram = { ...prog, transitiveCpiProgramRoots: [] };
  const mutableError = { InstructionError: [0, { Custom: 7 }] };
  const snapshot = SimulationCertificateBuilder.buildCertificate({
    lane: 'SHADOW_SIMULATION', transactionVersion: 'v0', messageHash: 'm', wireTransactionHash: '',
    routeHash: 'r', quoteHash: 'q', accountKeys: [], provider: 'rpc', runtimeRoot: mutatedInputRoot,
    programRoots: [mutatedInputProgram], commitment: 'confirmed', minContextSlot: runtime.contextSlot, simulationSlot: runtime.contextSlot,
    blockhash: 'bh', lastValidBlockHeight: 2, error: mutableError, logs: [], invokedPrograms: [],
    unitsConsumed: 1, loadedAccountsDataSize: 0, requestedComputeLimit: 1, priorityFeeLamports: 0n,
    simulatedFeeLamports: 5000n, preSolLamports: 0n, postSolLamports: 0n, preTokensRaw: 0n,
    postTokensRaw: 0n, simulatedOutputRaw: 0n, criticalAccounts: [],
  });
  mutatedInputRoot.epoch = 999;
  mutatedInputProgram.programId = 'changed';
  mutableError.InstructionError[1].Custom = 99;
  assert.equal(snapshot.runtimeRoot.epoch, runtime.epoch);
  assert.equal(snapshot.programRoots[0].programId, prog.programId);
  assert.equal(snapshot.error.InstructionError[1].Custom, 7);
  assert.ok(Object.isFrozen(snapshot.error.InstructionError[1]));
  assert.throws(() => { snapshot.error.InstructionError[1].Custom = 88; }, TypeError);
  assert.equal(verifySimulationCertificate(snapshot), true);

  const publicFields = Object.keys(shadowCert);
  for (const field of publicFields) {
    const tampered = structuredClone(shadowCert);
    if (typeof tampered[field] === 'bigint') tampered[field] += 1n;
    else if (typeof tampered[field] === 'number') tampered[field] += 1;
    else if (typeof tampered[field] === 'boolean') tampered[field] = !tampered[field];
    else if (typeof tampered[field] === 'string') tampered[field] += '_tampered';
    else if (Array.isArray(tampered[field])) tampered[field].push('tampered');
    else if (tampered[field] && typeof tampered[field] === 'object') tampered[field].tampered = true;
    else tampered[field] = 'tampered';
    assert.equal(verifySimulationCertificate(tampered), false, `${field} tampering must reject`);
  }
  const bigintAsString = structuredClone(shadowCert);
  bigintAsString.simulatedFeeLamports = '5000';
  assert.equal(verifySimulationCertificate(bigintAsString), false, 'BigInt and string values have distinct canonical types');

  const evidenceOverrides = [
    ['provider', 'rpc-other'],
    ['simulationSlot', shadowCert.simulationSlot + 1],
    ['lastValidBlockHeight', shadowCert.lastValidBlockHeight + 1],
    ['requestedComputeLimit', shadowCert.requestedComputeLimit + 1],
    ['loadedAccountsDataSize', shadowCert.loadedAccountsDataSize + 1],
    ['preSolLamports', shadowCert.preSolLamports + 1n],
    ['postSolLamports', shadowCert.postSolLamports + 1n],
    ['preTokensRaw', shadowCert.preTokensRaw + 1n],
    ['postTokensRaw', shadowCert.postTokensRaw + 1n],
    ['simulatedFeeLamports', shadowCert.simulatedFeeLamports + 1n],
    ['priorityFeeLamports', shadowCert.priorityFeeLamports + 1n],
    ['criticalAccounts', ['different-critical-account']],
  ];
  for (const [field, value] of evidenceOverrides) {
    const altered = SimulationCertificateBuilder.buildCertificate({
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
      commitment: 'confirmed',
      minContextSlot: 280_000_000,
      simulationSlot: 280_000_002,
      blockhash: 'recent_bh_001',
      lastValidBlockHeight: 300_000_000,
      error: null,
      logs: ['ok'],
      invokedPrograms: [prog.programId],
      unitsConsumed: 45_000,
      loadedAccountsDataSize: 1024,
      requestedComputeLimit: 80_000,
      priorityFeeLamports: 5000n,
      simulatedFeeLamports: 5000n,
      preSolLamports: 10_000_000_000n,
      postSolLamports: 9_990_000_000n,
      preTokensRaw: 0n,
      postTokensRaw: 1_000_000n,
      simulatedOutputRaw: 1_000_000n,
      criticalAccounts: ['account_pool'],
      ...(field === 'provider' ? { provider: value } : {}),
      ...(field === 'simulationSlot' ? { simulationSlot: value } : {}),
      ...(field === 'lastValidBlockHeight' ? { lastValidBlockHeight: value } : {}),
      ...(field === 'requestedComputeLimit' ? { requestedComputeLimit: value } : {}),
      ...(field === 'loadedAccountsDataSize' ? { loadedAccountsDataSize: value } : {}),
      ...(field === 'preSolLamports' ? { preSolLamports: value } : {}),
      ...(field === 'postSolLamports' ? { postSolLamports: value } : {}),
      ...(field === 'preTokensRaw' ? { preTokensRaw: value } : {}),
      ...(field === 'postTokensRaw' ? { postTokensRaw: value } : {}),
      ...(field === 'simulatedFeeLamports' ? { simulatedFeeLamports: value } : {}),
      ...(field === 'priorityFeeLamports' ? { priorityFeeLamports: value } : {}),
      ...(field === 'criticalAccounts' ? { criticalAccounts: value } : {}),
    });
    assert.notEqual(altered.evidenceHash, shadowCert.evidenceHash, `${field} must be hash-bound`);
  }

  const explicitNoError = SimulationCertificateBuilder.buildCertificate({
    lane: 'SHADOW_SIMULATION', messageHash: 'm', wireTransactionHash: '', routeHash: 'r', quoteHash: 'q',
    transactionVersion: 'legacy', accountKeys: [], provider: 'rpc-fast', runtimeRoot: runtime, programRoots: [], commitment: 'processed', minContextSlot: runtime.contextSlot,
    simulationSlot: runtime.contextSlot, blockhash: 'blockhash', lastValidBlockHeight: 2, error: null, logs: [], invokedPrograms: [],
    unitsConsumed: 1, loadedAccountsDataSize: 0, requestedComputeLimit: 1, priorityFeeLamports: 0n, simulatedFeeLamports: 0n,
    preSolLamports: 0n, postSolLamports: 0n, preTokensRaw: 0n, postTokensRaw: 1n, simulatedOutputRaw: 0n, criticalAccounts: [],
  });
  assert.equal(explicitNoError.isSimulationSuccess, true, 'explicit null error means RPC success even when output is zero');
  assert.equal(explicitNoError.simulationOutcome, 'SUCCESS');
  assert.equal(verifySimulationCertificate(explicitNoError), true);

  const unknownError = SimulationCertificateBuilder.buildCertificate({
    lane: 'SHADOW_SIMULATION', transactionVersion: 'v0', messageHash: 'm', wireTransactionHash: '', routeHash: 'r', quoteHash: 'q',
    accountKeys: [], provider: 'rpc', runtimeRoot: runtime, programRoots: [], commitment: 'confirmed', minContextSlot: runtime.contextSlot,
    simulationSlot: runtime.contextSlot, blockhash: 'bh', lastValidBlockHeight: 2, error: undefined, logs: [], invokedPrograms: [],
    unitsConsumed: 1, loadedAccountsDataSize: 0, requestedComputeLimit: 1, priorityFeeLamports: 0n, simulatedFeeLamports: 0n,
    preSolLamports: 0n, postSolLamports: 0n, preTokensRaw: 0n, postTokensRaw: 1n, simulatedOutputRaw: 1n, criticalAccounts: [],
  });
  assert.equal(unknownError.simulationOutcome, 'UNKNOWN', 'positive output cannot imply success without err:null');
  assert.equal(unknownError.isSimulationSuccess, false);
  assert.notEqual(unknownError.evidenceHash, explicitNoError.evidenceHash, 'undefined and null have distinct canonical encodings');
  const omittedError = unknownErrorInput(runtime);
  delete omittedError.error;
  assert.throws(() => SimulationCertificateBuilder.buildCertificate(omittedError), /SIMULATION_INPUT_SCHEMA_INVALID/);
  const malformedError = SimulationCertificateBuilder.buildCertificate({ ...unknownErrorInput(runtime), error: 1 });
  assert.equal(malformedError.simulationOutcome, 'UNKNOWN');
  const stringFailure = SimulationCertificateBuilder.buildCertificate({ ...unknownErrorInput(runtime), error: 'Blockhash not found' });
  const bigintMalformed = SimulationCertificateBuilder.buildCertificate({ ...unknownErrorInput(runtime), error: 5000n });
  assert.equal(stringFailure.simulationOutcome, 'FAILURE');
  assert.equal(bigintMalformed.simulationOutcome, 'UNKNOWN');
  assert.notEqual(stringFailure.evidenceHash, bigintMalformed.evidenceHash, 'strings and BigInts have distinct canonical encodings');
  const failedError = SimulationCertificateBuilder.buildCertificate({ ...unknownErrorInput(runtime), error: { BlockhashNotFound: null } });
  assert.equal(failedError.simulationOutcome, 'FAILURE');
  const structuredFailure = SimulationCertificateBuilder.buildCertificate({
    ...unknownErrorInput(runtime), error: { InsufficientFundsForRent: { account_index: 1 } },
  });
  assert.equal(structuredFailure.simulationOutcome, 'FAILURE');
  const malformedObjectError = SimulationCertificateBuilder.buildCertificate({ ...unknownErrorInput(runtime), error: { NotARealRpcError: null } });
  assert.equal(malformedObjectError.simulationOutcome, 'UNKNOWN');
  assert.throws(() => SimulationCertificateBuilder.buildCertificate({ ...unknownErrorInput(runtime), error: undefined, logs: undefined }), /SIMULATION_LOGS_INVALID/);
  assert.throws(() => SimulationCertificateBuilder.buildCertificate({ ...unknownErrorInput(runtime), transactionVersion: undefined }), /SIMULATION_ENUM_INVALID/);
  const cyclicError = {}; cyclicError.self = cyclicError;
  assert.throws(() => SimulationCertificateBuilder.buildCertificate({ ...unknownErrorInput(runtime), error: cyclicError }), /SIMULATION_CYCLIC_VALUE/);
  assert.throws(() => SimulationCertificateBuilder.buildCertificate({ ...unknownErrorInput(runtime), error: new Date() }), /SIMULATION_NESTED_OBJECT_INVALID/);
  assert.throws(() => SimulationCertificateBuilder.buildCertificate({ ...unknownErrorInput(runtime), accountKeys: Array(257).fill('account') }), /SIMULATION_ACCOUNT_KEYS_TOO_LARGE/);
  assert.throws(() => SimulationCertificateBuilder.buildCertificate(new Proxy(unknownErrorInput(runtime), {})), /SIMULATION_INPUT_INVALID/);

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
    commitment: 'confirmed',
    minContextSlot: 280_000_000,
    simulationSlot: 280_000_005,
    blockhash: 'recent_bh_002',
    lastValidBlockHeight: 300_000_000,
    error: null,
    logs: [],
    invokedPrograms: [prog.programId],
    unitsConsumed: 46_200,
    loadedAccountsDataSize: 1024,
    requestedComputeLimit: 80_000,
    priorityFeeLamports: 10_000n,
    simulatedFeeLamports: 5000n,
    preSolLamports: 10_000_000_000n,
    postSolLamports: 9_985_000_000n,
    preTokensRaw: 0n,
    postTokensRaw: 1_000_000n,
    simulatedOutputRaw: 1_000_000n,
    criticalAccounts: ['account_pool'],
  });

  assert.equal(finalCert.simulationLane, 'EXACT_FINAL_SIMULATION');
  assert.equal(finalCert.sigVerify, true);
  assert.equal(finalCert.replaceRecentBlockhash, false);
});

test('SimulationCertificateBuilder: stable evidence hashing canonicalizes object key order', () => {
  const runtime = EnvironmentCertificationEngine.createRuntimeRoot({ epoch: 650, contextSlot: 280_000_000 });
  const common = {
    lane: 'SHADOW_SIMULATION', messageHash: 'message', wireTransactionHash: '', routeHash: 'route', quoteHash: 'quote',
    transactionVersion: 'v0', accountKeys: ['a'], provider: 'rpc', runtimeRoot: undefined, programRoots: [], commitment: 'processed',
    minContextSlot: runtime.contextSlot, simulationSlot: runtime.contextSlot + 1, blockhash: 'blockhash', lastValidBlockHeight: 3, error: null,
    logs: [], invokedPrograms: [], unitsConsumed: 1, loadedAccountsDataSize: 0, requestedComputeLimit: 2,
    priorityFeeLamports: 0n, simulatedFeeLamports: 0n, preSolLamports: 0n, postSolLamports: 0n,
    preTokensRaw: 0n, postTokensRaw: 1n, simulatedOutputRaw: 1n, criticalAccounts: [],
  };
  const rootA = { cluster: runtime.cluster, genesisHash: runtime.genesisHash, epoch: runtime.epoch,
    contextSlot: runtime.contextSlot, agaveVersion: runtime.agaveVersion, activeFeatureSetHash: runtime.activeFeatureSetHash,
    transactionVersionSupported: runtime.transactionVersionSupported, resourcePolicyVersion: runtime.resourcePolicyVersion,
    runtimeRootHash: runtime.runtimeRootHash, runtimeRootHashSchemaVersion: runtime.runtimeRootHashSchemaVersion };
  const rootB = { runtimeRootHash: runtime.runtimeRootHash, resourcePolicyVersion: runtime.resourcePolicyVersion,
    transactionVersionSupported: runtime.transactionVersionSupported, activeFeatureSetHash: runtime.activeFeatureSetHash,
    runtimeRootHashSchemaVersion: runtime.runtimeRootHashSchemaVersion, agaveVersion: runtime.agaveVersion, contextSlot: runtime.contextSlot, epoch: runtime.epoch,
    genesisHash: runtime.genesisHash, cluster: runtime.cluster };
  const a = SimulationCertificateBuilder.buildCertificate({ ...common, runtimeRoot: rootA, programRoots: [] });
  const b = SimulationCertificateBuilder.buildCertificate({ ...common, runtimeRoot: rootB, programRoots: [] });
  assert.equal(a.evidenceHash, b.evidenceHash);
});

test('SimulationCertificateBuilder: rejects forged roots, future programs, stale slots, and incompatible lanes', () => {
  const runtime = EnvironmentCertificationEngine.createRuntimeRoot({ epoch: 650, contextSlot: 280_000_000 });
  const program = EnvironmentCertificationEngine.createProgramRoot({
    programId: 'RootHashProgram1111111111111111111111111111', deploymentSlot: 200_000_000,
    executableBytecodeHash: 'bytecode_original',
  });
  const valid = unknownErrorInput(runtime);
  assert.doesNotThrow(() => SimulationCertificateBuilder.buildCertificate({ ...valid, programRoots: [program] }));

  const forgedRuntime = { ...runtime, epoch: runtime.epoch + 1 };
  assert.throws(() => SimulationCertificateBuilder.buildCertificate({ ...valid, runtimeRoot: forgedRuntime }), /SIMULATION_RUNTIME_ROOT_HASH_MISMATCH/);

  const forgedProgram = { ...program, executableBytecodeHash: 'bytecode_forged' };
  assert.throws(() => SimulationCertificateBuilder.buildCertificate({ ...valid, programRoots: [forgedProgram] }), /SIMULATION_PROGRAM_ROOT_FOREST_INVALID/);

  const parent = EnvironmentCertificationEngine.createProgramRoot({
    programId: 'RootHashParent111111111111111111111111111', deploymentSlot: 210_000_000,
    executableBytecodeHash: 'parent_bytecode', transitiveCpiProgramRoots: [program],
  });
  const forgedChild = { ...program, executableBytecodeHash: 'forged_nested_bytecode' };
  const forgedParent = { ...parent, transitiveCpiProgramRoots: [forgedChild] };
  assert.throws(() => SimulationCertificateBuilder.buildCertificate({ ...valid, programRoots: [forgedParent] }), /SIMULATION_PROGRAM_ROOT_FOREST_INVALID/);

  const futureProgram = EnvironmentCertificationEngine.createProgramRoot({
    programId: 'FutureDeployment11111111111111111111111111', deploymentSlot: runtime.contextSlot + 1,
    executableBytecodeHash: 'future_bytecode',
  });
  assert.throws(() => SimulationCertificateBuilder.buildCertificate({ ...valid, programRoots: [futureProgram] }), /SIMULATION_PROGRAM_ROOT_FOREST_INVALID/);
  assert.throws(() => SimulationCertificateBuilder.buildCertificate({ ...valid, simulationSlot: valid.minContextSlot - 1 }), /SIMULATION_SLOT_BELOW_MIN_CONTEXT_SLOT/);
  assert.throws(() => SimulationCertificateBuilder.buildCertificate({
    ...valid, minContextSlot: runtime.contextSlot - 10, simulationSlot: runtime.contextSlot - 1,
  }), /SIMULATION_SLOT_BELOW_RUNTIME_CONTEXT_SLOT/);
  assert.throws(() => SimulationCertificateBuilder.buildCertificate({
    ...valid, lane: 'EXACT_FINAL_SIMULATION', wireTransactionHash: '',
  }), /SIMULATION_EXACT_FINAL_WIRE_HASH_REQUIRED/);

  const legacyOnlyRuntime = EnvironmentCertificationEngine.createRuntimeRoot({epoch:runtime.epoch,contextSlot:runtime.contextSlot,
    transactionVersionSupported:'legacy'});
  assert.throws(() => SimulationCertificateBuilder.buildCertificate({
    ...valid, runtimeRoot: legacyOnlyRuntime, transactionVersion: 'v0',
  }), /SIMULATION_TRANSACTION_VERSION_UNSUPPORTED_BY_RUNTIME/);
  const legacyCert = SimulationCertificateBuilder.buildCertificate({
    ...valid, runtimeRoot: legacyOnlyRuntime, transactionVersion: 'legacy',
  });
  assert.equal(verifySimulationCertificate(legacyCert), true);
  assert.equal(verifySimulationCertificate({ ...legacyCert, transactionVersion: 'v0' }), false);
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
