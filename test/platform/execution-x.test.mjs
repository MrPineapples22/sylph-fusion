import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  LockGraphEngine,
  LeaderRegimeEngine,
  AlphaTtlEngine,
  GenerationFencedRetryEngine,
  AllInBreakevenEngine,
  SimulationEnsembleEngine,
} from '../../dist/platform/execution/execution-x.js';

test('LockGraphEngine: acquires locks and detects conflicting concurrent transactions', () => {
  const engine = new LockGraphEngine();

  // Intent 1 acquires locks on curve and user ATA
  const r1 = engine.acquireLocks('intent_1', {
    readAccounts: ['prog_pump'],
    writableAccounts: ['curve_account_1', 'user_ata_1'],
  });
  assert.equal(r1.hasConflict, false);

  // Intent 2 tries to acquire write-lock on curve_account_1 -> conflict!
  const r2 = engine.acquireLocks('intent_2', {
    readAccounts: ['prog_pump'],
    writableAccounts: ['curve_account_1', 'user_ata_2'],
  });
  assert.equal(r2.hasConflict, true);
  assert.equal(r2.conflictingAccounts.includes('curve_account_1'), true);

  // Intent 1 finishes and releases locks
  engine.releaseLocks('intent_1');

  // Intent 2 can now acquire the lock cleanly
  const r3 = engine.acquireLocks('intent_2', {
    readAccounts: ['prog_pump'],
    writableAccounts: ['curve_account_1', 'user_ata_2'],
  });
  assert.equal(r3.hasConflict, false);
});

test('LockGraphEngine: shared reads block a different writer and writers block reads', () => {
  const engine = new LockGraphEngine();
  assert.equal(engine.acquireLocks('reader-a', { readAccounts: ['pool'], writableAccounts: [] }).hasConflict, false);
  assert.equal(engine.acquireLocks('reader-b', { readAccounts: ['pool'], writableAccounts: [] }).hasConflict, false);
  const writer = engine.acquireLocks('writer', { readAccounts: [], writableAccounts: ['pool', 'pool'] });
  assert.deepEqual(writer.conflictingAccounts, ['pool']);
  engine.releaseLocks('reader-a');
  assert.equal(engine.acquireLocks('writer', { readAccounts: [], writableAccounts: ['pool'] }).hasConflict, true);
  engine.releaseLocks('reader-b');
  assert.equal(engine.acquireLocks('writer', { readAccounts: [], writableAccounts: ['pool'] }).hasConflict, false);
  assert.deepEqual(engine.acquireLocks('reader-c', { readAccounts: ['pool'], writableAccounts: [] }).conflictingAccounts, ['pool']);
  assert.throws(() => engine.acquireLocks('', { readAccounts: [], writableAccounts: [] }), /intentId/);
  assert.throws(() => engine.acquireLocks('bad', { readAccounts: [''], writableAccounts: [] }), /account keys/);
});

test('LeaderRegimeEngine: classifies inputs but withholds unsupported auction and landing estimates', () => {
  const jitoLeader = LeaderRegimeEngine.evaluateLeader(
    5000,
    'jito_validator_pubkey',
    true,
    5_000n,
    1.0 // 1 SOL trade
  );

  assert.equal(jitoLeader.leaderType, 'JITO_STAKED');
  assert.equal(jitoLeader.evidenceClass, 'RESEARCH_ONLY_UNCALIBRATED');
  assert.equal(jitoLeader.inputLocalFeeMicroLamports, 5_000n);
  assert.equal(jitoLeader.optimalTipLamports, null);
  assert.equal(jitoLeader.auctionShadowPriceLamports, null);
  assert.equal(jitoLeader.estimatedLandingProbability, null);

  const vanillaLeader = LeaderRegimeEngine.evaluateLeader(
    5001,
    'vanilla_validator_pubkey',
    false,
    5_000n,
    1.0
  );
  assert.equal(vanillaLeader.leaderType, 'VANILLA_RPC');
  assert.equal(vanillaLeader.estimatedLandingProbability, null);
  assert.throws(() => LeaderRegimeEngine.evaluateLeader(-1, 'leader', true, 1n, 1), /slot/);
  assert.throws(() => LeaderRegimeEngine.evaluateLeader(1, '', true, 1n, 1), /leaderIdentity/);
  assert.throws(() => LeaderRegimeEngine.evaluateLeader(1, 'leader', true, -1n, 1), /localFeeMicroLamports/);
  assert.throws(() => LeaderRegimeEngine.evaluateLeader(1, 'leader', true, 1n, NaN), /tradeSizeSol/);
  assert.throws(() => LeaderRegimeEngine.evaluateLeader(1, 'leader', 'yes', 1n, 1), /isJitoStaked/);
});

