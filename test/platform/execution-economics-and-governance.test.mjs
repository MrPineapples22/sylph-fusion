import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createEffectSpec,
  TransactionSemanticFirewall,
  RealSlippageObservatory,
  ExecutableAlphaCompiler,
  RealizedEdgeLedger,
  CapabilityRegistry,
  CounterexampleMemory,
} from '../../dist/platform/pipeline/index.js';

test('TRANSACTION SAFETY: EffectSpec and ProofCarryingTransaction enforce byte and root integrity', () => {
  const effectSpec = createEffectSpec({
    intentId: 'intent_tx_001',
    mint: 'MintToken123',
    destination: 'DestTokenAta123',
    programIds: ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],
    writableAccounts: ['AccountA', 'AccountB'],
    maxDebitLamports: 1_000_000_000n,
    expectedTokenOutputRaw: 5_000_000n,
    maxSlippageBps: 250,
    maxPriorityFeeLamports: 100_000n,
    maxJitoTipLamports: 50_000n,
  });

  assert.equal(typeof effectSpec.effectSpecHash, 'string');
  assert.equal(effectSpec.effectSpecHash.length, 64);

  const messageBytes = new Uint8Array([1, 2, 3, 4, 5]);
  const messageHash = createHash('sha256').update(messageBytes).digest('hex');

  const proofPackage = {
    transactionBytes: new Uint8Array([10, 20, 30]),
    messageBytes,
    messageHash,
    effectSpec,
    evidenceRoot: 'ev_root_001',
    decisionRoot: 'dec_root_001',
    riskRoot: 'risk_root_001',
    capitalRoot: 'cap_root_001',
    authorityRoot: 'auth_root_001',
    verificationCertificateId: 'cert_verif_001',
  };

  const verification = TransactionSemanticFirewall.verifyProofPackage(proofPackage);
  assert.equal(verification.valid, true);
  assert.equal(typeof verification.packageHash, 'string');

  // Tampered message hash fails
  const tamperedMessage = TransactionSemanticFirewall.verifyProofPackage({
    ...proofPackage,
    messageHash: 'tampered_hash_000000000000000000000000000000000000000000000000000000',
  });
  assert.equal(tamperedMessage.valid, false);
  assert.match(tamperedMessage.error, /MESSAGE_HASH_MISMATCH/);

  // Tampered effect spec fails
  const tamperedEffect = TransactionSemanticFirewall.verifyProofPackage({
    ...proofPackage,
    effectSpec: {
      ...effectSpec,
      maxDebitLamports: 999_999_999n, // modified debit!
    },
  });
  assert.equal(tamperedEffect.valid, false);
  assert.match(tamperedEffect.error, /EFFECT_SPEC_TAMPERED/);
});

test('EXECUTION ECONOMICS: RealSlippageObservatory rejects fallbacks and decomposes execution loss', () => {
  const observatory = new RealSlippageObservatory();

  // Reject fallback
  assert.throws(() => {
    // @ts-ignore
    observatory.recordSample({
      sampleId: 's1',
      mint: 'm1',
      quotePriceSol: 0.001,
      quoteTimestampMs: Date.now(),
      quoteSlot: 100n,
      landedPriceSol: 0.00105,
      landedSlot: 102n,
      expectedSlippageBps: 20,
      realizedSlippageBps: 50,
      tokensTradedRaw: 1000n,
      feeLamports: 5000n,
      priorityFeeLamports: 10000n,
      jitoTipLamports: 20000n,
      rentLamports: 0n,
      route: 'pump',
      transport: 'rpc',
      isFallBack: true, // Should throw
    });
  }, /EMPIRICAL_VIOLATION/);

  // Insufficient samples throws on getEmpiricalMeanSlippageBps()
  assert.equal(observatory.isEmpirical(), false);
  assert.throws(() => observatory.getEmpiricalMeanSlippageBps(), /EMPIRICAL_DEFICIT/);

  // Add 10 valid empirical samples
  for (let i = 0; i < 10; i++) {
    observatory.recordSample({
      sampleId: `s_${i}`,
      mint: 'm1',
      quotePriceSol: 0.001,
      quoteTimestampMs: Date.now() - 500,
      quoteSlot: 100n + BigInt(i),
      landedPriceSol: 0.00102,
      landedSlot: 102n + BigInt(i),
      expectedSlippageBps: 15,
      realizedSlippageBps: 20,
      tokensTradedRaw: 1000n,
      feeLamports: 5000n,
      priorityFeeLamports: 10000n,
      jitoTipLamports: 20000n,
      rentLamports: 0n,
      route: 'pump',
      transport: 'jito',
      isFallBack: false,
    });
  }

  assert.equal(observatory.isEmpirical(), true);
  assert.equal(observatory.getEmpiricalMeanSlippageBps(), 20);

  // Loss decomposition
  const loss = RealSlippageObservatory.decomposeExecutionLoss({
    quotedPriceSol: 0.001,
    landedPriceSol: 0.00105,
    tokensTradedRaw: 1_000_000n,
    solTradedLamports: 1_000_000_000n, // 1 SOL
    priorityFeeLamports: 50_000n,
    jitoTipLamports: 100_000n,
    baseFeeLamports: 5_000n,
    quoteAgeMs: 400,
  });

  assert.ok(loss.totalExecutionLossLamports > 0n);
  assert.equal(
    loss.priorityAndTipCostLamports,
    155_000n // 50k + 100k + 5k
  );
});

