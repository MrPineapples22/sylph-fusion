import { TokenLifecycleOmegaAuthority } from '../dist/platform/lifecycle/token-lifecycle-omega.js';
import { NumeraireAuthority, asLamports } from '../dist/platform/ledger/numeraire.js';
import { SentinelAltAuthority } from '../dist/platform/security/sentinel-alt.js';
import { SimulacrumXEngine } from '../dist/platform/simulation/simulacrum-x.js';
import { LabelForgeAuthority } from '../dist/intelligence/science/labelforge.js';
import { HelixStrategyCanaryAuthority } from '../dist/intelligence/control/helix-strategy-canary.js';
import { AirgapRAuthority, AirgapSecurityViolationError } from '../dist/platform/security/airgap-r.js';
import { TribunalAuthority } from '../dist/platform/control/tribunal.js';
import { TreasuryShieldAuthority } from '../dist/platform/ledger/treasury-shield.js';
import { QuorumRootAuthority } from '../dist/platform/ingestion/quorum-root.js';
import { ControlRootKernel, createConfigSeal, signCommandEnvelope } from '../dist/platform/control/command-seal.js';
import { ExecutionWitnessAuthority, WitnessInvariantViolationError, createCapitalEnvelope } from '../dist/platform/execution/execution-witness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideExit, protectiveStop } from '../dist/exit-policy.js';
import { checkAntiSniperAndDexAsymmetry } from '../dist/risk.js';
import { normalizePairs } from '../dist/market-hub.js';
import { WalletRelationshipGraph } from '../dist/platform/security/wallet-graph.js';
import { ContinuationQualityEngine } from '../dist/intelligence/signals/pumpscore.js';
import { PhaseTransitionDetector } from '../dist/intelligence/signals/phase-transition.js';
import { PlattSigmoidCalibrator } from '../dist/intelligence/science/calibrator.js';
import { EntryTimingEngine } from '../dist/intelligence/spie/entry-timing.js';
import { DynamicExitEngine } from '../dist/intelligence/spie/dynamic-exits.js';
import { UnifiedDecisionBuilder } from '../dist/intelligence/decision/unified-decision.js';
import { SpieEngine } from '../dist/intelligence/spie/spie-engine.js';
import { calculateOptimalBuyPositionValue } from '../dist/intelligence/execution/position-sizer.js';

test('CHAOS-001: Anti-Sniper Baseline blocks tokens at age < 10s with < 3 unique buyers', () => {
  const result1 = checkAntiSniperAndDexAsymmetry({ ageMs: 4000, uniqueBuyers: 2, isDex: false });
  assert.equal(result1.allowed, false);
  assert.match(result1.reason, /ANTI_SNIPER_BASELINE_NOT_MET/);

  // Mature token or >= 3 buyers passes anti-sniper baseline
  const result2 = checkAntiSniperAndDexAsymmetry({ ageMs: 12000, uniqueBuyers: 4, isDex: false });
  assert.equal(result2.allowed, true);

  // Mature DEX token bypasses the buyer count check (asymmetry rule)
  const result3 = checkAntiSniperAndDexAsymmetry({ ageMs: 3000, uniqueBuyers: 1, isDex: true });
  assert.equal(result3.allowed, true);
});

test('CHAOS-002: DexScreener Multi-Pair Liquidity Priority prioritizes active DEX over defunct bonding curve', () => {
  const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const rawPairs = [
    {
      chainId: 'solana',
      dexId: 'pumpfun',
      baseToken: { address: mint, symbol: 'TGT', name: 'Target' },
      priceUsd: '0.001',
      liquidity: null, // defunct curve
      marketCap: 10000,
    },
    {
      chainId: 'solana',
      dexId: 'raydium',
      baseToken: { address: mint, symbol: 'TGT', name: 'Target' },
      priceUsd: '0.005',
      liquidity: { usd: 45000 }, // active DEX
      marketCap: 500000,
    }
  ];

  const normalized = normalizePairs(rawPairs);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].mint, mint);
  assert.equal(normalized[0].dex, 'raydium');
  assert.equal(normalized[0].liquidity, 45000);
  assert.equal(normalized[0].price, 0.005);
});