test('AlphaTtlEngine: computes effective TTL, detects alpha expiration and negative retry EV', () => {
  // Scenario 1: Fresh opportunity with positive EV
  const fresh = AlphaTtlEngine.evaluateTtl({
    intentId: 'intent_fresh',
    elapsedSeconds: 2,
    blockhashTtlSeconds: 60,
    quoteTtlSeconds: 15,
    alphaTtlSeconds: 20,
    riskTtlSeconds: 30,
    capabilityTtlSeconds: 300,
    grossAlphaEv: 0.15,
    feeCostSol: 0.005,
  });

  assert.equal(fresh.effectiveTtlSeconds, 15); // min is quoteTtl (15s)
  assert.equal(fresh.isExpired, false);
  assert.equal(fresh.retryEv > 0, true);

  // Scenario 2: Stale opportunity where elapsed > effective TTL
  const stale = AlphaTtlEngine.evaluateTtl({
    intentId: 'intent_stale',
    elapsedSeconds: 16,
    blockhashTtlSeconds: 60,
    quoteTtlSeconds: 15,
    alphaTtlSeconds: 20,
    riskTtlSeconds: 30,
    capabilityTtlSeconds: 300,
    grossAlphaEv: 0.15,
    feeCostSol: 0.005,
  });

  assert.equal(stale.isExpired, true);
  assert.equal(stale.reason, 'EFFECTIVE_TTL_EXPIRED');

  // Scenario 3: Decayed alpha where retry EV <= 0
  const decayed = AlphaTtlEngine.evaluateTtl({
    intentId: 'intent_decayed',
    elapsedSeconds: 14.5,
    blockhashTtlSeconds: 60,
    quoteTtlSeconds: 15,
    alphaTtlSeconds: 20,
    riskTtlSeconds: 30,
    capabilityTtlSeconds: 300,
    grossAlphaEv: 0.01,
    feeCostSol: 0.02,
  });

  assert.equal(decayed.isExpired, true);
  assert.equal(decayed.reason, 'RETRY_EV_NEGATIVE');
  assert.throws(() => AlphaTtlEngine.evaluateTtl({
    intentId: 'invalid', elapsedSeconds: NaN, blockhashTtlSeconds: 60,
    quoteTtlSeconds: 15, alphaTtlSeconds: 20, riskTtlSeconds: 30,
    capabilityTtlSeconds: 300, grossAlphaEv: 0.15, feeCostSol: 0.005,
  }), /elapsedSeconds/);
  assert.throws(() => AlphaTtlEngine.evaluateTtl({
    intentId: 'invalid', elapsedSeconds: 0, blockhashTtlSeconds: 60,
    quoteTtlSeconds: 0, alphaTtlSeconds: 20, riskTtlSeconds: 30,
    capabilityTtlSeconds: 300, grossAlphaEv: 0.15, feeCostSol: 0.005,
  }), /quoteTtlSeconds/);
});

