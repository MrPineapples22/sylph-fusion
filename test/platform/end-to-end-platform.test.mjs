import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SOLSYLPHPlatform } from '../../dist/platform/orchestrator.js';

test('SOL-SYLPH Multi-User Platform: Complete End-to-End Autonomous Lifecycle & Settlement', () => {
  const platform = new SOLSYLPHPlatform({
    platformId: 'solsylph-main-test',
    defaultFeeRateBps: 2000, // 20% performance fee
  });

  // 1. Register Users & Create Segregated Vaults (User A -> Vault A, User B -> Vault B)
  const userA_Dest = 'SolanaAddressUserA1111111111111111111111111';
  const userB_Dest = 'SolanaAddressUserB2222222222222222222222222';

  const vaultA = platform.registerUserAndVault('user-a', 'vault-a', userA_Dest, 'CONSERVATIVE');
  const vaultB = platform.registerUserAndVault('user-b', 'vault-b', userB_Dest, 'BALANCED');

  assert.equal(vaultA.vaultId, 'vault-a');
  assert.equal(vaultB.vaultId, 'vault-b');
  assert.notEqual(vaultA.vaultId, vaultB.vaultId);

  // 2. Fund Vaults: 10 SOL each
  platform.deposit('vault-a', 10_000_000_000n);
  platform.deposit('vault-b', 10_000_000_000n);

  // Invariant: Accounting Conservation Holds
  const initialConservation = platform.doubleEntry.checkConservation();
  assert.equal(initialConservation.conserved, true);
  assert.equal(initialConservation.controlledAssets, 20_000_000_000n);
  assert.equal(initialConservation.customerLiabilities, 20_000_000_000n);

  // Invariant: SHA-256 Event Ledger Integrity
  assert.equal(platform.eventLedger.verifyChain().valid, true);

  // 3. Start 72-Hour Autonomous Cycles
  const now = Date.now();
  const clockA = platform.startCycle('vault-a', 'cycle-a-1', now);
  const clockB = platform.startCycle('vault-b', 'cycle-b-1', now);

  assert.equal(clockA.totalCycleDurationSec, 72 * 3600);
  assert.equal(clockB.totalCycleDurationSec, 72 * 3600);
  assert.equal(platform.vaultManager.getVault('vault-a')?.state, 'ACTIVE');
  assert.equal(platform.vaultManager.getVault('vault-b')?.state, 'ACTIVE');

  // 4. Register Champion Strategy in Governance Engine
  platform.strategyGovernance.registerContract({
    strategyId: 'strat-momentum-v1',
    version: '1.0.0',
    stage: 'PRODUCTION',
    maxPositionSizeLamports: 5_000_000_000n,
    maxAggregateCapitalLamports: 20_000_000_000n,
    minLiquidityLamports: 1_000_000_000n,
    maxDrawdownBps: 1500,
    maxHoldingDurationSec: 3600,
    isCapitalAuthorized: true,
  });

  // Register baseline profile with AI Sentinel
  platform.sentinel.registerStrategyProfile({
    strategyId: 'strat-momentum-v1',
    version: '1.0.0',
    baselineAvgHoldingTimeSec: 600,
    baselineAvgSlippageBps: 50,
    baselineWinRateBps: 6000,
    maxObservedTradeBurstPerMin: 5,
  });

  // 5. Evaluate and Execute Opportunity: Token Passes All Gates
  const mint = 'TokenGood1111111111111111111111111111111111';
  const creator = 'CreatorLegit1111111111111111111111111111111';

  const tokenSecurity = {
    mint,
    creator,
    rugcheckScore: 100,
    rugged: false,
    isMintAuthorityRevoked: true,
    isFreezeAuthorityRevoked: true,
    token2022TransferFeeBps: null,
    hasPermanentDelegate: false,
    top10HoldersBps: 1200,
    realQuoteReserveLamports: 10_000_000_000n,
    creatorTokensHeldPct: 1.5,
    knownIncidentHistoryCount: 0,
  };

  const quotes = [
    { providerId: 'PUMP_PORTAL', mint, priceLamports: 1000n, liquidityLamports: 10_000_000_000n, timestamp: now, latencyMs: 25, isStale: false },
    { providerId: 'JUPITER', mint, priceLamports: 1010n, liquidityLamports: 10_500_000_000n, timestamp: now, latencyMs: 30, isStale: false },
  ];

  const tradeRes = platform.evaluateAndExecuteTrade({
    strategyId: 'strat-momentum-v1',
    tokenSecurity,
    quotes,
    signalScore: 85,
    momentumScore: 80,
    participatingVaultIds: ['vault-a', 'vault-b'],
    requestedLamportsPerVault: 2_000_000_000n,
    now: now + 3600 * 1000, // Hour 1 of cycle
  });

  assert.equal(tradeRes.success, true, tradeRes.reason);
  if (tradeRes.success) {
    assert.ok(tradeRes.cohortId);
    assert.ok(tradeRes.transactionId);
    assert.equal(tradeRes.executedCohort.executed, true);
    // Exact Integer Conservation Check: Sum(Tokens) == Total Tokens Filled
    const sumTokens = tradeRes.executedCohort.allocations.reduce((s, a) => s + (a.tokensFilled ?? 0n), 0n);
    assert.equal(sumTokens, 10_000_000n);
  }

  // Verify Signer Recorded and Confirmed Tx
  assert.equal(platform.signer.getTxRecord(tradeRes.transactionId)?.state, 'CONFIRMED');

  // Verify Ledger Remains Cryptographically Sound
  assert.equal(platform.eventLedger.verifyChain().valid, true);

  // 6. Finalize & Settle Vault A after 72h autonomous cycle
  const settlementTime = now + 72 * 3600 * 1000;
  const settleRes = platform.finalizeAndSettleVault('vault-a', settlementTime);

  assert.equal(settleRes.success, true);
  if (settleRes.success) {
    assert.ok(settleRes.signature);
    assert.ok(settleRes.netPayableLamports > 0n);
  }

  // Verify Vault A is CLOSED
  assert.equal(platform.vaultManager.getVault('vault-a')?.state, 'CLOSED');

  // Verify Double-Entry Accounting Invariance Holds after Settlement
  const postSettleConservation = platform.doubleEntry.checkConservation();
  assert.equal(postSettleConservation.conserved, true);
});

