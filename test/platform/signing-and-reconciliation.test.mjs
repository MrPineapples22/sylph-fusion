import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ZeroTrustSignerService } from '../../dist/platform/signing/signer-service.js';
import { SettlementFirewall } from '../../dist/platform/signing/settlement-firewall.js';
import { MarketTruthEngine } from '../../dist/platform/execution/market-truth.js';
import { PreSigningRevalidator } from '../../dist/platform/execution/revalidator.js';
import { ContinuousReconciler } from '../../dist/platform/reconciliation/reconciler.js';
import { SolvencyMonitor } from '../../dist/platform/reconciliation/solvency-monitor.js';

test('ZeroTrustSignerService: is disabled by default and labels explicit simulation artifacts', () => {
  const disabled = new ZeroTrustSignerService();
  const signer = new ZeroTrustSignerService(true);

  const req = {
    transactionId: 'tx-1001',
    domain: 'TRADING',
    vaultId: 'vault-1',
    userId: 'user-1',
    cycleId: 'cycle-1',
    targetProgramId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun
    amountLamports: 1_000_000_000n,
    serializedMessage: new Uint8Array([1, 2, 3]),
    requestedAt: Date.now(),
    metadata: {},
  };

  assert.equal(disabled.signTransaction(req, true).success, false);
  // Explicit simulation signing
  const signRes = signer.signTransaction(req, true);
  assert.equal(signRes.success, true);
  if (signRes.success) {
    assert.match(signRes.result.signature, /^simulation_sig_/);
    assert.equal(signRes.result.simulationOnly, true);
  }

  const negativeAmount = signer.signTransaction({ ...req, transactionId: 'tx-negative', amountLamports: -1n }, true);
  assert.equal(negativeAmount.success, false);
  assert.match(negativeAmount.error, /outside the permitted range/);

  // Idempotency: cannot re-sign signed/submitted/confirmed tx
  const reSignRes = signer.signTransaction(req, true);
  assert.equal(reSignRes.success, false);
  assert.match(reSignRes.error, /already in state SIGNED/);

  // Confirm tx
  signer.recordSimulatedConfirmation('tx-1001');
  const confirmReSign = signer.signTransaction(req, true);
  assert.equal(confirmReSign.success, false);
  assert.match(confirmReSign.error, /already CONFIRMED/);

  // Domain protection: TRADING domain cannot transfer direct SOL to external destination
  const rogueReq = {
    transactionId: 'tx-rogue-1',
    domain: 'TRADING',
    vaultId: 'vault-1',
    userId: 'user-1',
    cycleId: 'cycle-1',
    targetProgramId: '11111111111111111111111111111111', // System Program
    destinationAddress: 'AttackerDestination111111111111111111111',
    amountLamports: 1_000_000_000n,
    serializedMessage: new Uint8Array([4, 5, 6]),
    requestedAt: Date.now(),
    metadata: {},
  };

  const rogueRes = signer.signTransaction(rogueReq, true);
  assert.equal(rogueRes.success, false);
  assert.match(rogueRes.error, /Signer rejected: (Program .* not allowed|Direct external SOL transfers prohibited) in TRADING domain/);

  // Emergency halt
  signer.setEmergencyHalt(true);
  const haltRes = signer.signTransaction({
    ...req,
    transactionId: 'tx-1002',
  }, true);
  assert.equal(haltRes.success, false);
  assert.match(haltRes.error, /Global emergency halt active/);
});

