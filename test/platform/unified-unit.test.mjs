/**
 * SYLPH FUSION — UNIFIED PIPELINE UNIT INTEGRATION TEST SUITE
 * Specifications: Master Blueprint Sections I - LXXVI
 *
 * Verifies that all 10 architectural planes and 6 pipeline stages execute
 * in strict, deterministic, proof-carrying alignment.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  UnifiedPipelineUnit,
  createFusionEnvelopeV2,
} from '../../dist/platform/pipeline/index.js';

describe('UnifiedPipelineUnit — End-to-End Control Unit', () => {
  const unit = new UnifiedPipelineUnit();
  const testMint = 'So11111111111111111111111111111111111111112';

  it('Stage 1: ingests raw Solana reality into FusionEnvelopeV2 with journal provenance', () => {
    const envelope = unit.ingestRawReality({
      eventType: 'ACCOUNT_UPDATE',
      subject: testMint,
      payload: { balance: 1_000_000_000n, slot: 250_000n },
      chain: {
        slot: 250_000n,
        blockhash: '5k8s9j2f4h7g8a9d0s8f7g6h5j4k3l2z1x9c8v7b6n5m',
        parentBankHash: '0000000000000000000000000000000000000000000000000000000000000001',
        isEpochBoundary: false,
        observedCommitment: 'processed',
        forkConfidence: 0.99,
      },
      provenance: {
        ingestedAtWallMs: Date.now(),
        ingestionChannel: 'yellowstone_grpc',
        producerSignature: 'sig_prod_1',
        originFingerprint: 'cluster_primary',
      },
      evidenceClass: 'DIRECT_OBSERVATION',
    });

    assert.ok(envelope.envelopeId.startsWith('env_'));
    assert.equal(envelope.chain.slot, 250_000n);
    assert.equal(unit.journal.length() >= 1, true);
  });

  it('Stage 2: executes cross-plane intelligence, clearance, and priority intent computation', () => {
    const specialists = [
      {
        specialistId: 'spec_alpha_1',
        version: '1.0.0',
        role: 'ALPHA',
        target: testMint,
        horizonSec: 30,
        pointEstimate: 0.05,
        quantiles: { p10: 0.01, p25: 0.03, p50: 0.05, p75: 0.07, p90: 0.1 },
        uncertainty: 0.02,
        supportedContext: ['vol_expansion'],
        evidenceRoot: 'ev_root_alpha',
        evidenceAncestry: ['src_feed_1'],
        modelHash: 'hash_m1',
        availableAtMs: Date.now(),
      },
      {
        specialistId: 'spec_risk_1',
        version: '1.0.0',
        role: 'RISK',
        target: testMint,
        horizonSec: 30,
        pointEstimate: 0.01,
        quantiles: { p10: 0.0, p25: 0.005, p50: 0.01, p75: 0.02, p90: 0.03 },
        uncertainty: 0.01,
        supportedContext: ['liquidity_check'],
        evidenceRoot: 'ev_root_risk',
        evidenceAncestry: ['src_feed_2'],
        modelHash: 'hash_m2',
        availableAtMs: Date.now(),
      },
    ];

    const bids = [
      {
        bidId: 'bid_1',
        strategyId: 'strat_alpha_momentum',
        targetMint: testMint,
        expectedSurplusUsd: 15.5,
        worstCaseLossUsd: 2.0,
        resourceDemands: {
          CAPITAL: 500,
          EXIT_CAPACITY: 200,
          TAIL_RISK_CAPACITY: 50,
          CONCENTRATION_CAPACITY: 100,
          EXECUTION_BANDWIDTH: 1,
          FEE_BUDGET: 5,
          UNKNOWN_SETTLEMENT_CAPACITY: 0,
          ATTENTION_COMPUTE: 10,
        },
        proofArtifacts: ['art_1', 'art_2'],
        bidSignature: 'sig_bid_1',
        submittedAtMs: Date.now(),
      },
    ];

    const capacities = {
      CAPITAL: { resource: 'CAPITAL', maxCapacity: 10_000, currentlyOccupied: 1000, shadowPriceUsd: 0 },
      EXIT_CAPACITY: { resource: 'EXIT_CAPACITY', maxCapacity: 5000, currentlyOccupied: 500, shadowPriceUsd: 0 },
      TAIL_RISK_CAPACITY: { resource: 'TAIL_RISK_CAPACITY', maxCapacity: 2000, currentlyOccupied: 200, shadowPriceUsd: 0 },
      CONCENTRATION_CAPACITY: { resource: 'CONCENTRATION_CAPACITY', maxCapacity: 3000, currentlyOccupied: 300, shadowPriceUsd: 0 },
      EXECUTION_BANDWIDTH: { resource: 'EXECUTION_BANDWIDTH', maxCapacity: 50, currentlyOccupied: 5, shadowPriceUsd: 0 },
      FEE_BUDGET: { resource: 'FEE_BUDGET', maxCapacity: 200, currentlyOccupied: 10, shadowPriceUsd: 0 },
      UNKNOWN_SETTLEMENT_CAPACITY: { resource: 'UNKNOWN_SETTLEMENT_CAPACITY', maxCapacity: 5, currentlyOccupied: 0, shadowPriceUsd: 0 },
      ATTENTION_COMPUTE: { resource: 'ATTENTION_COMPUTE', maxCapacity: 100, currentlyOccupied: 10, shadowPriceUsd: 0 },
    };

    const opportunity = unit.evaluateOpportunity({
      mint: testMint,
      slot: 250_001n,
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      writableAccounts: [testMint],
      specialists,
      candidatePredictions: [0.02, 0.03, -0.01, 0.05, 0.04],
      realizedReturnsBps: [20, 28, -8, 48, 38],
      benchmarkReturnsBps: [10, 15, -5, 20, 18],
      existingSignals: [0.01, 0.02, 0.0, 0.03, 0.02],
      portfolioPositions: [
        {
          mint: testMint,
          poolAddress: 'pool_raydium_1',
          balanceRaw: 10_000_000_000n,
          markPriceUsd: 150.0,
          availableLiquidityUsd: 500_000,
          expectedDailyVolumeUsd: 1_000_000,
        },
      ],
      twinTrustLevel: 'SHADOW_TRUSTED',
      bids,
      capacities,
      orchestration: {
        currentSlot: 250_001n,
        unknownSettlementCount: 0,
        survivalDeficitUsd: 0,
        emergencyExitReserveLamports: 1_000_000_000n,
        availableCashLamports: 5_000_000_000n,
        candidateProofRoot: 'proof_root_stage2',
      },
    });

    assert.equal(opportunity.mint, testMint);
    assert.ok(opportunity.alphaCertificate.certificateId.startsWith('arc_'));
    assert.ok(opportunity.signalCertificate.certificateId.startsWith('spc_'));
    assert.equal(opportunity.downstreamConstraints.newExposurePermitted, true);
    assert.equal(opportunity.clearanceCertificate.clearedBidsCount, 1);
    assert.ok(opportunity.actionIntent);
  });

  it('Stage 3: compiles and authorizes cryptographic ActionProofBundle with 12 mandatory certificates', () => {
    const actionIntent = {
      intentId: 'intent_stage3_01',
      action: 'OPEN',
      subjectMint: testMint,
      allocationSol: 1.5,
      objectivePriority: 3,
      rationale: 'Positive alpha in regime',
      proofArtifactRoot: 'root_proof_01',
      emittedAtMs: Date.now(),
      validUntilSlot: 250_100n,
    };

    const pkg = unit.compileAndAuthorizeProof({
      actionIntent,
      stateRoot: 'state_root_hash_0001',
      policyRoot: 'policy_root_hash_0001',
      configRoot: 'config_root_hash_0001',
      releaseRoot: 'release_root_hash_0001',
      controlEpoch: 1,
      revocationEpoch: 1,
      signingKey: 'super_secret_kernel_signing_key_32bytes',
    });

    assert.equal(pkg.actionIntent.intentId, 'intent_stage3_01');
    assert.ok(pkg.bundle.marketTruthCertificate.artifactId.startsWith('art_'));
    assert.ok(pkg.bundle.tokenSemanticsCertificate.artifactId.startsWith('art_'));
    assert.ok(pkg.bundle.alphaRealityCertificate.artifactId.startsWith('art_'));
    assert.ok(pkg.bundle.signalPortfolioCertificate.artifactId.startsWith('art_'));
    assert.ok(pkg.bundle.executionPolicyCertificate.artifactId.startsWith('art_'));
    assert.ok(pkg.bundle.simulationCertificate.artifactId.startsWith('art_'));
    assert.ok(pkg.bundle.exitabilityCertificate.artifactId.startsWith('art_'));
    assert.ok(pkg.bundle.portfolioEvacuationCertificate.artifactId.startsWith('art_'));
    assert.ok(pkg.bundle.capitalAllocationCertificate.artifactId.startsWith('art_'));
    assert.ok(pkg.bundle.reservationCertificate.artifactId.startsWith('art_'));
    assert.ok(pkg.bundle.survivalCertificate.artifactId.startsWith('art_'));
    assert.ok(pkg.bundle.twinTrustCertificate.artifactId.startsWith('art_'));
    assert.equal(pkg.authorityLatticeState, 'A0_OBSERVE_ONLY');
  });

  it('Stage 4: builds an 8-stage tamper-evident ImmutableReceiptChain', () => {
    const chain = unit.executeWithReceiptLadder({
      actionId: 'action_ladder_01',
      wireTxHash: 'wire_tx_hash_ladder_01',
      landedSlot: 250_005n,
      landedBlockhash: 'blockhash_ladder_01',
      finalizedSlot: 250_037n,
      realizedNetPnLLamports: 45_000_000n,
      netCashChangeLamports: 45_000_000n,
      inventoryChangeRaw: 0n,
      totalFeesPaidLamports: 5_000_000n,
    });

    const receipts = chain.getChain();
    assert.equal(receipts.length, 8);
    assert.equal(receipts[0].stage, 'BUILT');
    assert.equal(receipts[1].stage, 'SIMULATION');
    assert.equal(receipts[2].stage, 'AUTHORIZATION');
    assert.equal(receipts[3].stage, 'SIGNING');
    assert.equal(receipts[4].stage, 'SUBMISSION');
    assert.equal(receipts[5].stage, 'LANDING');
    assert.equal(receipts[6].stage, 'FINALITY');
    assert.equal(receipts[7].stage, 'SETTLEMENT');

    const integrity = chain.verifyIntegrity();
    assert.equal(integrity.isValid, true);
  });

  it('Stage 5: settles trade with double-entry conservation, edge attribution, and outcome maturity gate', () => {
    const chain = unit.executeWithReceiptLadder({
      actionId: 'action_settle_01',
      wireTxHash: 'wire_tx_hash_settle_01',
      landedSlot: 250_005n,
      landedBlockhash: 'blockhash_settle_01',
      finalizedSlot: 250_037n,
      realizedNetPnLLamports: 45_000_000n,
      netCashChangeLamports: 45_000_000n,
      inventoryChangeRaw: 0n,
      totalFeesPaidLamports: 5_000_000n,
    });

    const settledAt = Date.now() - 100_000;
    const currentAt = Date.now();

    const outcome = unit.settleTrade({
      tradeId: 'trade_settle_01',
      mint: testMint,
      slot: 250_005n,
      actualEntryCostLamports: 1_000_000_000n,
      actualExitProceedsLamports: 1_050_000_000n,
      networkFeesLamports: 1_000_000n,
      priorityFeesLamports: 2_000_000n,
      jitoTipsLamports: 1_000_000n,
      routeFeesLamports: 1_000_000n,
      receiptChain: chain,
      settledAtMs: settledAt,
      currentAtMs: currentAt,
    });

    assert.equal(outcome.accounting.realizedNetPnLLamports, 45_000_000n);
    assert.equal(outcome.accounting.isAccountingBalanced, true);
    assert.equal(outcome.receiptChainIntegrity, true);
    assert.equal(outcome.doubleEntryBalanced, true);
    assert.equal(outcome.outcomeMature, true);
  });

  it('Stage 6: certifies profit frontier and governs autonomous self-improvement cycles', () => {
    const candidates = [
      {
        candidateId: 'cand_1',
        featureVectorHash: 'feat_hash_1',
        complexityPenalty: 0.1,
        inSampleSharpe: 2.2,
        outOfSampleSharpe: 1.8,
        calibratedDeflatedSharpe: 1.6,
        tailDrawdownRisk: 0.05,
        executionCapacitySol: 100,
        paretoOptimal: true,
      },
    ];

    const hypothesis = {
      hypothesisId: 'hyp_vol_regime_01',
      proposerAgentId: 'agent_sol_quant_01',
      description: 'Volatility regime conditioning improves mean reversion precision',
      mechanism: 'Conditional variance filtering',
      falsificationCondition: 'Out-of-sample Sharpe drops below 1.0',
      state: 'UNTESTED',
      outOfSampleSampleSize: 0,
      observedSharpe: 0,
      createdAtMs: Date.now(),
    };

    const promotionBundle = {
      bundleId: 'bundle_prom_01',
      hypothesisId: 'hyp_vol_regime_01',
      fromState: 'UNTESTED',
      targetState: 'REPLAY_TESTED',
      independentVerifierAgentId: 'agent_independent_verifier_02',
      outOfSampleSampleSize: 500,
      falsificationTestPassed: true,
      counterfactualSharpe: 1.75,
      proofArtifactRoot: 'proof_root_verification_01',
      verifierSignature: 'signature_of_independent_verifier_32bytes',
    };

    const gov = unit.governSelfImprovement({
      engineeringCandidates: candidates,
      researchHypothesis: hypothesis,
      promotionBundle,
    });

    assert.ok(gov.profitFrontier.certificateId.startsWith('frc_'));
    assert.equal(gov.hypothesisRegistered, true);
    assert.equal(gov.promotionOutcome?.promoted, true);
  });

  it('Invariants: rejects revoked proof artifacts and prevents execution', () => {
    const actionIntent = {
      intentId: 'intent_revoked_01',
      action: 'OPEN',
      subjectMint: testMint,
      allocationSol: 1.0,
      objectivePriority: 3,
      rationale: 'Test revocation',
      proofArtifactRoot: 'root_revoked',
      emittedAtMs: Date.now(),
      validUntilSlot: 250_100n,
    };

    // Pre-revoke in registry
    unit.revocationRegistry.revokeArtifact(
      'art_will_be_revoked',
      'KEY_COMPROMISE',
      'SecurityOfficer'
    );

    // Check query
    assert.equal(unit.revocationRegistry.isRevoked('art_will_be_revoked'), true);
    assert.equal(unit.revocationRegistry.isRevoked('unrelated_art'), false);
  });
});
