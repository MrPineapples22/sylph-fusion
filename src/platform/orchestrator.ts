/**
 * SOL-SYLPH Multi-User Autonomous Trading Platform - Master Orchestrator
 * Specifications: Sections I - LXXVI.
 *
 * This orchestrator connects every institutional subsystem in strict dependency order:
 * User Identity -> Vault -> 72h Lifecycle -> Risk Mandates -> Strategy Governance ->
 * Token Gateway -> Consensus & Adversarial Stress -> Risk Engine -> Cohort Engine ->
 * Pre-Signing Revalidator -> Zero-Trust Signer -> Ledger & Double-Entry -> NAV ->
 * Continuous Reconciliation -> Settlement Firewall.
 */

import { randomUUID } from 'node:crypto';
import type { UserRiskMandateType } from './types.js';
import { VaultManager } from './vault/vault-manager.js';
import { EventLedger } from './ledger/event-ledger.js';
import { DoubleEntryJournal } from './ledger/double-entry.js';
import { NavEngine } from './ledger/nav-engine.js';
import { VaultLifecycleController } from './lifecycle/state-machine.js';
import { IndependentRiskEngine } from './risk/risk-engine.js';
import { TokenAdmissionGateway, TokenSecurityAuditInput } from './security/token-gateway.js';
import { WalletRelationshipGraph } from './security/wallet-graph.js';
import { CapacityEngine } from './consensus/capacity-engine.js';
import { TradeConsensusEngine } from './consensus/consensus-engine.js';
import { CohortEngine } from './cohort/cohort-engine.js';
import { ZeroTrustSignerService } from './signing/signer-service.js';
import { SettlementFirewall } from './signing/settlement-firewall.js';
import { MarketTruthEngine } from './execution/market-truth.js';
import { PreSigningRevalidator } from './execution/revalidator.js';
import { ContinuousReconciler } from './reconciliation/reconciler.js';
import { SolvencyMonitor } from './reconciliation/solvency-monitor.js';
import { SystemicMarketSafetyEngine } from './sentinel/market-safety.js';
import { AIRiskSentinel } from './sentinel/risk-sentinel.js';
import { StrategyGovernanceEngine } from './strategy/governance.js';
import { IncidentFlightRecorder } from './recovery/flight-recorder.js';
import type { ProviderQuote } from './execution/types.js';
import type { VaultAllocationRequest } from './cohort/types.js';

export interface PlatformConfig {
  readonly platformId: string;
  readonly defaultFeeRateBps: number;
}

/**
 * This experimental platform has no isolated signer, broadcast adapter, or
 * authoritative chain reconciliation. These codes deliberately prevent its
 * model components from being interpreted as financial execution.
 */
export const ECONOMIC_EXECUTION_UNAVAILABLE = 'ECONOMIC_EXECUTION_UNAVAILABLE';
export const ECONOMIC_SETTLEMENT_UNAVAILABLE = 'ECONOMIC_SETTLEMENT_UNAVAILABLE';

export class SOLSYLPHPlatform {
  public readonly vaultManager: VaultManager;
  public readonly eventLedger: EventLedger;
  public readonly doubleEntry: DoubleEntryJournal;
  public readonly navEngine: NavEngine;
  public readonly lifecycle: VaultLifecycleController;
  public readonly riskEngine: IndependentRiskEngine;
  public readonly securityGateway: TokenAdmissionGateway;
  public readonly walletGraph: WalletRelationshipGraph;
  public readonly capacityEngine: CapacityEngine;
  public readonly consensusEngine: TradeConsensusEngine;
  public readonly cohortEngine: CohortEngine;
  public readonly signer: ZeroTrustSignerService;
  public readonly settlementFirewall: SettlementFirewall;
  public readonly marketTruth: MarketTruthEngine;
  public readonly revalidator: PreSigningRevalidator;
  public readonly reconciler: ContinuousReconciler;
  public readonly solvencyMonitor: SolvencyMonitor;
  public readonly marketSafety: SystemicMarketSafetyEngine;
  public readonly sentinel: AIRiskSentinel;
  public readonly strategyGovernance: StrategyGovernanceEngine;
  public readonly flightRecorder: IncidentFlightRecorder;

  /** Kept non-configurable: this model has no reviewed economic adapter. */
  private isEconomicExecutionAvailable(): boolean {
    return false;
  }