test('SettlementFirewall: blocks unauthorized destinations, unclean reconciliation, and duplicate payouts', () => {
  const firewall = new SettlementFirewall();
  const vaultId = 'vault-alpha';
  const userDest = 'UserOfficialSolanaAddress11111111111111111';

  firewall.registerConfirmedDestination(vaultId, userDest);

  const baseReq = {
    settlementId: 'settle-cycle-1',
    vaultId,
    userId: 'user-alpha',
    cycleId: 'cycle-1',
    userDestinationAddress: userDest,
    netPayableLamports: 10_000_000_000n,
    platformFeeLamports: 500_000_000n,
    verifiedLiquidBalanceLamports: 10_500_000_000n,
    isReconciliationClean: true,
    cycleState: 'SETTLEMENT_READY',
  };

  // 1. Destination mismatch -> REJECT
  const badDestRes = firewall.authorizeSettlement({
    ...baseReq,
    userDestinationAddress: 'HackerDivertedAddress1111111111111111111',
  });
  assert.equal(badDestRes.approved, false);
  assert.match(badDestRes.rejectionReason, /Destination mismatch/);

  // 2. Unclean reconciliation -> REJECT
  const uncleanRes = firewall.authorizeSettlement({
    ...baseReq,
    isReconciliationClean: false,
  });
  assert.equal(uncleanRes.approved, false);
  assert.match(uncleanRes.rejectionReason, /Reconciliation alert/);

  // 3. Cycle not ready -> REJECT
  const activeCycleRes = firewall.authorizeSettlement({
    ...baseReq,
    cycleState: 'ACTIVE',
  });
  assert.equal(activeCycleRes.approved, false);
  assert.match(activeCycleRes.rejectionReason, /Cycle state must be SETTLEMENT_READY/);

  // 4. Valid settlement -> APPROVE
  const validRes = firewall.authorizeSettlement(baseReq);
  assert.equal(validRes.approved, true);
  assert.equal(validRes.netPayableLamports, 10_000_000_000n);

  const sameCycleDifferentId = firewall.authorizeSettlement({
    ...baseReq,
    settlementId: 'settle-cycle-1-second-id',
  });
  assert.equal(sameCycleDifferentId.approved, false);
  assert.match(sameCycleDifferentId.rejectionReason, /Duplicate settlement cycle/);

  // 5. Idempotent duplicate check -> REJECT duplicate settlementId
  const dupRes = firewall.authorizeSettlement(baseReq);
  assert.equal(dupRes.approved, false);
  assert.match(dupRes.rejectionReason, /Duplicate settlement request/);

  const negativeAmount = firewall.authorizeSettlement({
    ...baseReq,
    settlementId: 'settle-negative',
    cycleId: 'cycle-negative',
    netPayableLamports: -1n,
  });
  assert.equal(negativeAmount.approved, false);
  assert.match(negativeAmount.rejectionReason, /non-negative/);

  firewall.recordConfirmation(baseReq.settlementId, 'settled-signature');
  const postSettlement = firewall.authorizeSettlement({
    ...baseReq,
    settlementId: 'settle-cycle-1-replay',
    cycleId: 'cycle-settled',
    cycleState: 'SETTLED',
  });
  assert.equal(postSettlement.approved, false);
  assert.match(postSettlement.rejectionReason, /SETTLEMENT_READY/);

  firewall.recordFailure(baseReq.settlementId, 'uncertain transport outcome');
  const failedRetry = firewall.authorizeSettlement(baseReq);
  assert.equal(failedRetry.approved, false);
  assert.match(failedRetry.rejectionReason, /Duplicate settlement request/);

  assert.throws(() => firewall.registerConfirmedDestination(vaultId, 'ReplacedOfficialSolanaAddress1111111111111'), /immutable/);
});

test('MarketTruthEngine & PreSigningRevalidator: quarantines divergent feeds and aborts stale trades', () => {
  const truthEngine = new MarketTruthEngine({ maxDisagreementBps: 300 }); // 3%
  const now = Date.now();
  const mint = 'TargetToken11111111111111111111111111111111';

  // Providers agree closely: PumpPortal = 1000, Jupiter = 1010 (1% spread)
  const quotesAgree = [
    { providerId: 'PUMP_PORTAL', mint, priceLamports: 1000n, liquidityLamports: 1_000_000_000n, timestamp: now, latencyMs: 25, isStale: false },
    { providerId: 'JUPITER', mint, priceLamports: 1010n, liquidityLamports: 1_050_000_000n, timestamp: now, latencyMs: 30, isStale: false },
  ];

  const truthAgree = truthEngine.resolveCanonicalTruth(quotesAgree);
  assert.equal(truthAgree.isQuarantined, false);
  assert.ok(truthAgree.confidence > 0.8);

  // Providers diverge materially: PumpPortal = 1000, Jupiter = 1100 (10% spread > 3%)
  const quotesDiverge = [
    { providerId: 'PUMP_PORTAL', mint, priceLamports: 1000n, liquidityLamports: 1_000_000_000n, timestamp: now, latencyMs: 25, isStale: false },
    { providerId: 'JUPITER', mint, priceLamports: 1100n, liquidityLamports: 1_050_000_000n, timestamp: now, latencyMs: 30, isStale: false },
  ];

  const truthDiverge = truthEngine.resolveCanonicalTruth(quotesDiverge);
  assert.equal(truthDiverge.isQuarantined, true);
  assert.match(truthDiverge.quarantineReason, /Provider price disagreement/);

  // Pre-signing revalidation
  const revalidator = new PreSigningRevalidator();

  // Quarantined truth -> ABORT
  const revalQuarantine = revalidator.revalidate({
    signalPriceLamports: 1000n,
    maxAllowedSlippageBps: 200,
    maxAllowedPriceImpactBps: 300,
    minRequiredLiquidityLamports: 500_000_000n,
    marketTruth: truthDiverge,
    orderSizeLamports: 50_000_000n,
  });
  assert.equal(revalQuarantine.outcome, 'ABORT');
  assert.match(revalQuarantine.reason, /quarantined/);

  // Adverse slippage beyond ceiling -> ABORT
  const truthSlipped = {
    ...truthAgree,
    canonicalPriceLamports: 1100n, // +10% above signal
  };
  const revalSlipped = revalidator.revalidate({
    signalPriceLamports: 1000n,
    maxAllowedSlippageBps: 200, // 2% ceiling
    maxAllowedPriceImpactBps: 300,
    minRequiredLiquidityLamports: 500_000_000n,
    marketTruth: truthSlipped,
    orderSizeLamports: 50_000_000n,
  });
  assert.equal(revalSlipped.outcome, 'ABORT');
  assert.match(revalSlipped.reason, /Adverse price slippage/);
});