test('SOL-SYLPH Platform Invariants: Adversarial and Security Edge Cases', () => {
  const platform = new SOLSYLPHPlatform();
  const userDest = 'SolanaAddressUserSafe111111111111111111111';

  platform.registerUserAndVault('user-safe', 'vault-safe', userDest, 'BALANCED');
  platform.deposit('vault-safe', 10_000_000_000n);
  const now = Date.now();
  platform.startCycle('vault-safe', 'cycle-safe-1', now);

  platform.strategyGovernance.registerContract({
    strategyId: 'strat-test-v1',
    version: '1.0.0',
    stage: 'PRODUCTION',
    maxPositionSizeLamports: 5_000_000_000n,
    maxAggregateCapitalLamports: 10_000_000_000n,
    minLiquidityLamports: 1_000_000_000n,
    maxDrawdownBps: 1500,
    maxHoldingDurationSec: 3600,
    isCapitalAuthorized: true,
  });

  // Case 1: Active Freeze Authority -> BLOCKED by Token Gateway
  const rogueToken = {
    mint: 'RogueToken1111111111111111111111111111111111',
    creator: 'RogueCreator1111111111111111111111111111111',
    rugcheckScore: 100,
    rugged: false,
    isMintAuthorityRevoked: true,
    isFreezeAuthorityRevoked: false, // Active freeze authority backdoor!
    token2022TransferFeeBps: null,
    hasPermanentDelegate: false,
    top10HoldersBps: 1000,
    realQuoteReserveLamports: 5_000_000_000n,
    creatorTokensHeldPct: 2.0,
    knownIncidentHistoryCount: 0,
  };

  const rogueQuotes = [
    { providerId: 'PUMP_PORTAL', mint: rogueToken.mint, priceLamports: 1000n, liquidityLamports: 5_000_000_000n, timestamp: now, latencyMs: 25, isStale: false },
  ];

  const blockedRes = platform.evaluateAndExecuteTrade({
    strategyId: 'strat-test-v1',
    tokenSecurity: rogueToken,
    quotes: rogueQuotes,
    signalScore: 99, // High alpha cannot override security backdoor
    momentumScore: 99,
    participatingVaultIds: ['vault-safe'],
    requestedLamportsPerVault: 1_000_000_000n,
    now: now + 3600 * 1000,
  });

  assert.equal(blockedRes.success, false);
  assert.match(blockedRes.reason, /Security gateway BLOCKED/);

  // Case 2: Divergent Quotes (> 300 bps) -> QUARANTINE DATA -> Trade Aborted
  const divergentQuotes = [
    { providerId: 'PUMP_PORTAL', mint: 'MintDiverge1111111111111111111111111111111', priceLamports: 1000n, liquidityLamports: 5_000_000_000n, timestamp: now, latencyMs: 25, isStale: false },
    { providerId: 'JUPITER', mint: 'MintDiverge1111111111111111111111111111111', priceLamports: 1100n, liquidityLamports: 5_000_000_000n, timestamp: now, latencyMs: 30, isStale: false },
  ];

  const goodToken = {
    ...rogueToken,
    mint: 'MintDiverge1111111111111111111111111111111',
    isFreezeAuthorityRevoked: true,
  };

  const divergeRes = platform.evaluateAndExecuteTrade({
    strategyId: 'strat-test-v1',
    tokenSecurity: goodToken,
    quotes: divergentQuotes,
    signalScore: 90,
    momentumScore: 90,
    participatingVaultIds: ['vault-safe'],
    requestedLamportsPerVault: 1_000_000_000n,
    now: now + 3600 * 1000,
  });

  assert.equal(divergeRes.success, false);
  assert.match(divergeRes.reason, /Market truth quarantined/);

  // Case 3: Late Entry Suppression (Hour 70: Phase 4 Settlement Prep)
  const agreedQuotes = [
    { providerId: 'PUMP_PORTAL', mint: goodToken.mint, priceLamports: 1000n, liquidityLamports: 5_000_000_000n, timestamp: now, latencyMs: 25, isStale: false },
    { providerId: 'JUPITER', mint: goodToken.mint, priceLamports: 1010n, liquidityLamports: 5_000_000_000n, timestamp: now, latencyMs: 30, isStale: false },
  ];

  const lateRes = platform.evaluateAndExecuteTrade({
    strategyId: 'strat-test-v1',
    tokenSecurity: goodToken,
    quotes: agreedQuotes,
    signalScore: 90,
    momentumScore: 90,
    participatingVaultIds: ['vault-safe'],
    requestedLamportsPerVault: 1_000_000_000n,
    now: now + 70 * 3600 * 1000, // Hour 70: Late entry window closed!
  });

  assert.equal(lateRes.success, false);
  assert.match(lateRes.reason, /No vaults passed risk authorization/);
});
