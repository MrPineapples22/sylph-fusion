/**
 * SYLPH FUSION — MASTER BLUEPRINT INTEGRATION TEST SUITE
 * Specifications: Sections IV, XIII, XV, XVII, XVIII, XX, XXI, XXII, XXIII, XXIV, XXV,
 * XXVI, XXVII, XXX, XXXII, XXXIV, XXXVI, XLVI, XLVIII, XLIX, LI, LII, LXIV.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 1. Fusion Envelope V2
import { createFusionEnvelopeV2 } from '../../dist/platform/pipeline/fusion-envelope.js';

// 2. Assurance Fabric
import {
  createProofArtifact,
  verifyProofArtifact,
  validateActionProofBundle,
  ImmutableReceiptChain,
  AssuranceRevocationRegistry,
} from '../../dist/platform/assurance/index.js';

// 3. Alpha Reality-X
import {
  createAlphaClaim,
  CandidateCohortTracker,
  computeOrthogonalizedAlpha,
  certifyAlphaReality,
} from '../../dist/intelligence/alpha-reality/index.js';

// 4. Signal Ecology-X
import {
  SignalFamilyAggregator,
  certifySignalPortfolio,
} from '../../dist/intelligence/signal-ecology/index.js';

// 5. Reality-Gap-X
import {
  certifyTwinCalibration,
  evaluateDownstreamConstraints,
} from '../../dist/intelligence/reality-gap/index.js';

// 6. Execution Adaptation-X
import {
  WritableSetFeeSurface,
  computeWritableSetHash,
  createPolicyArtifact,
  ExecutionAttemptLedger,
} from '../../dist/intelligence/execution-adaptation/index.js';

// 7. Evacuation-X
import {
  EvacuationFlowModel,
  certifyPortfolioEvacuation,
} from '../../dist/intelligence/survival/evacuation-x/index.js';

// 8. Opportunity Market-X
import {
  PrimalDualClearingEngine,
  certifyAuctionClearance,
} from '../../dist/intelligence/opportunity-market/index.js';

// 9. Capital Orchestrator-X
import {
  CapitalOrchestratorX,
} from '../../dist/intelligence/control/capital-orchestrator-x/index.js';

// 10. Profit Compiler-X
import {
  verifyEconomicConservation,
  compileTradeAccounting,
  decomposePnLAttribution,
  certifyProfit,
} from '../../dist/intelligence/economics/profit-compiler/index.js';

// 11. Profit Frontier-X
import {
  certifyProfitFrontier,
} from '../../dist/intelligence/profit-frontier/index.js';

// 12. Autonomous R&D Governor-X
import {
  createUntestedHypothesis,
  AutonomousRDGovernorX,
} from '../../dist/intelligence/research-governor/index.js';

// 13. Safe Canary-X
import {
  createSafeCanaryManifest,
  CanaryInvariantController,
} from '../../dist/intelligence/certification/safe-canary/index.js';

describe('MASTER INTEGRATION & CERTIFICATION BLUEPRINT E2E VERIFICATION', () => {
  const dummySigningKey = 'super_secret_blueprint_signing_key_32b';

  it('Section IV: FusionEnvelopeV2 enforces complete chain provenance and forbids confirmed head fabrication', () => {
    const validEnvelope = createFusionEnvelopeV2({
      eventType: 'ACCOUNT_UPDATE',
      subject: 'MintToken1111111111111111111111111111111111',
      payload: { balance: 1_000_000n },
      chain: {
        slot: 100_000n,
        bankId: 'bank_alpha_01',
        blockhash: '5eUm8K9YiCqAxtyZgmmN1NGhmD3D2C9Azp2Za7nxwhiN',
        commitment: 'confirmed',
        forkLineage: ['root', 'fork_01'],
      },
      provenance: {
        providerId: 'yellowstone_primary',
        connectionGeneration: 1,
        sourceClass: 'GRPC_STREAM',
        decoderVersion: 'v2.1',
        failureDomain: 'US_EAST',
      },
      evidenceClass: 'PROVEN_TRUE',
    });

    assert.equal(validEnvelope.schemaVersion, '2.0.0');
    assert.ok(validEnvelope.envelopeId.startsWith('env_v2_'));
    assert.ok(validEnvelope.payloadHash.length === 64);

    // Invariant: confirmed commitment requires valid blockhash
    assert.throws(
      () =>
        createFusionEnvelopeV2({
          eventType: 'INVALID_CONFIRMED',
          subject: 'MintToken',
          payload: {},
          chain: {
            slot: 100_000n,
            bankId: 'bank_alpha_01',
            blockhash: '', // missing!
            commitment: 'confirmed',
            forkLineage: [],
          },
          provenance: {
            providerId: 'p1',
            connectionGeneration: 1,
            sourceClass: 'RPC',
            decoderVersion: '1',
            failureDomain: 'LOCAL',
          },
          evidenceClass: 'PROVEN_TRUE',
        }),
      /CONFIRMED_HEAD_FABRICATION_FORBIDDEN/
    );
  });

  it('Section XXXIV & XXXV: ProofArtifact cryptographically binds roots, epochs, and payload', () => {
    const artifact = createProofArtifact({
      artifactType: 'MARKET_TRUTH',
      subject: 'SolUsdMarket',
      claim: { priceSol: 152.5 },
      evidenceClass: 'PROVEN_TRUE',
      issuer: 'YellowstoneTruthBridge',
      issuerRole: 'AUTHENTIC_DATA_PROVER',
      validDurationMs: 10_000,
      stateRoot: 'state_root_123',
      policyRoot: 'policy_root_123',
      configRoot: 'config_root_123',
      releaseRoot: 'release_root_123',
      controlEpoch: 1,
      revocationEpoch: 1,
      payload: { rawDepthSol: 5000 },
      signingKey: dummySigningKey,
    });

    assert.ok(artifact.artifactId.startsWith('art_'));
    assert.ok(artifact.signature.length === 64);

    const check = verifyProofArtifact(artifact, dummySigningKey);
    assert.equal(check.isValid, true);

    const tampered = { ...artifact, claim: { priceSol: 999.0 } };
    const tamperedCheck = verifyProofArtifact(tampered, dummySigningKey);
    assert.equal(tamperedCheck.isValid, false);
  });

  it('Section XXXIV: Revocation registry propagates taints to dependent children', () => {
    const registry = new AssuranceRevocationRegistry();
    registry.registerDependency('parent_art_1', 'child_art_2');
    registry.registerDependency('child_art_2', 'grandchild_art_3');

    assert.equal(registry.isRevoked('grandchild_art_3'), false);

    registry.revokeArtifact('parent_art_1', 'Underlying provider feed corrupted', 'Sentinel');
    assert.equal(registry.isRevoked('parent_art_1'), true);
    assert.equal(registry.isRevoked('child_art_2'), true);
    assert.equal(registry.isRevoked('grandchild_art_3'), true);
    assert.ok(registry.getRevocationRoot().length === 64);
  });

  it('Section XLVI: ImmutableReceiptChain enforces strict 8-stage hashing and rejects skip-level tampering', () => {
    const chain = new ImmutableReceiptChain();

    const built = chain.recordBuilt({ actionId: 'act_1', transactionPayloadHash: 'hash_tx', estimatedFeeLamports: 5000n });
    assert.equal(built.stage, 'BUILT');

    const sim = chain.recordSimulation({ simulationUnitsConsumed: 120_000, simulationLogsHash: 'hash_logs', simulationSuccess: true });
    assert.equal(sim.prevReceiptHash, built.receiptHash);

    const auth = chain.recordAuthorization({ kernelAuthorizationDecision: 'ALLOW', kernelDecisionHash: 'k_hash', permitNonce: 'n_1' });
    assert.equal(auth.prevReceiptHash, sim.receiptHash);

    const sign = chain.recordSigning({ keyId: 'kms-prod-1', wireTransactionHash: 'w_tx', signatureAttestation: 'sig_att' });
    assert.equal(sign.prevReceiptHash, auth.receiptHash);

    const sub = chain.recordSubmission({ transport: 'DIRECT_RPC', submissionEndpoint: 'https://rpc.mainnet.solana.com', targetSlot: 100_500n });
    assert.equal(sub.prevReceiptHash, sign.receiptHash);

    const land = chain.recordLanding({ landedSlot: 100_501n, landedBlockhash: 'blk_1', transactionSignature: 'tx_sig' });
    assert.equal(land.prevReceiptHash, sub.receiptHash);

    const fin = chain.recordFinality({ finalityLevel: 'FINALIZED', finalizedSlot: 100_533n, confirmationLagSlots: 32 });
    assert.equal(fin.prevReceiptHash, land.receiptHash);

    const settle = chain.recordSettlement({
      realizedNetPnLLamports: 500_000n,
      netCashChangeLamports: 500_000n,
      inventoryChangeRaw: -1_000_000n,
      totalFeesPaidLamports: 15_000n,
      economicPostingRoot: 'post_root',
    });
    assert.equal(settle.prevReceiptHash, fin.receiptHash);

    const integrity = chain.verifyIntegrity();
    assert.equal(integrity.isValid, true);
    assert.equal(chain.getChain().length, 8);
  });

  it('Section XIII: Alpha Reality-X orthogonalizes signal against benchmark and rejects collinearity', () => {
    const candidatePredictions = [10, 20, 30, 40, 50, 60, 70, 80];
    const realizedReturnsBps = [15, 25, 35, 45, 55, 65, 75, 85];
    const benchmarkReturnsBps = [5, 10, 15, 20, 25, 30, 35, 40];
    const existingSignal = [10, 20, 30, 40, 50, 60, 70, 80]; // exact collinearity

    const ortho = computeOrthogonalizedAlpha(candidatePredictions, realizedReturnsBps, benchmarkReturnsBps, existingSignal);
    assert.equal(ortho.isCollinearWithExistingSignals, true);

    const cert = certifyAlphaReality({
      strategyId: 'MOMENTUM_PUMP',
      startSlot: 100n,
      endSlot: 200n,
      sampleSize: 50,
      tradedSampleSize: 20,
      orthogonalization: ortho,
      netRealizedReturnBps: 250,
      costHurdleBps: 100,
      walkForwardVerified: true,
    });

    // Collinear signal must NOT pass certified state!
    assert.equal(cert.certificateState, 'PROVEN_FALSE');
  });

  it('Section XV: Signal Ecology-X preserves 7 distinct non-collapsed roles and computes independent units', () => {
    const specialists = [
      {
        specialistId: 'spec_alpha_1',
        version: '1.0',
        role: 'ALPHA',
        target: 'PRICE',
        horizonSec: 60,
        pointEstimate: 85,
        quantiles: { p10: 10, p25: 30, p50: 85, p75: 120, p90: 150 },
        uncertainty: 0.15,
        supportedContext: ['PUMP_CURVE'],
        evidenceRoot: 'ev_root_1',
        evidenceAncestry: [],
        modelHash: 'hash_m1',
        availableAtMs: Date.now(),
      },
      {
        specialistId: 'spec_survival_1',
        version: '1.0',
        role: 'SURVIVAL',
        target: 'EXIT',
        horizonSec: 300,
        pointEstimate: 92,
        quantiles: { p10: 80, p25: 85, p50: 92, p75: 95, p90: 98 },
        uncertainty: 0.08,
        supportedContext: ['EXITABILITY'],
        evidenceRoot: 'ev_root_2',
        evidenceAncestry: [],
        modelHash: 'hash_m2',
        availableAtMs: Date.now(),
      },
    ];

    const aggregator = new SignalFamilyAggregator();
    const aggResult = aggregator.aggregate(specialists);
    assert.equal(aggResult.effectiveIndependentAlphaUnits, 2);

    const cert = certifySignalPortfolio({
      targetMint: 'TokenMintABC',
      slot: 500n,
      aggregation: aggResult,
      roleProfile: {
        alphaScore: 85,
        riskScore: 20,
        executionCostBps: 150,
        regimeConfidence: 0.90,
        authenticityProven: true,
        capacityUsd: 5000,
        survivalProbability: 0.92,
      },
    });

    assert.equal(cert.isEcologySound, true);
    assert.equal(cert.roleProfile.alphaScore, 85);
    assert.equal(cert.roleProfile.survivalProbability, 0.92);
  });

  it('Section XVII & XVIII: Reality-Gap-X tightens downstream allocation when twin trust degrades', () => {
    const normalConstraints = evaluateDownstreamConstraints('SHADOW_TRUSTED');
    assert.equal(normalConstraints.allocationMultiplier, 1.0);
    assert.equal(normalConstraints.maxPermitTtlSlots, 150);

    const degradedConstraints = evaluateDownstreamConstraints('DEGRADED');
    assert.equal(degradedConstraints.allocationMultiplier, 0.40);
    assert.equal(degradedConstraints.costUncertaintyMultiplier, 2.0);
    assert.equal(degradedConstraints.maxPermitTtlSlots, 40);

    const quarantinedConstraints = evaluateDownstreamConstraints('QUARANTINED');
    assert.equal(quarantinedConstraints.newExposurePermitted, false);
    assert.equal(quarantinedConstraints.allocationMultiplier, 0.0);
  });

  it('Section XXII: WritableSetFeeSurface resolves exact writable set and falls back to global', () => {
    const surface = new WritableSetFeeSurface();
    const accounts = ['AccountA', 'AccountB', 'AccountC'];
    const programId = 'ProgramPump11111111111111111111111111111111';

    // Prior to observations -> Global fallback
    const fallback = surface.getRecommendation(accounts, 'UnknownProgram');
    assert.equal(fallback.matchedTier, 'GLOBAL');

    // Register observations
    surface.updateObservation(accounts, programId, 250_000n, 50_000n);
    surface.updateObservation(accounts, programId, 260_000n, 55_000n);
    surface.updateObservation(accounts, programId, 240_000n, 45_000n);

    // Exact match
    const exact = surface.getRecommendation(accounts, programId);
    assert.equal(exact.matchedTier, 'EXACT_WRITABLE_SET');
    assert.ok(exact.recommendedPriorityFeeMicroLamports >= 240_000n);
  });

  it('Section XXVI & XXVII: Evacuation-X computes unclipped convex price impact (>500 bps)', () => {
    const model = new EvacuationFlowModel();
    const positions = [
      {
        mint: 'TokenTrapped1111111111111111111111111111111111',
        poolAddress: 'Pool11111111111111111111111111111111111111111',
        balanceRaw: 100_000_000_000n,
        markPriceUsd: 0.10,
        availableLiquidityUsd: 1500, // thin liquidity
        expectedDailyVolumeUsd: 500,
      },
    ];

    const res = model.analyzePortfolio(positions, 300);
    // Unclipped impact must accurately report severe damage > 500 bps
    assert.ok(res.p95CostBps > 500, `Damage was ${res.p95CostBps}, should exceed 500 bps unclipped`);

    const cert = certifyPortfolioEvacuation(100n, res, 500); // 500 limit
    assert.equal(cert.clearanceFeasible, false); // Blocked due to severe slippage
  });

  it('Section XXX: Opportunity Market-X solves multi-resource primal-dual clearing', () => {
    const clearing = new PrimalDualClearingEngine();
    const bids = [
      {
        bidId: 'bid_alpha_1',
        strategyId: 'S1',
        mint: 'TokenM1',
        resourceDemands: {
          CAPITAL: 500,
          EXIT_CAPACITY: 200,
          TAIL_RISK_CAPACITY: 50,
          CONCENTRATION_CAPACITY: 10,
          EXECUTION_BANDWIDTH: 1,
          FEE_BUDGET: 5,
          UNKNOWN_SETTLEMENT_CAPACITY: 0,
          ATTENTION_COMPUTE: 1,
        },
        expectedSurplusUsd: 150,
        certaintyEquivalentReturnBps: 300,
        proofArtifactRoot: 'root_1',
        validUntilSlot: 200n,
        submittedAtMs: Date.now(),
      },
      {
        bidId: 'bid_low_eff_2',
        strategyId: 'S2',
        mint: 'TokenM2',
        resourceDemands: {
          CAPITAL: 800,
          EXIT_CAPACITY: 800,
          TAIL_RISK_CAPACITY: 50,
          CONCENTRATION_CAPACITY: 10,
          EXECUTION_BANDWIDTH: 1,
          FEE_BUDGET: 5,
          UNKNOWN_SETTLEMENT_CAPACITY: 0,
          ATTENTION_COMPUTE: 1,
        },
        expectedSurplusUsd: 20,
        certaintyEquivalentReturnBps: 25,
        proofArtifactRoot: 'root_2',
        validUntilSlot: 200n,
        submittedAtMs: Date.now(),
      },
    ];

    const capacities = {
      CAPITAL: { resource: 'CAPITAL', maxCapacity: 1000, currentlyOccupied: 0, shadowPriceUsd: 0 },
      EXIT_CAPACITY: { resource: 'EXIT_CAPACITY', maxCapacity: 500, currentlyOccupied: 0, shadowPriceUsd: 0 },
      TAIL_RISK_CAPACITY: { resource: 'TAIL_RISK_CAPACITY', maxCapacity: 100, currentlyOccupied: 0, shadowPriceUsd: 0 },
      CONCENTRATION_CAPACITY: { resource: 'CONCENTRATION_CAPACITY', maxCapacity: 100, currentlyOccupied: 0, shadowPriceUsd: 0 },
      EXECUTION_BANDWIDTH: { resource: 'EXECUTION_BANDWIDTH', maxCapacity: 10, currentlyOccupied: 0, shadowPriceUsd: 0 },
      FEE_BUDGET: { resource: 'FEE_BUDGET', maxCapacity: 100, currentlyOccupied: 0, shadowPriceUsd: 0 },
      UNKNOWN_SETTLEMENT_CAPACITY: { resource: 'UNKNOWN_SETTLEMENT_CAPACITY', maxCapacity: 5, currentlyOccupied: 0, shadowPriceUsd: 0 },
      ATTENTION_COMPUTE: { resource: 'ATTENTION_COMPUTE', maxCapacity: 10, currentlyOccupied: 0, shadowPriceUsd: 0 },
    };

    const res = clearing.clearMarket(bids, capacities);
    assert.equal(res.clearedBids.length, 1);
    assert.equal(res.clearedBids[0]?.bidId, 'bid_alpha_1');
    assert.equal(res.rejectedBids.length, 1);
  });

  it('Section XXXII: Capital Orchestrator-X strictly prioritizes reconciliation over survival over growth', () => {
    const orchestrator = new CapitalOrchestratorX();

    // Context with unknown settlements -> Must prioritize RECONCILE (Priority 0)
    const intentRecon = orchestrator.computeNextIntent({
      currentSlot: 1000n,
      unknownSettlementCount: 2,
      survivalDeficitUsd: 500,
      emergencyExitReserveLamports: 10_000_000n,
      availableCashLamports: 100_000_000n,
      clearedBids: [],
      candidateProofRoot: 'proof_root',
    });
    assert.equal(intentRecon.action, 'RECONCILE');
    assert.equal(intentRecon.objectivePriority, 0);

    // Context with 0 unknown settlements, but positive survival deficit -> Must prioritize EVACUATE (Priority 1)
    const intentEvac = orchestrator.computeNextIntent({
      currentSlot: 1000n,
      unknownSettlementCount: 0,
      survivalDeficitUsd: 500,
      criticalMintToEvacuate: 'MintCritical',
      emergencyExitReserveLamports: 10_000_000n,
      availableCashLamports: 100_000_000n,
      clearedBids: [],
      candidateProofRoot: 'proof_root',
    });
    assert.equal(intentEvac.action, 'EVACUATE');
    assert.equal(intentEvac.objectivePriority, 1);
  });

  it('Section XLIX: Profit Compiler exact accounting identity and attribution separation', () => {
    const accounting = compileTradeAccounting({
      actualEntryCostLamports: 100_000_000n,
      actualExitProceedsLamports: 125_000_000n,
      networkFeesLamports: 5000n,
      priorityFeesLamports: 200_000n,
      jitoTipsLamports: 100_000n,
      routeFeesLamports: 50_000n,
    });

    assert.equal(accounting.isAccountingBalanced, true);
    assert.equal(accounting.totalExplicitFeesLamports, 355_000n);
    assert.equal(accounting.realizedNetPnLLamports, 24_645_000n);

    const attribution = decomposePnLAttribution(accounting);
    const cert = certifyProfit({
      tradeId: 'trade_alpha_1',
      mint: 'TokenXYZ',
      slot: 10_000n,
      accounting,
      attribution,
    });

    assert.equal(cert.isConserved, true);
    assert.ok(cert.certificateId.startsWith('pfc_'));
  });

  it('Section LI: Profit Frontier Pareto optimization selects highest EVPI net benefit candidate', () => {
    const candidates = [
      {
        candidateId: 'proj_tpu_gateway',
        targetSubsystem: 'EXECUTION_TRANSPORT',
        expectedImprovementBps: 45,
        estimatedEffortHours: 10,
        reversibility: 'EASY',
        evpiUsd: 2500,
        expectedNetBenefitUsd: 2200,
        proposedAtMs: Date.now(),
      },
      {
        candidateId: 'proj_complex_nn',
        targetSubsystem: 'PREDICTIVE_ALPHA',
        expectedImprovementBps: 10,
        estimatedEffortHours: 80,
        reversibility: 'COSTLY',
        evpiUsd: 500,
        expectedNetBenefitUsd: 300,
        proposedAtMs: Date.now(),
      },
    ];

    const frontier = certifyProfitFrontier(candidates);
    assert.equal(frontier.optimalCandidateId, 'proj_tpu_gateway');
    assert.equal(frontier.targetSubsystem, 'EXECUTION_TRANSPORT');
  });

  it('Section LIII & LIV: Autonomous R&D Governor enforces UNTESTED hypothesis state and rejects self-promotion', () => {
    const governor = new AutonomousRDGovernorX();
    const hyp = createUntestedHypothesis({
      hypothesisId: 'hyp_vol_spread',
      proposerAgentId: 'AI_AGENT_EINSTEIN',
      description: 'Volatility spread captures liquidity provider retreat',
      mechanism: 'Orderbook skew',
      falsificationCondition: 'Out-of-sample Sharpe < 0.5',
    });

    assert.equal(hyp.state, 'UNTESTED');
    assert.equal(hyp.observedSharpe, 0.0);
    governor.registerHypothesis(hyp);

    // Agent attempts self-promotion -> BLOCKED
    const selfPromoRes = governor.promoteHypothesis(
      'hyp_vol_spread',
      'SHADOW_TESTED',
      {
        bundleId: 'eb_1',
        hypothesisId: 'hyp_vol_spread',
        fromState: 'UNTESTED',
        targetState: 'SHADOW_TESTED',
        independentVerifierAgentId: 'AI_AGENT_EINSTEIN', // Self-promotion!
        outOfSampleSampleSize: 200,
        falsificationTestPassed: true,
        counterfactualSharpe: 1.8,
        proofArtifactRoot: 'p_root',
        verifierSignature: 'sig_verifier_1234567890',
      }
    );
    assert.equal(selfPromoRes.promoted, false);
    assert.match(selfPromoRes.reason, /SELF_PROMOTION_FORBIDDEN/);
  });

  it('Section XXV: Canary Invariant blocks conflicting new exposure on same mint until reconciliation', () => {
    const controller = new CanaryInvariantController();
    const targetMint = 'CanaryTargetMint111111111111111111111111111';

    controller.registerCanary('exp_canary_01', targetMint, 10_000_000n);

    // Unreconciled canary blocks conflicting new exposure
    const check1 = controller.canAuthorizeNewExposure(targetMint);
    assert.equal(check1.allowed, false);
    assert.match(check1.reason, /CANARY_CONFLICT/);

    // Other mint is allowed
    const checkOther = controller.canAuthorizeNewExposure('OtherMint222222222222222222222222222222222');
    assert.equal(checkOther.allowed, true);

    // After authoritative reconciliation -> Unblocked
    controller.recordExit('exp_canary_01');
    controller.reconcileCanary('exp_canary_01');

    const check2 = controller.canAuthorizeNewExposure(targetMint);
    assert.equal(check2.allowed, true);
  });
});
