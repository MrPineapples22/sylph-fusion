import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SemanticRealityLayer,
  MarketAuthenticityEngine,
  PointInTimeFeatureCompiler,
} from '../../dist/platform/pipeline/index.js';

test('SEMANTIC REALITY: safe Token-2022 mint produces valid semantic roots and permits execution', () => {
  const layer = new SemanticRealityLayer();

  const token2022 = {
    hasTransferHook: true,
    hookProgramId: 'HookSafeProgram1111111111111111111111111111',
    isHookVerifiedSafe: true, // Verified safe
    hasPermanentDelegate: false,
    hasTransferFee: true,
    transferFeeBasisPoints: 50, // 0.5% (well within 10% limit)
    maximumFeeLamports: 5000000n,
    isDefaultAccountStateFrozen: false,
  };

  const result = layer.resolveSemanticReality(
    '9dSMwFfPezQ8WPcW1uZV7ns4rcviEj2LssSAg75WBLXd',
    token2022,
    undefined,
    undefined,
    '2026-10-03T20:00:00.000Z'
  );

  assert.equal(result.isPermittedForExecution, true);
  assert.equal(result.quarantineReason, undefined);
  assert.equal(typeof result.semanticStateRoot, 'string');
  assert.equal(result.semanticStateRoot.length, 64);
  assert.equal(result.tokenSemanticsRoot.length, 64);
});

test('SEMANTIC REALITY: permanent delegate triggers safety veto and quarantine', () => {
  const layer = new SemanticRealityLayer();

  const maliciousToken = {
    hasTransferHook: false,
    hasPermanentDelegate: true, // Malicious seizure risk!
    permanentDelegateAddress: 'DelegateBadActor1111111111111111111111111111',
    hasTransferFee: false,
  };

  const result = layer.resolveSemanticReality(
    'MaliciousTokenMint111111111111111111111111111',
    maliciousToken
  );

  assert.equal(result.isPermittedForExecution, false);
  assert.ok(result.quarantineReason?.includes('PERMANENT_DELEGATE_DETECTED'));
});

test('SEMANTIC REALITY: unverified transfer hook triggers quarantine', () => {
  const layer = new SemanticRealityLayer();

  const unverifiedHookToken = {
    hasTransferHook: true,
    hookProgramId: 'UnknownHookProgram111111111111111111111111',
    isHookVerifiedSafe: false, // Unverified!
    hasPermanentDelegate: false,
    hasTransferFee: false,
  };

  const result = layer.resolveSemanticReality(
    'UnverifiedHookMint111111111111111111111111111',
    unverifiedHookToken
  );

  assert.equal(result.isPermittedForExecution, false);
  assert.ok(result.quarantineReason?.includes('UNVERIFIED_TRANSFER_HOOK'));
});

test('MARKET AUTHENTICITY: identifies Sybil recirculation and scales authentic volume', () => {
  const engine = new MarketAuthenticityEngine();

  const rawVolume = 100000000000n; // 100 SOL reported
  const actors = [
    {
      walletAddress: 'WalletRealUser1',
      buyVolumeLamports: 30000000000n,
      sellVolumeLamports: 10000000000n,
      isSybilClusterMember: false,
    },
    {
      walletAddress: 'WalletSybilClusterA',
      fundingParentAddress: 'CommonCreatorWallet',
      buyVolumeLamports: 30000000000n,
      sellVolumeLamports: 30000000000n,
      isSybilClusterMember: true, // Recirculating wash trader!
    },
  ];

  const result = engine.evaluateAuthenticity(
    'TokenMintTest1111111111111111111111111111111',
    rawVolume,
    actors,
    50000000000n,
    '2026-10-03T20:00:00.000Z'
  );

  // Recirculated = 30 + 30 = 60 SOL (60%)
  // Authentic = 100 - 60 = 40 SOL
  assert.equal(result.recirculationRatioPct, 60);
  assert.equal(result.authenticVolumeLamports, 40000000000n);
  assert.equal(result.authenticityScore, 40);
  assert.equal(result.isAuthentic, false); // Fails >= 80% threshold
  assert.equal(result.authenticityRoot.length, 64);
  assert.equal(result.actorGraphRoot.length, 64);
  assert.equal(result.marketStateRoot.length, 64);
});

test('POINT-IN-TIME FEATURE SNAPSHOT: enforces knownAt <= decisionAt and generates snapshot root', () => {
  const compiler = new PointInTimeFeatureCompiler();

  const validInput = {
    economicFactId: 'fact_feature_001',
    slot: 1000n,
    knownAt: '2026-10-03T20:00:00.000Z',
    decisionAt: '2026-10-03T20:00:01.000Z', // Decision after observation
    hsiScore: 88,
    pumpScore: 75,
    podScore: 82,
    regime: 'EXPONENTIAL_EXPANSION',
    authenticityScore: 92,
    localizedContentionBps: 250,
    leaderAffinityScore: 85,
    featureVersions: { hsi: '2.1.0', pump: '1.4.0' },
  };

  const snapshot = compiler.compileFeatureSnapshot(validInput);

  assert.equal(typeof snapshot.featureSnapshotRoot, 'string');
  assert.equal(snapshot.featureSnapshotRoot.length, 64);
  assert.equal(snapshot.economicFactId, 'fact_feature_001');

  // Lookahead bias test: knownAt in future relative to decisionAt must throw!
  assert.throws(() => {
    compiler.compileFeatureSnapshot({
      ...validInput,
      knownAt: '2026-10-03T20:00:05.000Z', // 4 seconds after decisionAt!
      decisionAt: '2026-10-03T20:00:01.000Z',
    });
  }, /LOOKAHEAD_BIAS_ERROR/);
});