test('CHAOS-003: Dynamic Staged Trailing Stops protect 1500% moonshot runners from choking', () => {
  const entry = 100;

  // 1. For a 100% gain (peak = 200, peakRatio = 2.0): 30% structural trail allows 20% pullback
  const stopAt2x = protectiveStop({ entry, peak: 200, stopBps: 1200 });
  assert.ok(stopAt2x !== null);
  // Mark pulls back 20% to 160: with stage: 3 (prior TPs taken), mark (160) > stop (150), so it HOLDS
  assert.equal(stopAt2x <= 150, true);
  assert.equal(decideExit({ entry, peak: 200, mark: 160, stage: 3, openedAt: 1000, now: 30000, stopBps: 1200 }), null);

  // 2. For a 500%+ moonshot (peak = 700, peakRatio = 7.0): 40% structural trail allows 35% pullback
  const stopAt7x = protectiveStop({ entry, peak: 700, stopBps: 1200 });
  assert.ok(stopAt7x !== null);
  // Stop is Math.max(400, 700 * 0.60) = 420. Mark at 450 (down 35% from peak) should HOLD
    // With stage: 4 (all 4 TP tranches taken), only moonbag structural trailing stop applies.
  // Stop is Math.max(400, 700 * 0.60) = 420. Mark at 450 (down 35% from peak) should HOLD
  assert.equal(decideExit({ entry, peak: 700, mark: 450, stage: 4, openedAt: 1000, now: 60000, stopBps: 1200 }), null);
  // Mark breached below 420 triggers TRAILING_PROFIT
  assert.equal(decideExit({ entry, peak: 700, mark: 410, stage: 4, openedAt: 1000, now: 60000, markAt: 60000, stopBps: 1200 })?.reason, 'TRAILING_PROFIT');
});

test('CHAOS-004: Sybil Bundle & Circular Wash Trading Detection flags shared funder clusters', () => {
  const graph = new WalletRelationshipGraph();
  const mint = 'WashToken11111111111111111111111111111111111';
  const creator = 'CreatorWallet11111111111111111111111111111111';
  const commonFunder = 'RootSybilFunder11111111111111111111111111111';

  graph.registerToken(mint, creator, commonFunder);

  // Register 5 buyer wallets, 4 of which were funded by commonFunder
  for (let i = 1; i <= 4; i++) {
    const buyer = `SybilBuyer${i}1111111111111111111111111111111111111`;
    graph.recordBuyer(mint, buyer);
    // Associate buyer with common funder
    const node = graph['nodes'].get(buyer);
    if (node) node.fundingParent = commonFunder;
  }
  graph.recordBuyer(mint, 'OrganicBuyer11111111111111111111111111111111111');

  const assessment = graph.detectWashTrading(mint);
  assert.equal(assessment.isWashTradingSuspected, true);
  assert.ok(assessment.sharedFundingRatio >= 0.75);
});

test('CHAOS-005: Continuation Quality strictly penalizes < 5 unique buyers on bonding curves', () => {
  const cqEngine = new ContinuationQualityEngine();

  // 1. Only 3 unique buyers: must be blocked as illiquid pump-fake
  const illiquidResult = cqEngine.evaluateCQ({
    buyerAbsorptionRatio: 0.90,
    sellerExhaustionRatio: 0.90,
    uniqueBuyers: 3,
    isDex: false,
  });
  assert.equal(illiquidResult.isIlliquidBlocked, true);
  assert.equal(illiquidResult.tier, 'POOR');

  // 2. 12 unique buyers with strong absorption: excellent CQ
  const liquidResult = cqEngine.evaluateCQ({
    buyerAbsorptionRatio: 0.85,
    sellerExhaustionRatio: 0.80,
    uniqueBuyers: 12,
    isDex: false,
  });
  assert.equal(liquidResult.isIlliquidBlocked, false);
  assert.ok(liquidResult.score >= 0.70);
});

