import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VaultLifecycleController, VALID_TRANSITIONS } from '../../dist/platform/lifecycle/state-machine.js';
import { IndependentRiskEngine } from '../../dist/platform/risk/risk-engine.js';
import { TokenAdmissionGateway } from '../../dist/platform/security/token-gateway.js';
import { CapacityEngine } from '../../dist/platform/consensus/capacity-engine.js';
import { TradeConsensusEngine } from '../../dist/platform/consensus/consensus-engine.js';
import { CohortEngine } from '../../dist/platform/cohort/cohort-engine.js';
import { VaultManager } from '../../dist/platform/vault/vault-manager.js';

test('VaultLifecycleController: enforces 72h phases, de-risking, and rejects late entries', () => {
  const controller = new VaultLifecycleController();
  const startMs = 1_000_000_000;
  const clock = controller.startCycle('vlt-1', 'cyc-1', startMs);

  assert.equal(clock.totalCycleDurationSec, 72 * 3600);

  // Hour 10: Phase 1 Normal
  const p1 = controller.evaluatePhase('vlt-1', startMs + 10 * 3600 * 1000);
  assert.equal(p1.phase, 'PHASE_1_NORMAL');
  assert.equal(p1.allowNewEntries, true);
  assert.equal(p1.exposureMultiplier, 1.0);

  // Hour 50: Phase 2 Preservation (reduced sizing)
  const p2 = controller.evaluatePhase('vlt-1', startMs + 50 * 3600 * 1000);
  assert.equal(p2.phase, 'PHASE_2_PRESERVATION');
  assert.equal(p2.allowNewEntries, true);
  assert.equal(p2.exposureMultiplier, 0.5);

  // Hour 62: Phase 3 Harvest (no new entries)
  const p3 = controller.evaluatePhase('vlt-1', startMs + 62 * 3600 * 1000);
  assert.equal(p3.phase, 'PHASE_3_HARVEST');
  assert.equal(p3.allowNewEntries, false, 'Phase 3 MUST prohibit new entries');

  // Hour 70: Phase 4 Settlement Prep (no new entries, zero holding horizon)
  const p4 = controller.evaluatePhase('vlt-1', startMs + 70 * 3600 * 1000);
  assert.equal(p4.phase, 'PHASE_4_SETTLEMENT_PREP');
  assert.equal(p4.allowNewEntries, false);
  assert.equal(p4.maxHoldHorizonSec, 0);

  // State Transition Validation: Legal vs Illegal
  assert.equal(controller.transition('CREATED', 'AWAITING_DEPOSIT', 'vlt-1'), 'AWAITING_DEPOSIT');
  assert.throws(() => controller.transition('CREATED', 'SETTLED', 'vlt-1'), /Illegal state transition/);
});