test('EXECUTABLE ALPHA: ExecutableAlphaCompiler produces CertifiedExecutableAlpha with exact integer lamports', () => {
  const profitableInput = {
    opportunityId: 'opp_alpha_001',
    expectedEconomicDeltaLamports: 10_000_000n, // +0.01 SOL expected gross
    baseFeeLamports: 5_000n,
    priorityFeeLamports: 100_000n,
    jitoTipLamports: 200_000n,
    expectedSlippageLamports: 500_000n,
    selfImpactLamports: 100_000n,
    failureCostLamports: 50_000n,
    capitalTimeCostLamports: 20_000n,
    verificationCostLamports: 5_000n,
    uncertaintyPenaltyLamports: 100_000n,
    landingProbabilityBps: 9000, // 90%
  };

  const compiled = ExecutableAlphaCompiler.compile(profitableInput);
  assert.equal(compiled.isExecutable, true);
  assert.ok(compiled.certifiedExecutableAlphaLamports > 0n);
  assert.equal(typeof compiled.certificateHash, 'string');
  assert.equal(compiled.certificateHash.length, 64);

  // High friction / low probability opportunity -> not executable
  const unprofitable = ExecutableAlphaCompiler.compile({
    ...profitableInput,
    expectedEconomicDeltaLamports: 500_000n, // low delta
    landingProbabilityBps: 2000, // 20%
  });
  assert.equal(unprofitable.isExecutable, false);
  assert.ok(unprofitable.certifiedExecutableAlphaLamports <= 0n);
});

test('REALIZED EDGE LEDGER: tracks stage leakage and attributes causal loss', () => {
  const ledger = new RealizedEdgeLedger();

  const record = ledger.append({
    economicFactId: 'fact_edge_001',
    mint: 'MintTokenX',
    stages: {
      predictedEdgeLamports: 10_000_000n,
      decisionEdgeLamports: 9_000_000n,
      submissionEdgeLamports: 8_500_000n,
      landingEdgeLamports: 6_000_000n,
      settlementEdgeLamports: 5_800_000n,
      realizedNetEdgeLamports: 5_500_000n,
    },
    feesAndTipsLamports: 300_000n,
    slippageAndImpactLamports: 2_500_000n,
    capitalTimeAndFrictionLamports: 50_000n,
  });

  assert.equal(record.economicFactId, 'fact_edge_001');
  assert.equal(record.leakage.totalEdgeLeakageLamports, 4_500_000n); // 10M - 5.5M
  assert.equal(record.primaryLeakageCause, 'SLIPPAGE_IMPACT');
  assert.equal(ledger.count(), 1);
});

test('RESEARCH GOVERNANCE: CapabilityRegistry and CounterexampleMemory enforce epistemic safety', () => {
  const registry = new CapabilityRegistry();

  // JEV and MULTIPLIER-X are strictly INFER
  const jev = registry.getModel('jev-rule-v0');
  assert.ok(jev);
  assert.equal(jev.authority, 'INFER');
  assert.equal(jev.trainingStatus, 'RULE_BASED');

  const mx = registry.getModel('multiplier-x');
  assert.ok(mx);
  assert.equal(mx.authority, 'INFER');
  assert.equal(mx.validationStatus, 'RESEARCH_ONLY');

  // Attempting to register model with AUTHORIZE authority is blocked
  assert.throws(() => {
    registry.registerModel({
      modelId: 'rogue-model',
      modelVersion: '1.0',
      trainingStatus: 'TRAINED',
      calibrationStatus: 'EMPIRICALLY_CALIBRATED',
      validationStatus: 'RESEARCH_ONLY',
      // @ts-ignore
      authority: 'AUTHORIZE',
    });
  }, /EPISTEMIC_VIOLATION/);

  // Counterexample Memory contains known catastrophic classes
  const memory = new CounterexampleMemory();
  const falseNoLands = memory.getByClass('FALSE_NOLAND');
  assert.ok(falseNoLands.length >= 1);
  assert.equal(falseNoLands[0].failureClass, 'FALSE_NOLAND');
  assert.ok(falseNoLands[0].recordHash.length === 64);
});