test('CHAOS-006: Platt Sigmoid Calibration and Log-Transform Peak Inversion', () => {
  // Platt scaling maps logit into [0, 1] smoothly
  const prob1 = PlattSigmoidCalibrator.calibrate(0.0);
  assert.equal(prob1, 0.5);

  const prob2 = PlattSigmoidCalibrator.calibrate(2.0, -1.5, 0.0);
  assert.ok(prob2 > 0.90);

  // Inverse log-transform: log1p(y) reversed via expm1
  // If target peak was 3.0 (+300% gain), log1p(3.0) = ~1.3863
  const logPred = Math.log1p(3.0);
  const reconstructed = PlattSigmoidCalibrator.inverseLogPeak(logPred);
  assert.ok(Math.abs(reconstructed - 3.0) < 0.01);
});

test('CHAOS-007: Anti-Top Climax Exhaustion detects runaway parabolic spike before pullback', () => {
  const et = new EntryTimingEngine();
  const evaluation = et.validateEntryFeasibility({
    mint: 'FastRun111111111111111111111111111111111111',
    realSolReserve: 5.0,
    priceVelocityBps: 5500, // +55% per second
    volumeVelocitySolSec: 2.5,
    sellPressureRatio: 0.15,
    retraceFromPeakPct: 0.01, // No pullback whatsoever
    smartWalletPresent: false,
    recentTxCount: 25,
    uniqueBuyerGrowthRate: 15,
    tokenAgeSeconds: 20, // Very young token in climax surge
  }, 500);

  assert.equal(evaluation.canEnter, false);
  assert.equal(evaluation.isClimaxExhaustion, true);
  assert.match(evaluation.reason, /ANTI_TOP_CLIMAX_EXHAUSTION/);
});

test('CHAOS-008: UnifiedOpportunityDecision synthesizes SPIE Net EV and audit criteria', () => {
  const spie = new SpieEngine();
  const evalResult = spie.evaluate({
    mint: 'PrimeMint111111111111111111111111111111111111',
    symbol: 'PRIME',
    realSolReserve: 15.0,
    factors: {
      tokenQuality: 0.85,
      momentum: 0.90,
      liquidityDepth: 0.85,
      participation: 0.80,
      walletQuality: 0.80,
      safety: 0.95,
      executionFeasibility: 0.85,
      regimeCompatibility: 0.80,
      timing: 0.80,
    }
  });

  const unified = UnifiedDecisionBuilder.fromSpieEvaluation('opp-100', 315000000, evalResult);
  assert.equal(unified.token, 'PrimeMint111111111111111111111111111111111111');
  assert.ok(unified.confidence > 0.60);
  assert.ok(unified.expectedNetEvBps > 0);
  assert.equal(unified.reasonsForAcceptance.length > 0, true);
});

test('CHAOS-009: Position Sizer scales down on high volatility and consecutive losses', () => {
  const baseSize = calculateOptimalBuyPositionValue(
    { highSignalIndex: 85, tier: 'PRIME', pod: 'UP', liquidity: 50000 },
    { cashUsd: 1000, activePositionsCount: 0, maxPositions: 3 }
  );

  const throttledSize = calculateOptimalBuyPositionValue(
    { highSignalIndex: 85, tier: 'PRIME', pod: 'UP', liquidity: 50000 },
    { cashUsd: 1000, activePositionsCount: 0, maxPositions: 3, consecutiveLossCount: 3, volatilityAtr: 0.15 }
  );

  assert.ok(throttledSize.optimalUsd < baseSize.optimalUsd);
  assert.ok(throttledSize.convictionMultiplier < baseSize.convictionMultiplier);
});


// ============================================================================
// SYLPH FUSION — NEMESIS FAILURE INJECTION TESTS (Section 78 & Invariants)
// ============================================================================

import { KmsSigningStateMachine } from '../dist/platform/signing/durable-live-signer.js';
import { ClearingAuthority } from '../dist/platform/ledger/clearing.js';
import { LotRootAuthority } from '../dist/platform/ledger/lot-root.js';
import { StartSealAuthority } from '../dist/platform/lifecycle/start-seal.js';
import { EscapeRootAuthority } from '../dist/platform/execution/escape-root.js';
import { AuditRootAuthority } from '../dist/platform/recovery/audit-root.js';