test('IndependentRiskEngine: enforces mandate ceilings, phase scaling, and global systemic limits', () => {
  const riskEngine = new IndependentRiskEngine({
    maxPlatformTotalDeployedBps: 7000,
    maxSingleTokenPlatformConcentrationBps: 500, // Max 5% in single token
    maxSingleCreatorPlatformExposureBps: 300,
    minGlobalLiquidityReserveLamports: 10_000_000_000n,
  });

  const manager = new VaultManager();
  manager.registerUser('usr-1', 'AliceDest11111111111111111111111111111111');
  const vault = manager.createVault('vlt-1', 'usr-1', 'CONSERVATIVE');
  manager.processDeposit('vlt-1', 10_000_000_000n); // 10 SOL NAV

  const normalPhase = {
    phase: 'PHASE_1_NORMAL',
    elapsedSec: 1000,
    remainingSec: 250000,
    allowNewEntries: true,
    maxHoldHorizonSec: 1800,
    exposureMultiplier: 1.0,
    liquidityFloorMultiplier: 1.0,
    reason: 'Normal phase',
  };

  // Proposal requesting 5 SOL (exceeds Conservative 20% single-pos cap = 2 SOL)
  const proposal = {
    proposalId: 'prop-1',
    vaultId: 'vlt-1',
    userId: 'usr-1',
    cycleId: 'cyc-1',
    strategyId: 'curve-scalp',
    strategyVersion: '1.0.0',
    mint: 'TokenA11111111111111111111111111111111111111',
    creator: 'Creator1111111111111111111111111111111111111',
    side: 'buy',
    requestedAmountLamports: 5_000_000_000n,
    expectedSlippageBps: 100,
    expectedPriceImpactBps: 150,
    poolLiquidityLamports: 5_000_000_000n,
    timestamp: Date.now(),
  };

  const auth = riskEngine.authorizeTrade(proposal, vault, normalPhase, 100_000_000_000n, 0);

  // REDUCE to 2 SOL due to conservative 20% cap
  assert.equal(auth.disposition, 'REDUCE');
  assert.equal(auth.authorizedAmountLamports, 2_000_000_000n);

  // Exceeding concurrent positions -> REJECT
  const authMaxPos = riskEngine.authorizeTrade(proposal, vault, normalPhase, 100_000_000_000n, 2);
  assert.equal(authMaxPos.disposition, 'REJECT');
  assert.match(authMaxPos.rejectionReason, /Max concurrent positions reached/);

  // Global Systemic Concentration Checks:
  // With Platform NAV = 10 SOL:
  // - Single-creator cap is 3% = 300,000,000 lamports (0.3 SOL)
  // - Single-token cap is 5% = 500,000,000 lamports (0.5 SOL)
  // The tighter limit (creator 3%) caps authorization to 300,000,000 lamports.
  const authGlobal = riskEngine.authorizeTrade(proposal, vault, normalPhase, 10_000_000_000n, 0);
  assert.equal(authGlobal.disposition, 'REDUCE');
  assert.equal(authGlobal.authorizedAmountLamports, 300_000_000n, 'Global creator 3% limit must cap size');
  assert.ok(authGlobal.appliedConstraints.includes('capped_by_global_creator_exposure'));
  assert.ok(authGlobal.appliedConstraints.includes('capped_by_global_single_token_concentration'));
});

test('TokenAdmissionGateway: blocks backdoors and hard veto cannot be bypassed', () => {
  const gateway = new TokenAdmissionGateway();

  // Token with active freeze authority -> BLOCK
  const freezeRes = gateway.evaluate({
    mint: 'Mint11111111111111111111111111111111111111',
    creator: 'Creator11111111111111111111111111111111111',
    rugcheckScore: 100,
    rugged: false,
    isMintAuthorityRevoked: true,
    isFreezeAuthorityRevoked: false, // Freeze authority active!
    token2022TransferFeeBps: null,
    hasPermanentDelegate: false,
    top10HoldersBps: 1000,
    realQuoteReserveLamports: 2_000_000_000n,
    creatorTokensHeldPct: 2.0,
    knownIncidentHistoryCount: 0,
  });

  assert.equal(freezeRes.verdict, 'BLOCK');
  assert.match(freezeRes.reason, /Active freeze authority/);

  // Token with Token-2022 permanent delegate backdoor -> BLOCK
  const delegateRes = gateway.evaluate({
    mint: 'Mint22222222222222222222222222222222222222',
    creator: 'Creator22222222222222222222222222222222222',
    rugcheckScore: 100,
    rugged: false,
    isMintAuthorityRevoked: true,
    isFreezeAuthorityRevoked: true,
    token2022TransferFeeBps: null,
    hasPermanentDelegate: true, // Backdoor!
    top10HoldersBps: 1000,
    realQuoteReserveLamports: 2_000_000_000n,
    creatorTokensHeldPct: 2.0,
    knownIncidentHistoryCount: 0,
  });

  assert.equal(delegateRes.verdict, 'BLOCK');
  assert.match(delegateRes.reason, /permanent delegate backdoor/);
});