test('GenerationFencedRetryEngine: research allocation cannot advance, retire or reset', () => {
  const engine = new GenerationFencedRetryEngine();

  // Create initial generation
  const gen1 = engine.createInitialGeneration('intent_gen_test', 'tx_hash_1');
  assert.equal(gen1.authority, 'RESEARCH_ONLY');
  assert.equal(gen1.isFenced, false);
  assert.equal(gen1.activeGeneration, 1);
  assert.equal(engine.validateGeneration('intent_gen_test', 1), true);
  assert.equal(engine.validateGeneration('intent_gen_test', 2), false);

  // No proof and fabricated caller proof are equally incapable of authority.
  for (const proof of [undefined, { certificateType: 'NO_LAND_CERTIFICATE', proofDigest: 'fabricated' },
    { certificateType: 'FINALIZED_SETTLEMENT_CERTIFICATE', signature: 'unrelated', proofDigest: 'fabricated' }]) {
    assert.throws(() => engine.advanceGeneration('intent_gen_test', 'tx_hash_2', proof), /TERMINAL_TRANSITION_UNAVAILABLE/);
    assert.throws(() => engine.retireIntent('intent_gen_test', proof), /TERMINAL_TRANSITION_UNAVAILABLE/);
    assert.throws(() => engine.createInitialGeneration('intent_gen_test', 'replacement'), /GENERATION_ALREADY_ACTIVE/);
  }
  assert.throws(() => { gen1.activeGeneration = 2; }, TypeError);
  assert.throws(() => { gen1.authority = 'LIVE'; }, TypeError);
  assert.equal(engine.validateGeneration('intent_gen_test', 1), true);
  assert.equal(engine.validateGeneration('intent_gen_test', 2), false);
});

test('GenerationFencedRetryEngine: reserved/malformed IDs and missing generation never match', () => {
  const engine = new GenerationFencedRetryEngine();
  for (const id of ['__proto__', 'constructor', 'prototype', 'Constructor', '', ' ', 'trailing\n',
    'a/b', 'a\\b', 'économic', 'x'.repeat(257), null, undefined, 1, {}, ['intent']]) {
    assert.throws(() => engine.createInitialGeneration(id, 'tx'), /INVALID_INTENT_ID/);
    assert.equal(engine.validateGeneration(id, 1), false);
    assert.throws(() => engine.advanceGeneration(id, 'tx'), /TERMINAL_TRANSITION_UNAVAILABLE/);
    assert.throws(() => engine.retireIntent(id), /TERMINAL_TRANSITION_UNAVAILABLE/);
  }
  engine.createInitialGeneration('valid', 'tx');
  for (const generation of [undefined, null, 0, -1, 1.5, NaN, Infinity, '1']) {
    assert.equal(engine.validateGeneration('missing', generation), false);
    assert.equal(engine.validateGeneration('valid', generation), false);
  }
  for (const id of ['a', 'intent.valid-1:part_2', 'x'.repeat(256)]) {
    engine.createInitialGeneration(id, 'tx');
    assert.equal(engine.validateGeneration(id, 1), true);
    assert.throws(() => engine.createInitialGeneration(id, 'replacement'), /GENERATION_ALREADY_ACTIVE/);
  }
});

test('GenerationFencedRetryEngine: new object has no durable history and only emits research records', () => {
  const first = new GenerationFencedRetryEngine();
  first.createInitialGeneration('process_local', 'tx1');
  const restarted = new GenerationFencedRetryEngine();
  assert.equal(restarted.validateGeneration('process_local', 1), false);
  const record = restarted.createInitialGeneration('process_local', 'tx2');
  assert.equal(record.authority, 'RESEARCH_ONLY');
  assert.equal(record.isFenced, false);
  assert.throws(() => restarted.advanceGeneration('process_local', 'tx3'), /TERMINAL_TRANSITION_UNAVAILABLE/);
  assert.throws(() => restarted.retireIntent('process_local'), /TERMINAL_TRANSITION_UNAVAILABLE/);
});