test('NEMESIS-001: Crash during KMS dispatch locks intent and forbids duplicate signing (Section 78)', () => {
  let activeEpoch = 15;
  const fence = {
    getCurrentFenceEpoch: () => activeEpoch,
    isFenceValid: (epoch) => epoch === activeEpoch,
  };

  const sm = new KmsSigningStateMachine(fence);
  const intentId = 'intent-nemesis-kms-crash';

  sm.prepareIntent({
    economicIntentId: intentId,
    messageSha256: 'sha256-nemesis-msg',
    wallet: 'Wallet111111111111111111111111111111111111',
    fenceEpoch: 15,
  });
  sm.markInFlight(intentId, 15);

  // SIMULATED CRASH & REBOOT
  const recovery = sm.analyzeRecoveryState(intentId);
  assert.equal(recovery.stage, 'RECOVERY_AMBIGUOUS');
  assert.equal(recovery.canSafeRetry, false);
  assert.equal(recovery.requiresOnChainReconciliation, true);

  // Attempting to prepare the same intent again must be blocked!
  assert.throws(
    () => sm.prepareIntent({
      economicIntentId: intentId,
      messageSha256: 'sha256-nemesis-msg',
      wallet: 'Wallet111111111111111111111111111111111111',
      fenceEpoch: 15,
    }),
    /KMS_SIGNING_IN_FLIGHT_CONFLICT/
  );
});

test('NEMESIS-002: Crash during UNKNOWN transaction state holds capital 100% reserved (Invariant 1)', () => {
  const clearing = new ClearingAuthority();
  const intentId = 'intent-nemesis-unknown-crash';
  const reservedLamports = 2_000_000_000n; // 2 SOL

  clearing.reserveCapital(intentId, reservedLamports);

  // Crash during network timeout with unexpired blockheight
  const evaluation = clearing.evaluateTransactionStatus({
    intentId,
    signature: 'SigNemesisCrash111111111111111111111111111111',
    lastValidBlockHeight: 310000200,
    currentBlockHeight: 310000150, // Still within valid block range!
    independentCoverages: [],
    onChainWalletBalanceConfirmed: true,
  });

  assert.equal(evaluation.status, 'UNKNOWN_RESERVE_HELD');
  assert.equal(evaluation.capitalReleased, false);
  assert.equal(clearing.getReservedCapital(intentId), reservedLamports);
});

test('NEMESIS-003: Whole-wallet census detects external drift after node downtime (Section 20)', () => {
  const startSeal = new StartSealAuthority();
  startSeal.verifyRelease('sha256-valid', 'sha256-valid');
  startSeal.acquireFence(1);
  startSeal.advancePhase('PROVIDER_SYNC', 'ok');
  startSeal.advancePhase('JOURNAL_RECOVERY', 'ok');
  startSeal.advancePhase('PENDING_TX_RECONCILIATION', 'ok');

  // During downtime, an unsolicited token was transferred to the wallet
  const census = startSeal.executeWalletCensus({
    onChainAccounts: [
      {
        mint: 'UnsolicitedHackerToken',
        tokenProgram: 'TOKEN_PROGRAM',
        ataAddress: 'HackerAta',
        rawBalance: 1_000_000n,
      },
    ],
    localKnownPositions: {},
  });

  const unsolicited = census.find(i => i.mint === 'UnsolicitedHackerToken');
  assert.ok(unsolicited);
  assert.equal(unsolicited.classification, 'UNSOLICITED_TOKEN');
  assert.equal(unsolicited.requiresManualReview, true);

  startSeal.advancePhase('CAPITAL_CONSERVATION', 'ok');
  startSeal.advancePhase('TOKEN_SEMANTICS_REFRESH', 'ok');
  startSeal.advancePhase('EVENT_CATCHUP', 'ok');
  startSeal.advancePhase('REDUCE_ONLY', 'ok');
  startSeal.advancePhase('ENTRY_READY', 'ok');

  // StartSeal certificate MUST block entry!
  const cert = startSeal.generateSealCertificate('WalletTest', 10_000_000_000n);
  assert.equal(cert.isEntryPermitted, false);
  assert.equal(cert.discrepancyCount, 1);
});