test('TradeConsensusEngine: hard security/risk vetoes cannot be overridden by alpha', () => {
  const consensusEngine = new TradeConsensusEngine();

  // High Alpha (98/100), but Security Gateway returned BLOCK
  const blockedPacket = consensusEngine.evaluateConsensus({
    candidateId: 'cand-1',
    mint: 'Mint11111111111111111111111111111111111111',
    securityResult: {
      verdict: 'BLOCK',
      allowedMaxPositionSizeLamports: null,
      riskScore: 100,
      flags: ['active_freeze_authority'],
      reason: 'Active freeze authority present',
      evaluatedAt: Date.now(),
    },
    riskAuth: {
      disposition: 'APPROVE',
      authorizedAmountLamports: 1_000_000_000n,
      rejectionReason: null,
      appliedConstraints: [],
      maxAllowableLossLamports: 100_000_000n,
      cycleDrawdownBps: 0,
      globalTokenExposureBps: 100,
      timestamp: Date.now(),
    },
    poolLiquidityLamports: 5_000_000_000n,
    alphaScore: 98, // Extreme Alpha!
    momentumScore: 95,
    regimeScore: 90,
    walletIntegrityScore: 80,
    executionQualityScore: 85,
    portfolioFitScore: 90,
    expectedEdgeBps: 500,
    capacityConstraints: {
      userRiskCapacityLamports: 1_000_000_000n,
      globalRiskCapacityLamports: 5_000_000_000n,
      poolLiquidityLamports: 5_000_000_000n,
      maxAllowableExitImpactBps: 500,
      settlementRemainingHours: 40,
    },
  });

  assert.equal(blockedPacket.overallAccepted, false, 'High Alpha MUST NOT override security block');
  assert.ok(blockedPacket.hardVetoes.some(v => v.includes('security_block')));
  assert.equal(blockedPacket.maxCapacityLamports, 0n);
});

test('CohortEngine: fair pro-rata allocation and exact conservation fill distribution', () => {
  const cohortEngine = new CohortEngine();

  // 3 vaults request a combined 4 SOL (4,000,000,000 lamports)
  // Approved market capacity is only 2 SOL (2,000,000,000 lamports)
  const requests = [
    { vaultId: 'vlt-alice', userId: 'usr-1', authorizedAmountLamports: 2_000_000_000n, priorityScore: 1 }, // 50%
    { vaultId: 'vlt-bob', userId: 'usr-2', authorizedAmountLamports: 1_000_000_000n, priorityScore: 1 },   // 25%
    { vaultId: 'vlt-charlie', userId: 'usr-3', authorizedAmountLamports: 1_000_000_000n, priorityScore: 1 }, // 25%
  ];

  const approvedCapacity = 2_000_000_000n;
  const cohort = cohortEngine.createCohort('cohort-1', 'MintABC11111111111111111111111111111111', requests, approvedCapacity);

  assert.equal(cohort.totalAllocatedCapitalLamports, approvedCapacity);
  assert.equal(cohort.allocations[0].allocatedCapitalLamports, 1_000_000_000n); // 50% of 2 SOL = 1 SOL
  assert.equal(cohort.allocations[1].allocatedCapitalLamports, 500_000_000n);   // 25% of 2 SOL = 0.5 SOL
  assert.equal(cohort.allocations[2].allocatedCapitalLamports, 500_000_000n);   // 25% of 2 SOL = 0.5 SOL

  // Distribute execution fill: aggregate swap filled 100,000,000 tokens for 1.95 SOL spent
  const totalTokens = 100_000_000n;
  const totalSolSpent = 1_950_000_000n;
  const executedCohort = cohortEngine.distributeExecutionFill(cohort, totalTokens, totalSolSpent);

  assert.equal(executedCohort.executed, true);

  // Exact conservation invariant: Sum(tokens) == totalTokens, Sum(sol) == totalSolSpent
  const distributedTokens = executedCohort.allocations.reduce((sum, a) => sum + (a.tokensFilled ?? 0n), 0n);
  const distributedSol = executedCohort.allocations.reduce((sum, a) => sum + (a.netLamportsSpent ?? 0n), 0n);

  assert.equal(distributedTokens, totalTokens, 'Token distribution must strictly conserve tokens');
  assert.equal(distributedSol, totalSolSpent, 'SOL distribution must strictly conserve lamports');

  // Verify VWAP is identical across all cohort vaults
  assert.equal(executedCohort.allocations[0].vwapPriceSolPerToken, executedCohort.allocations[1].vwapPriceSolPerToken);
});