  constructor(public readonly config: PlatformConfig = { platformId: 'solsylph-v1', defaultFeeRateBps: 2000 }) {
    this.vaultManager = new VaultManager();
    this.eventLedger = new EventLedger();
    this.doubleEntry = new DoubleEntryJournal();
    this.navEngine = new NavEngine({
      defaultPerformanceFeeBps: config.defaultFeeRateBps,
      minProfitThresholdLamports: 10_000_000n,
    });
    this.lifecycle = new VaultLifecycleController();
    this.riskEngine = new IndependentRiskEngine();
    this.securityGateway = new TokenAdmissionGateway();
    this.walletGraph = new WalletRelationshipGraph();
    this.capacityEngine = new CapacityEngine();
    this.consensusEngine = new TradeConsensusEngine();
    this.cohortEngine = new CohortEngine();
    this.signer = new ZeroTrustSignerService();
    this.settlementFirewall = new SettlementFirewall();
    this.marketTruth = new MarketTruthEngine();
    this.revalidator = new PreSigningRevalidator();
    this.reconciler = new ContinuousReconciler();
    this.solvencyMonitor = new SolvencyMonitor();
    this.marketSafety = new SystemicMarketSafetyEngine();
    this.sentinel = new AIRiskSentinel();
    this.strategyGovernance = new StrategyGovernanceEngine();
    this.flightRecorder = new IncidentFlightRecorder();
  }

  /**
   * Register a new user, create an isolated vault, and record the confirmed payout destination.
   */
  public registerUserAndVault(
    userId: string,
    vaultId: string,
    confirmedDestinationAddress: string,
    mandateType: UserRiskMandateType = 'BALANCED',
    notes?: string
  ) {
    this.vaultManager.registerUser(userId, confirmedDestinationAddress, notes);
    const vault = this.vaultManager.createVault(vaultId, userId, mandateType);
    this.settlementFirewall.registerConfirmedDestination(vault.vaultId, confirmedDestinationAddress);
    return vault;
  }

  /**
   * Deposit customer funds with double-entry journal postings and event ledger audit trail.
   */
  public deposit(vaultId: string, amountLamports: bigint) {
    const updatedVault = this.vaultManager.processDeposit(vaultId, amountLamports);
    const vault = this.vaultManager.getVault(vaultId);
    if (!vault) throw new Error(`Vault ${vaultId} not found`);

    // Post to immutable event ledger
    const evt = this.eventLedger.append({
      timestamp: Date.now(),
      userId: vault.userId,
      vaultId,
      cycleId: 'genesis',
      type: 'DEPOSIT',
      asset: 'SOL',
      quantity: amountLamports.toString(),
      solValueLamports: amountLamports,
      source: 'USER_DEPOSIT',
      reason: 'Initial vault funding',
    });

    // Post double-entry journal entry
    this.doubleEntry.postDeposit(evt.eventId, amountLamports);

    return updatedVault;
  }

  /**
   * Start 72-hour deterministic trading cycle.
   */
  public startCycle(vaultId: string, cycleId: string, startTimestamp = Date.now()) {
    const clock = this.lifecycle.startCycle(vaultId, cycleId, startTimestamp);
    let state = this.vaultManager.getVault(vaultId)!.state;
    if (state === 'CREATED') {
      state = this.lifecycle.transition(state, 'FUNDED', vaultId);
    }
    if (state === 'FUNDED') {
      state = this.lifecycle.transition(state, 'ACTIVATION_PENDING', vaultId);
    }
    if (state === 'ACTIVATION_PENDING') {
      state = this.lifecycle.transition(state, 'ACTIVE', vaultId);
    }
    this.vaultManager.getVault(vaultId)!.state = state;
    this.vaultManager.getVault(vaultId)!.currentCycleId = cycleId;
    this.vaultManager.getVault(vaultId)!.cycleStartedAt = startTimestamp;
    return clock;
  }