test('NEMESIS-004: PositionLot conservation holds across partial scale-outs and restarts (Section 21)', () => {
  const lotRoot = new LotRootAuthority();
  const mint = 'NemesisMint1111111111111111111111111111111';

  // Buy 80k tokens
  lotRoot.addLot({
    mint,
    tokenQuantity: 80_000n,
    costBasisLamports: 800_000_000n,
    entryEconomicIntentId: 'intent-nemesis-lot',
  });

  // Partial 50% exit (40k sold)
  lotRoot.allocateExit(mint, 40_000n, 'FIFO');

  const proj = lotRoot.getPositionProjection(mint);
  assert.ok(proj);
  assert.equal(proj.totalRemainingQuantity, 40_000n);

  // Exact balance matches
  assert.ok(lotRoot.verifyConservation(mint, 40_000n).isConserved);
  // Any discrepancy fails conservation
  assert.equal(lotRoot.verifyConservation(mint, 39_999n).isConserved, false);
});

test('NEMESIS-005: Survival treasury halts new entries when emergency reserve is threatened (Section 25)', () => {
  const escapeRoot = new EscapeRootAuthority();

  // Low balance wallet (0.005 SOL left)
  const invariantCheck = escapeRoot.verifySurvivalTreasuryInvariant({
    currentLiquidSolLamports: 5_000_000n,
    proposedEntryCommitmentLamports: 4_500_000n,
    currentOpenPositionsCount: 2,
  });

  assert.equal(invariantCheck.isPermitted, false);
  assert.match(invariantCheck.reason, /SURVIVAL_TREASURY_INSUFFICIENT/);
});

test('NEMESIS-006: Tamper detection flags corrupted past records in audit hash chain (Section 69)', () => {
  const audit = new AuditRootAuthority();
  audit.appendEvent('TRADE_ENTERED', { mint: 'Mint1', amount: 100 });
  const rec2 = audit.appendEvent('TRADE_EXITED', { mint: 'Mint1', pnl: 25 });
  audit.appendEvent('RESERVE_SETTLED', { mint: 'Mint1', settled: true });

  assert.equal(audit.verifyChainIntegrity().isChainValid, true);

  // Corrupt record 2 payload
  Object.assign(rec2, { payload: { mint: 'Mint1', pnl: 9999999 } });

  const auditCheck = audit.verifyChainIntegrity();
  assert.equal(auditCheck.isChainValid, false);
  assert.equal(auditCheck.brokenSequenceNumber, 2);
});

test('NEMESIS-007: Stale Fence Epoch Signing Attack is strictly blocked (Section 42 & Invariant 4)', () => {
  const bundle = { execution: {}, risk: {}, tokenPolicy: {}, providerConfig: {}, signerConfig: {}, modelConfig: {}, feePolicy: {}, jitoPolicy: {}, capitalLimits: {} };
  const seal = createConfigSeal(1, bundle);
  const kernel = new ControlRootKernel({
    initialFenceEpoch: 42,
    initialConfigSeal: seal,
    currentReleaseRoot: 'REL-1.0.0'
  });
  kernel.registerOperator({ operatorId: 'OP1', role: 'OPERATOR', secretOrKey: 'key1' });

  // Node lease expires; cluster advances epoch to 43
  kernel.advanceFenceEpoch(43);

  // Stale node tries to issue command with old fence 42
  const env = signCommandEnvelope({
    commandId: 'STALE-FENCE-CMD',
    operatorId: 'OP1',
    role: 'OPERATOR',
    action: 'OPEN_POSITION',
    payload: { mint: 'TargetMint' },
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + 5000,
    nonce: 'NONCE-STALE-1',
    controlEpoch: 1,
    fenceEpoch: 42, // Stale!
    releaseRoot: 'REL-1.0.0',
    configRoot: seal.bundleHash,
    expectedStateRoot: 'ROOT-1'
  }, 'key1');

  const check = kernel.verifyAndAuthorizeCommand(env, 'ROOT-1', Date.now());
  assert.equal(check.authorized, false);
  assert.match(check.reason, /STALE FENCE REJECTION/);
});