test('AllInBreakevenEngine: models ATA rent separately under an explicit recovery assumption', () => {
  // Scenario 1: Standard trade (0.5 SOL notional) with ATA creation
  const hurdle1 = AllInBreakevenEngine.calculateHurdle({
    notionalSol: 0.5,
    needsAtaCreation: true,
    ataCreationLamports: 2_039_000n,
    ataRentRecoveryAssumption: 'RECOVER_ON_CLOSE',
    baseFeeLamports: 5_000n,
    computeUnitLimit: 200_000,
    priorityFeeMicroLamports: 10_000n,
    jitoTipLamports: 10_000n,
    lpFeeBps: 100, // 1%
    expectedSlippageBps: 150, // 1.5%
  });

  assert.equal(hurdle1.evidenceClass, 'RESEARCH_ONLY_ESTIMATE');
  assert.equal(hurdle1.ataRentLockedSol, 0.002039);
  assert.equal(hurdle1.assumedUnrecoveredRentCostSol, 0);
  assert.equal(hurdle1.modeledHurdlePercentage > 0, true);
  assert.equal(hurdle1.passesIllustrative15PctHurdle, true);

  // Scenario 2: Tiny dust trade (0.01 SOL) where ATA creation makes hurdle excessive
  const hurdle2 = AllInBreakevenEngine.calculateHurdle({
    notionalSol: 0.01,
    needsAtaCreation: true,
    ataCreationLamports: 2_039_000n,
    ataRentRecoveryAssumption: 'NO_RECOVERY_ASSUMED',
    baseFeeLamports: 5_000n,
    computeUnitLimit: 200_000,
    priorityFeeMicroLamports: 10_000n,
    jitoTipLamports: 10_000n,
    lpFeeBps: 100,
    expectedSlippageBps: 150,
  });

  assert.equal(hurdle2.modeledHurdlePercentage > 20, true);
  assert.equal(hurdle2.passesIllustrative15PctHurdle, false);
  const hurdle3 = AllInBreakevenEngine.calculateHurdle({
    notionalSol: 0.01, needsAtaCreation: true, ataCreationLamports: 2_039_000n,
    ataRentRecoveryAssumption: 'RECOVER_ON_CLOSE', baseFeeLamports: 5_000n,
    computeUnitLimit: 200_000, priorityFeeMicroLamports: 10_000n,
    jitoTipLamports: 10_000n, lpFeeBps: 100, expectedSlippageBps: 150,
  });
  assert.equal(Math.round((hurdle2.totalModeledFrictionSol - hurdle3.totalModeledFrictionSol) * 1e9), 2_039_000);
});

test('AllInBreakevenEngine: priority fee uses supplied compute limit and rounds up to lamports', () => {
  const input = {
    notionalSol: 1,
    needsAtaCreation: false,
    baseFeeLamports: 10_000n,
    computeUnitLimit: 250_001,
    priorityFeeMicroLamports: 1n,
    jitoTipLamports: 0n,
    lpFeeBps: 0,
    expectedSlippageBps: 0,
  };
  const hurdle = AllInBreakevenEngine.calculateHurdle(input);
  assert.equal(hurdle.ataRentLockedSol, 0);
  assert.equal(hurdle.baseFeeSol, 0.00001);
  assert.equal(hurdle.priorityFeeSol, 0.000000001);
  assert.equal(AllInBreakevenEngine.calculateHurdle({ ...input, computeUnitLimit: 1_000_001 }).priorityFeeSol, 0.000000002);
  assert.throws(() => AllInBreakevenEngine.calculateHurdle({ ...input, computeUnitLimit: NaN }), /computeUnitLimit/);
  assert.throws(() => AllInBreakevenEngine.calculateHurdle({ ...input, notionalSol: Infinity }), /notionalSol/);
  assert.throws(() => AllInBreakevenEngine.calculateHurdle({ ...input, priorityFeeMicroLamports: -1n }), /priorityFeeMicroLamports/);
  assert.throws(() => AllInBreakevenEngine.calculateHurdle({ ...input, needsAtaCreation: true }), /ataCreationLamports/);
  assert.throws(() => AllInBreakevenEngine.calculateHurdle({ ...input, needsAtaCreation: true, ataCreationLamports: 1n }), /ataRentRecoveryAssumption/);
  assert.throws(() => AllInBreakevenEngine.calculateHurdle({ ...input, lpFeeBps: -1 }), /lpFeeBps/);
});