test('ContinuousReconciler & SolvencyMonitor: detects accounting gaps and assesses readiness', () => {
  const reconciler = new ContinuousReconciler();

  // Clean balance run
  const cleanRun = reconciler.reconcile({
    onChainBalanceLamports: 100_000_000_000n,
    signerConfirmedTotalLamports: 100_000_000_000n,
    ledgerControlledAssetsLamports: 100_000_000_000n,
    vaultCustomerLiabilitiesLamports: 95_000_000_000n,
    platformTreasuryLamports: 5_000_000_000n,
    explicitDiscrepancyLamports: 0n,
  });
  assert.equal(cleanRun.isClean, true);
  assert.equal(cleanRun.alerts.length, 0);

  // Discrepancy run: On-chain has 99 SOL, ledger thinks 100 SOL (1 SOL missing)
  const alertRun = reconciler.reconcile({
    onChainBalanceLamports: 99_000_000_000n,
    signerConfirmedTotalLamports: 99_000_000_000n,
    ledgerControlledAssetsLamports: 100_000_000_000n,
    vaultCustomerLiabilitiesLamports: 95_000_000_000n,
    platformTreasuryLamports: 5_000_000_000n,
    explicitDiscrepancyLamports: 0n,
  });
  assert.equal(alertRun.isClean, false);
  assert.ok(alertRun.alerts.length > 0);
  assert.match(alertRun.alerts[0].explanation, /On-chain balance .* does not match internal ledger/);

  const signerDivergence = reconciler.reconcile({
    onChainBalanceLamports: 100_000_000_000n,
    signerConfirmedTotalLamports: 0n,
    ledgerControlledAssetsLamports: 100_000_000_000n,
    vaultCustomerLiabilitiesLamports: 95_000_000_000n,
    platformTreasuryLamports: 5_000_000_000n,
    explicitDiscrepancyLamports: 0n,
  });
  assert.equal(signerDivergence.isClean, false);
  assert.ok(signerDivergence.alerts.some(alert => /Signing service confirmed total/.test(alert.explanation)));

  // Solvency Monitor
  const monitor = new SolvencyMonitor();

  // Solvency report
  const solvency = monitor.generateSolvencyReport(100_000_000_000n, 90_000_000_000n, 10_000_000_000n);
  assert.equal(solvency.isFullySolvent, true);
  assert.equal(solvency.unexplainedDiscrepancyLamports, 0n);

  // Settlement readiness: Vault with open positions cannot settle
  const notReadyVault = {
    vaultId: 'v-1',
    remainingTimeMs: 1000,
    estimatedSettlementObligationLamports: 10_000_000_000n,
    liquidSolLamports: 5_000_000_000n,
    openPositionsCount: 2,
    openPositionsEstimatedExitLamports: 5_000_000_000n,
    pendingTxCount: 0,
    isReconciliationClean: true,
  };
  const readinessNotReady = monitor.calculateSettlementReadiness(notReadyVault);
  assert.equal(readinessNotReady.isReadyToSettle, false);

  // Settlement readiness: 100% liquid, 0 positions, clean reconciliation -> Ready
  const readyVault = {
    vaultId: 'v-2',
    remainingTimeMs: 1000,
    estimatedSettlementObligationLamports: 10_000_000_000n,
    liquidSolLamports: 10_000_000_000n,
    openPositionsCount: 0,
    openPositionsEstimatedExitLamports: 0n,
    pendingTxCount: 0,
    isReconciliationClean: true,
  };
  const readinessReady = monitor.calculateSettlementReadiness(readyVault);
  assert.equal(readinessReady.isReadyToSettle, true);
  assert.equal(readinessReady.readinessScore, 1.0);

  // Liquidity coverage ratio
  const coverage = monitor.calculateLiquidityCoverage(150_000_000_000n, 100_000_000_000n);
  assert.equal(coverage.isCoverageAdequate, true); // 1.5 >= 1.2
  assert.equal(coverage.coverageRatio, 1.5);
});