test('NEMESIS-008: QuorumRoot strictly flags provider disagreement as CONFLICTED (Section 11)', () => {
  const quorum = new QuorumRootAuthority();
  quorum.registerProvider({
    providerId: 'RPC_A',
    operator: 'OP_A',
    infrastructureRegion: 'us-east',
    administrativeOwner: 'A',
    correlationGroup: 'GRP_A',
    dataSource: 'GEODISTRIBUTED_RPC'
  });
  quorum.registerProvider({
    providerId: 'RPC_B',
    operator: 'OP_B',
    infrastructureRegion: 'eu-west',
    administrativeOwner: 'B',
    correlationGroup: 'GRP_B',
    dataSource: 'DIRECT_VALIDATOR_TPU'
  });

  const cert = quorum.evaluateFactQuorum({
    factKey: 'CRITICAL_PRICE:MINT_XYZ',
    slot: 289450000,
    observations: [
      { factKey: 'CRITICAL_PRICE:MINT_XYZ', slot: 289450000, timestampMs: Date.now(), providerId: 'RPC_A', value: 1.0, valueDigest: 'hash_1_0' },
      { factKey: 'CRITICAL_PRICE:MINT_XYZ', slot: 289450000, timestampMs: Date.now(), providerId: 'RPC_B', value: 2.0, valueDigest: 'hash_2_0' }
    ]
  });

  // Never average conflicting facts! Must be CONFLICTED
  assert.equal(cert.status, 'CONFLICTED');
  assert.equal(cert.consensusValue, undefined);
  assert.match(cert.conflictDetails, /Evidence disagreement detected/);
});

test('NEMESIS-009: Unsimulated witness mutation attack triggers fail-closed violation (Invariants 6, 7)', () => {
  const authority = new ExecutionWitnessAuthority();
  const envelope = createCapitalEnvelope({
    economicIntentId: 'INTENT-999',
    inputPrincipalLamports: 10000000n,
    exactNetworkFeeLamports: 5000n,
    priorityFeeLamports: 5000n,
    jitoTipLamports: 10000n,
    protocolFeeLamports: 0n,
    creatorFeeLamports: 0n,
    rentReservationLamports: 0n,
    protocolMaintenanceLamports: 0n
  });

  const witness = authority.registerBuiltTransaction({
    economicIntentId: 'INTENT-999',
    exactMessageHash: 'hash_msg',
    blockhash: 'bh_1',
    lastValidBlockHeight: 289450500,
    accountKeys: ['K1'],
    programIds: ['P1'],
    computeUnitsLimit: 200000,
    altCertificates: [],
    capitalEnvelope: envelope,
    stateLease: { leaseId: 'L1', snapshotSlot: 1, simulationSlot: 1, criticalAccountHashes: {}, leasedAtMs: Date.now(), maxAgeMs: 5000 },
    modelEpoch: 'EPOCH-1'
  });

  // Attempting to sign without simulation MUST throw
  assert.throws(
    () => authority.markSigned(witness.witnessId, Date.now()),
    WitnessInvariantViolationError,
    'Must not sign unsimulated transaction'
  );
});

test('NEMESIS-010: Config update invalidates all pending risk-increasing permits (Section 46)', () => {
  const bundle = { execution: {}, risk: { maxExposure: 100 }, tokenPolicy: {}, providerConfig: {}, signerConfig: {}, modelConfig: {}, feePolicy: {}, jitoPolicy: {}, capitalLimits: {} };
  const seal = createConfigSeal(1, bundle);
  const kernel = new ControlRootKernel({
    initialFenceEpoch: 1,
    initialConfigSeal: seal,
    currentReleaseRoot: 'REL-1.0.0'
  });
  kernel.registerOperator({ operatorId: 'OP1', role: 'OPERATOR', secretOrKey: 'key1' });

  // Prepare OPEN command under config epoch 1
  const env = signCommandEnvelope({
    commandId: 'STALE-CONFIG-CMD',
    operatorId: 'OP1',
    role: 'OPERATOR',
    action: 'OPEN_POSITION',
    payload: { mint: 'Mint123' },
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + 5000,
    nonce: 'NONCE-STALE-CFG-1',
    controlEpoch: 1,
    fenceEpoch: 1,
    releaseRoot: 'REL-1.0.0',
    configRoot: seal.bundleHash,
    expectedStateRoot: 'ROOT-1'
  }, 'key1');

  // Config updated by operator
  kernel.updateConfiguration({ ...bundle, risk: { maxExposure: 50 } });

  // Obsolete config root rejected
  const check = kernel.verifyAndAuthorizeCommand(env, 'ROOT-1', Date.now());
  assert.equal(check.authorized, false);
  assert.match(check.reason, /CONFIG STALENESS VIOLATION/);
});