test('SimulationEnsembleEngine: synthetic scenario cannot be mistaken for simulation evidence', () => {
  const quote = 1_000_000_000n;
  const scenario = SimulationEnsembleEngine.evaluateEnsemble('intent_sim_1', quote);

  assert.equal(scenario.intentId, 'intent_sim_1');
  assert.equal(scenario.evidenceClass, 'RESEARCH_ONLY_SYNTHETIC');
  assert.equal(scenario.isSimulationCertificate, false);
  assert.equal(scenario.scenarioId.startsWith('research_scenario_'), true);
  assert.equal(scenario.quoteTokens, quote);
  assert.equal(scenario.neutralTokens, 980_000_000n);
  assert.equal(scenario.worstCaseTokens, 930_000_000n);
  assert.equal(scenario.hash.length, 64);
  assert.equal('certificateId' in scenario, false);
  assert.equal('expectedPriceImpactBps' in scenario, false);
  const boundPayload = JSON.stringify([
    scenario.evidenceClass, scenario.isSimulationCertificate, scenario.intentId,
    scenario.timestampMs, scenario.quoteTokens.toString(), scenario.assumedNeutralImpactBps,
    scenario.assumedWorstCaseImpactBps, scenario.neutralTokens.toString(), scenario.worstCaseTokens.toString(),
  ]);
  assert.equal(scenario.hash, createHash('sha256').update(boundPayload).digest('hex'));
  const tampered = JSON.stringify([
    scenario.evidenceClass, scenario.isSimulationCertificate, scenario.intentId,
    scenario.timestampMs, (scenario.quoteTokens + 1n).toString(), scenario.assumedNeutralImpactBps,
    scenario.assumedWorstCaseImpactBps, scenario.neutralTokens.toString(), scenario.worstCaseTokens.toString(),
  ]);
  assert.notEqual(scenario.hash, createHash('sha256').update(tampered).digest('hex'));
  assert.throws(() => SimulationEnsembleEngine.evaluateEnsemble('intent_sim_1', -1n), /quoteTokens/);
  assert.throws(() => SimulationEnsembleEngine.evaluateEnsemble('intent_sim_1', 0n), /quoteTokens/);

  // Divergence check: landed 970M vs simulated 980M -> ~1% divergence (acceptable)
  const d1 = SimulationEnsembleEngine.verifyLandingResidual(980_000_000n, 970_000_000n);
  assert.equal(d1.isAcceptable, true);
  assert.equal(d1.divergencePct < 2.0, true);

  // Divergence check: landed 800M vs simulated 980M -> >15% divergence (unacceptable!)
  const d2 = SimulationEnsembleEngine.verifyLandingResidual(980_000_000n, 800_000_000n);
  assert.equal(d2.isAcceptable, false);
  assert.equal(d2.divergencePct > 15.0, true);
});

test('SimulationEnsembleEngine: residual rejects undefined baseline and large precision traps', () => {
  assert.deepEqual(SimulationEnsembleEngine.verifyLandingResidual(0n, 0n), {
    divergencePct: Infinity,
    isAcceptable: false,
  });
  assert.throws(() => SimulationEnsembleEngine.verifyLandingResidual(-1n, 0n), /non-negative bigints/);
  assert.throws(() => SimulationEnsembleEngine.verifyLandingResidual(10n, -1n), /non-negative bigints/);
  const huge = 10n ** 80n;
  assert.equal(SimulationEnsembleEngine.verifyLandingResidual(huge, huge * 9n / 10n).isAcceptable, true);
  assert.equal(SimulationEnsembleEngine.verifyLandingResidual(huge, huge * 9n / 10n - 1n).isAcceptable, false);
});