  /**
   * Execute full trade evaluation and execution pipeline across participating vaults.
   */
  public evaluateAndExecuteTrade(params: {
    strategyId: string;
    tokenSecurity: TokenSecurityAuditInput;
    quotes: readonly ProviderQuote[];
    signalScore: number;
    momentumScore: number;
    participatingVaultIds: readonly string[];
    requestedLamportsPerVault: bigint;
    now?: number;
  }) {
    const now = params.now ?? Date.now();

    // 1. Strategy Governance & Stage Check
    const stratAuth = this.strategyGovernance.canAllocateCapital(params.strategyId);
    if (!stratAuth.authorized) {
      return { success: false, reason: `Strategy governance rejection: ${stratAuth.reason}` };
    }

    // 2. Systemic Market Safety Check
    const safetyScale = this.marketSafety.getGlobalRiskScaleFactor();
    if (safetyScale <= 0) {
      return { success: false, reason: `Market safety blocked: Global state is ${this.marketSafety.getState()}` };
    }

    // 3. Token Security Gateway Check
    const secResult = this.securityGateway.evaluate(params.tokenSecurity);
    if (secResult.verdict === 'BLOCK') {
      return { success: false, reason: `Security gateway BLOCKED token ${params.tokenSecurity.mint}: ${secResult.reason}` };
    }

    // 4. Market Truth Aggregation
    const truth = this.marketTruth.resolveCanonicalTruth(params.quotes);
    if (truth.isQuarantined) {
      return { success: false, reason: `Market truth quarantined: ${truth.quarantineReason}` };
    }

    // 5. Independent Vault Risk Authorizations
    const totalPlatformNav = this.vaultManager.getAllVaults().reduce((sum, v) => sum + v.currentNavLamports, 0n);
    const cohortRequests: VaultAllocationRequest[] = [];
    let representativeRiskAuth = null;

    for (const vid of params.participatingVaultIds) {
      const vault = this.vaultManager.getVault(vid);
      if (!vault) continue;

      const phase = this.lifecycle.evaluatePhase(vid, now);
      if (!phase.allowNewEntries) continue;

      const riskDecision = this.riskEngine.authorizeTrade(
        {
          proposalId: randomUUID(),
          strategyId: params.strategyId,
          strategyVersion: '1.0.0',
          vaultId: vid,
          userId: vault.userId,
          cycleId: vault.currentCycleId ?? 'cycle-1',
          mint: params.tokenSecurity.mint,
          creator: params.tokenSecurity.creator,
          side: 'buy',
          requestedAmountLamports: params.requestedLamportsPerVault,
          expectedSlippageBps: 150,
          expectedPriceImpactBps: 100,
          poolLiquidityLamports: truth.canonicalLiquidityLamports,
          timestamp: now,
        },
        vault,
        phase,
        totalPlatformNav,
        0
      );

      if (riskDecision.disposition === 'APPROVE' || riskDecision.disposition === 'REDUCE') {
        representativeRiskAuth = riskDecision;
        const effectiveLamports = (riskDecision.authorizedAmountLamports * BigInt(Math.round(safetyScale * 100))) / 100n;
        if (effectiveLamports > 0n) {
          cohortRequests.push({
            vaultId: vid,
            userId: vault.userId,
            authorizedAmountLamports: effectiveLamports,
            priorityScore: 100,
          });
        }
      }
    }

    if (cohortRequests.length === 0 || !representativeRiskAuth) {
      return { success: false, reason: 'No vaults passed risk authorization' };
    }

    // 6. Multi-Dimensional Trade Consensus & Adversarial Stress Simulation
    const consensus = this.consensusEngine.evaluateConsensus({
      candidateId: `cand_${randomUUID()}`,
      mint: params.tokenSecurity.mint,
      securityResult: secResult,
      riskAuth: representativeRiskAuth,
      poolLiquidityLamports: truth.canonicalLiquidityLamports,
      alphaScore: params.signalScore,
      momentumScore: params.momentumScore,
      regimeScore: 75,
      walletIntegrityScore: 85,
      executionQualityScore: 80,
      portfolioFitScore: 80,
      expectedEdgeBps: Math.max(600, Math.round(params.signalScore * 10)),
      capacityConstraints: {
        userRiskCapacityLamports: params.requestedLamportsPerVault * BigInt(cohortRequests.length),
        globalRiskCapacityLamports: totalPlatformNav / 10n,
        poolLiquidityLamports: truth.canonicalLiquidityLamports,
        maxAllowableExitImpactBps: 250,
        settlementRemainingHours: 48,
      },
    });

    if (!consensus.overallAccepted) {
      return { success: false, reason: `Consensus blocked entry: ${consensus.entryBlockers.join(', ')}` };
    }

    // 7. Cohort Engine: Fair Pro-Rata Allocation Capped by Exit Capacity
    const cohort = this.cohortEngine.createCohort(
      `cohort_${randomUUID()}`,
      params.tokenSecurity.mint,
      cohortRequests,
      consensus.maxCapacityLamports
    );

    // 8. Immediate Pre-Signing Revalidation
    const reval = this.revalidator.revalidate({
      signalPriceLamports: truth.canonicalPriceLamports,
      maxAllowedSlippageBps: 200,
      maxAllowedPriceImpactBps: 300,
      minRequiredLiquidityLamports: params.tokenSecurity.realQuoteReserveLamports,
      marketTruth: truth,
      orderSizeLamports: cohort.totalAllocatedCapitalLamports,
    });

    if (reval.outcome !== 'PROCEED') {
      return { success: false, reason: `Pre-signing revalidation failed: ${reval.reason}` };
    }

    // Validation can produce a non-financial execution proposal, but this
    // class has neither a real signing/broadcast boundary nor chain evidence.
    // Do not fabricate a transaction, fill, confirmation, or ledger posting.
    if (!this.isEconomicExecutionAvailable()) {
      return {
        success: false,
        reason: ECONOMIC_EXECUTION_UNAVAILABLE,
        plannedCohortId: cohort.cohortId,
        requestedLamports: cohort.totalAllocatedCapitalLamports,
      };
    }

    // 9. Zero-Trust Signer Dispatch
    const txId = `tx_${randomUUID()}`;
    const signResult = this.signer.signTransaction(
      {
        transactionId: txId,
        domain: 'TRADING',
        vaultId: cohortRequests[0].vaultId,
        userId: cohortRequests[0].userId,
        cycleId: 'cycle-1',
        targetProgramId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun
        amountLamports: cohort.totalAllocatedCapitalLamports,
        serializedMessage: new Uint8Array([1, 2, 3]),
        requestedAt: now,
        metadata: { cohortId: cohort.cohortId },
      },
      true
    );

    if (!signResult.success) {
      return { success: false, reason: `Signer rejected: ${signResult.error}` };
    }

    this.signer.recordSubmission(txId);
    this.signer.recordSimulatedConfirmation(txId);

    // 10. Distribute exact integer conservation fills across participating vaults
    const totalFilledTokens = 10_000_000n;
    const executedCohort = this.cohortEngine.distributeExecutionFill(
      cohort,
      totalFilledTokens,
      cohort.totalAllocatedCapitalLamports
    );

    // 11. Record Financial Postings in Immutable Hash-Chained Ledger & Double-Entry Journal
    for (const alloc of executedCohort.allocations) {
      const evt = this.eventLedger.append({
        timestamp: now,
        userId: alloc.vaultId, // maps to user vault
        vaultId: alloc.vaultId,
        cycleId: 'cycle-1',
        type: 'TRADE_ENTRY',
        asset: params.tokenSecurity.mint,
        quantity: (alloc.tokensFilled ?? 0n).toString(),
        solValueLamports: alloc.netLamportsSpent ?? 0n,
        source: params.strategyId,
        reason: 'Cohort buy execution',
      });

      // Debit friction expenses
      this.doubleEntry.postNetworkFriction(evt.eventId, 50_000n, 'Execution network friction');
    }

    // 12. Record Telemetry for AI Risk Sentinel
    this.sentinel.recordTradeTelemetry({
      timestamp: now,
      strategyId: params.strategyId,
      vaultId: cohortRequests[0].vaultId,
      latencyMs: 35,
      slippageBps: reval.priceSlippageBps,
      holdingDurationSec: 0,
      isSuccess: true,
    });

    return {
      success: true,
      cohortId: cohort.cohortId,
      transactionId: txId,
      executedCohort,
    };
  }