test('NEMESIS-011: Curve graduation during active position preserves holding and avoids false-zero panic stops (Upgrade 2)', () => {
  const lifecycle = new TokenLifecycleOmegaAuthority();
  const cert = lifecycle.transitionLifecycle('MintGraduating', {
    evidenceId: 'EV-MIG-1',
    slot: 289450000,
    timestampMs: Date.now(),
    source: 'YELLOWSTONE_FEED',
    details: 'Bonding curve completed on chain'
  }, 'COMPLETE_UNMIGRATED');

  assert.equal(cert.valuationStatus, 'UNPRICED_MIGRATING');
  assert.equal(cert.isHoldingPreserved, true);
  assert.equal(cert.isTradingAllowed, false);
});

test('NEMESIS-012: Financial conservation discrepancy of even 1 lamport triggers fatal violation (Upgrade 3)', () => {
  const state = {
    openingCapital: asLamports(1_000_000_000n),
    externalDeposits: asLamports(0n),
    externalWithdrawals: asLamports(0n),
    realizedEconomicResult: asLamports(0n),
    availableBalance: asLamports(1_000_000_001n), // 1-lamport discrepancy
    reservedCapital: asLamports(0n),
    deployedInPositions: asLamports(0n),
    pendingSettlement: asLamports(0n)
  };

  assert.throws(
    () => NumeraireAuthority.assertConservation(state),
    /NUMERAIRE CONSERVATION VIOLATION: Discrepancy of -1 lamports detected!/
  );
});

test('NEMESIS-013: Post-review compute budget alteration triggers TRANSACTION_IDENTITY_DRIFT (Upgrade 7)', () => {
  const graphA = {
    transactionVersion: 'V0',
    feePayer: 'Payer1',
    staticAccountKeys: ['Payer1'],
    writableAccountKeys: ['Payer1'],
    signerAccountKeys: ['Payer1'],
    programIds: ['Prog1'],
    addressLookupTables: [],
    resourceBudget: { computeUnitLimit: 100_000, computeUnitPriceMicroLamports: 10_000n, totalSerializedBytes: 200 }
  };
  const graphB = {
    ...graphA,
    resourceBudget: { ...graphA.resourceBudget, computeUnitLimit: 150_000 }
  };

  assert.throws(
    () => SentinelAltAuthority.assertGraphIntegrity(graphA, graphB),
    /TRANSACTION_IDENTITY_DRIFT/
  );
});

test('NEMESIS-014: Actual fill deviating by > 15% triggers SIMULATION_MODEL_DRIFT (Upgrade 1)', () => {
  const engine = new SimulacrumXEngine();
  const cert = engine.simulateExecution({
    slot: 1, blockhash: 'b1', quoteSlot: 1, virtualSolReserves: 30_000_000_000n, virtualTokenReserves: 1_000_000_000n,
    walletSolBalanceLamports: 10_000_000_000n, walletTokenBalanceRaw: 0n, isAmmActive: false,
    writableAccountContentionScore: 0.1, expectedLandingLatencySlots: 1, marketVelocityBpsPerSecond: 10
  }, {
    economicIntentId: 'I-1', side: 'BUY', inputAmountLamports: 100_000_000n, baseNetworkFeeLamports: 5000n,
    priorityFeeLamports: 5000n, jitoTipLamports: 10000n, rentLamports: 0n, maxAllowedSlippageBps: 100, transactionVersion: 'V0'
  });

  const report = engine.evaluateResiduals(cert, (cert.netExecutableProceedsLamports * 70n) / 100n);
  assert.equal(report.isModelDriftDetected, true);
  assert.match(report.details, /SIMULATION_MODEL_DRIFT/);
});

test('NEMESIS-015: Feature arrival after decision time triggers FUTURE_FEATURE_LEAKAGE (Upgrade 4)', () => {
  assert.throws(
    () => LabelForgeAuthority.certifyExample({
      tokenMint: 'M1', creatorIdentity: 'C1', funderClusterId: 'F1', candidateGenerationId: 'G1',
      decisionTimestampMs: 1000, decisionSlot: 1, targetTimestampMs: 2000,
      featureAvailableAtMs: 1050, // Future feature!
      featureSnapshotHash: 'h1', featureSchemaVersion: '1', modelVersion: 'm1', strategyVersion: 's1', configurationHash: 'cfg1',
      actionTaken: 'BUY', actionProbability: 0.9, eventualFinalLabel: 1, labelFinality: 'ECONOMIC_FINAL',
      outcomeEvidenceIds: [], realizedGrossPnlLamports: 0n, realizedNetPnlLamports: 0n, frictionFeesLamports: 0n, priceImpactBps: 0
    }),
    /FUTURE_FEATURE_LEAKAGE/
  );
});

test('NEMESIS-016: Drawdown collapse triggers automatic demotion to SHADOW in strategy canary (Upgrade 8)', () => {
  const helix = new HelixStrategyCanaryAuthority();
  helix.registerStrategy('S1', 'TINY_CANARY');
  const res = helix.evaluateStrategyRollout('S1', {
    strategyId: 'S1', tradeCount: 30, winRatePct: 35, realizedNetPnlLamports: -50_000_000n,
    meanNetPnlLamports: -1_000_000n, lowerConfidenceBoundLamports: -3_000_000n, maxDrawdownBps: 1600, // 16% DD breach!
    executionShortfallBps: 100, regimeDiversityScore: 0.4
  });

  assert.equal(res.action, 'DEMOTED');
  assert.equal(res.nextStage, 'SHADOW');
});

test('NEMESIS-017: AI research domain attempting to invoke KMS signing is structurally blocked (Upgrade 9)', () => {
  assert.throws(
    () => AirgapRAuthority.assertAuthority('SYLPH_RESEARCH', 'SIGN_TRANSACTION_KMS'),
    AirgapSecurityViolationError
  );
});

test('NEMESIS-018: AI agent attempting to self-approve high-risk capital increase is blocked (Upgrade 5)', () => {
  const tribunal = new TribunalAuthority(1, 'ROOT_1');
  const res = tribunal.journalAndAuthorizeCommand({
    commandId: 'C-AI', issuerId: 'AI_BOT', isAiGenerated: true, action: 'RAISE_CAPITAL', riskTier: 'HIGH_RISK',
    payload: {}, payloadHash: 'p1', issuedAtMs: Date.now(), expiresAtMs: Date.now() + 5000, nonce: 'N-AI',
    controlEpoch: 1, expectedPreviousStateRoot: 'ROOT_1',
    approvals: [{ approverId: 'AI_BOT', approverRole: 'SUPERVISOR', signature: 's1', approvedAtMs: Date.now() }],
    requiredApprovalsCount: 1, issuerSignature: 's_ai', digest: 'd1'
  });

  assert.equal(res.isAuthorized, false);
  assert.match(res.reason, /HIGH_RISK_AI_VIOLATION/);
});

test('NEMESIS-019: Incident lock freezes external treasury drains during safety halt (Upgrade 6)', () => {
  const shield = new TreasuryShieldAuthority({
    tradingWalletCeilingLamports: 10_000_000_000n, minEmergencyReserveLamports: 1_000_000_000n,
    autoSweepThresholdLamports: 10_000_000_000n,
    approvedTreasuryDestinations: new Set(['AllowedTreasuryDestination']),
    maxSingleTransferLamports: 10_000_000_000n, maxHourlyTransferVelocityLamports: 10_000_000_000n,
    isIncidentLockActive: true // Safety halt active!
  }, { TREASURY_CAPITAL: 5_000_000_000n });

  const res = shield.authorizeExternalTransfer({
    transferId: 'TX-1', destinationAddress: 'AllowedTreasuryDestination', amountLamports: 1_000_000_000n,
    sourceDomain: 'TREASURY_CAPITAL', requestedAtMs: Date.now(), authorizationSignature: 'sig'
  });

  assert.equal(res.isAuthorized, false);
  assert.match(res.reason, /INCIDENT_LOCK_ACTIVE/);
});