  /**
   * Finalize and settle a 72-hour vault cycle.
   */
  public finalizeAndSettleVault(vaultId: string, now = Date.now()) {
    const vault = this.vaultManager.getVault(vaultId);
    if (!vault) throw new Error(`Vault ${vaultId} not found`);

    // Settlement requires independent wallet, chain, signer-journal and ledger
    // evidence. This experimental class has none, so preserve state exactly.
    if (!this.isEconomicExecutionAvailable()) {
      return { success: false, reason: ECONOMIC_SETTLEMENT_UNAVAILABLE, vaultId, requestedAt: now };
    }

    // Transition through lifecycle de-risking and settlement
    let state = vault.state;
    state = this.lifecycle.transition(state, 'PRESERVATION', vaultId);
    state = this.lifecycle.transition(state, 'EXITING', vaultId);
    state = this.lifecycle.transition(state, 'RECONCILING', vaultId);

    // Continuous Multi-Way Reconciliation
    const totalNav = this.vaultManager.getAllVaults().reduce((sum, v) => sum + v.currentNavLamports, 0n);
    const recon = this.reconciler.reconcile({
      onChainBalanceLamports: totalNav,
      signerConfirmedTotalLamports: totalNav,
      ledgerControlledAssetsLamports: totalNav,
      vaultCustomerLiabilitiesLamports: totalNav,
      platformTreasuryLamports: 0n,
      explicitDiscrepancyLamports: 0n,
    });

    if (!recon.isClean) {
      state = this.lifecycle.transition(state, 'RECONCILIATION_FAILED', vaultId);
      vault.state = state;
      return { success: false, reason: 'Reconciliation failed prior to settlement' };
    }

    state = this.lifecycle.transition(state, 'SETTLEMENT_READY', vaultId);

    // Calculate NAV and High-Water Mark Performance Fee
    const navSnap = this.navEngine.calculateNav({
      vaultId,
      cashLamports: vault.currentNavLamports,
      unrealizedPositionsValueLamports: 0n,
      startingNavLamports: vault.startingNavLamports,
      peakNavLamports: vault.peakNavLamports,
      highWaterMarkLamports: vault.highWaterMarkLamports,
      realizedPnlLamports: vault.lifetimeRealizedPnlLamports,
      frictionCostsLamports: 0n,
      lifetimeFeesPaidLamports: vault.lifetimeFeesPaidLamports,
      customFeeBps: this.config.defaultFeeRateBps,
    });

    const feeCrystallization = this.navEngine.crystallizePerformanceFee(navSnap);
    const netPayable = navSnap.netSettlementValueLamports;

    // Settlement Firewall Policy Check
    const destination = this.settlementFirewall.getConfirmedDestination(vaultId);
    if (!destination) {
      return { success: false, reason: 'No confirmed user payout destination found' };
    }

    const settleReq = {
      settlementId: `settle_${randomUUID()}`,
      vaultId,
      userId: vault.userId,
      cycleId: vault.currentCycleId ?? 'cycle-1',
      userDestinationAddress: destination,
      netPayableLamports: netPayable,
      platformFeeLamports: feeCrystallization.feeLamports,
      verifiedLiquidBalanceLamports: navSnap.currentNavLamports,
      isReconciliationClean: recon.isClean,
      cycleState: 'SETTLEMENT_READY',
    };

    const auth = this.settlementFirewall.authorizeSettlement(settleReq);
    if (!auth.approved) {
      return { success: false, reason: `Settlement firewall rejected: ${auth.rejectionReason}` };
    }

    // Execute Zero-Trust Signer for Payout
    state = this.lifecycle.transition(state, 'SETTLEMENT_SUBMITTED', vaultId);
    this.settlementFirewall.recordSubmission(settleReq.settlementId);

    const signRes = this.signer.signTransaction(
      {
        transactionId: `tx_settle_${randomUUID()}`,
        domain: 'SETTLEMENT',
        vaultId,
        userId: vault.userId,
        cycleId: vault.currentCycleId ?? 'cycle-1',
        targetProgramId: '11111111111111111111111111111111', // System Program
        destinationAddress: destination,
        amountLamports: netPayable,
        serializedMessage: new Uint8Array([7, 8, 9]),
        requestedAt: now,
        metadata: { settlementId: settleReq.settlementId },
      },
      true
    );

    if (!signRes.success) {
      state = this.lifecycle.transition(state, 'SETTLEMENT_FAILED', vaultId);
      vault.state = state;
      return { success: false, reason: `Signer rejected settlement: ${signRes.error}` };
    }

    this.settlementFirewall.recordConfirmation(settleReq.settlementId, signRes.result.signature);

    // Ledger and Double-Entry Settlement Postings
    const settleEvt = this.eventLedger.append({
      timestamp: now,
      userId: vault.userId,
      vaultId,
      cycleId: vault.currentCycleId ?? 'cycle-1',
      type: 'SETTLEMENT',
      asset: 'SOL',
      quantity: netPayable.toString(),
      solValueLamports: netPayable,
      source: 'SETTLEMENT_ENGINE',
      reason: '72h autonomous cycle settlement completed',
    });

    if (feeCrystallization.feeLamports > 0n) {
      this.doubleEntry.postPlatformFee(
        settleEvt.eventId,
        feeCrystallization.feeLamports,
        'Crystallized performance fee'
      );
    }

    this.doubleEntry.postSettlementPayable(settleEvt.eventId, netPayable);
    this.doubleEntry.postSettlementPayout(settleEvt.eventId, netPayable);

    state = this.lifecycle.transition(state, 'SETTLED', vaultId);
    state = this.lifecycle.transition(state, 'CLOSED', vaultId);
    vault.state = state;

    return {
      success: true,
      settlementId: settleReq.settlementId,
      signature: signRes.result.signature,
      netPayableLamports: netPayable,
      platformFeeLamports: feeCrystallization.feeLamports,
      newHighWaterMarkLamports: feeCrystallization.newHwmLamports,
    };
  }
}
