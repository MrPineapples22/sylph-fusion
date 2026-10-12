import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { DualPathReconciliationEngine } from '../../dist/platform/ingestion/dual-path-reconciler.js';

function createMockEvent(overrides = {}) {
  const now = Date.now();
  const sourceAt = now - 20;
  return {
    eventId: 'evt_pass66_dual_path_001',
    eventType: 'TOKEN_CREATE',
    mint: 'DualPathToken11111111111111111111111111111',
    slot: 290001000,
    timestamp: now,
    timestampNs: BigInt(sourceAt) * 1_000_000n,
    sourceTimestampMs: sourceAt,
    receivedTimestampMs: now,
    sequenceId: 1,
    chainState: 'CONFIRMED',
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
    signature: '5w7D9kQ7Y4F8s2P1vL3kZ8jX6mN9bV4cT2rE1wQ8uI7oP6aS4dF2gH5jK9lZ3x',
    payload: {
      mint: 'DualPathToken11111111111111111111111111111',
      signature: '5w7D9kQ7Y4F8s2P1vL3kZ8jX6mN9bV4cT2rE1wQ8uI7oP6aS4dF2gH5jK9lZ3x',
      tokenAmount: 1000,
      amountSol: 30.0,
      priceSol: 0.00004,
      symbol: 'DPR66',
      creator: 'CreatorWalletAlpha1111111111111111111111111',
      initialLiquiditySol: 30.0,
    },
    ...overrides,
  };
}

import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

describe('Pass 66: Dual-Path Protocol Reconciliation Engine & Conflicting Trade Discrepancy Firewall (REQ-085)', () => {
  const sampleIx = {
    protocol: 'PUMP_FUN',
    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    instructionIndex: 3,
    innerInstructionIndex: null,
    tokenMint: 'DualPathToken11111111111111111111111111111',
    userPubkey: 'TraderAccount11111111111111111111111111111',
    discriminator: '0x33e685a4017f83ad',
    rawAmountIn: 1_500_000_000n,
    rawAmountOut: 75_000_000_000n,
    slot: 290001000,
    signature: '5w7D9kQ7Y4F8s2P1vL3kZ8jX6mN9bV4cT2rE1wQ8uI7oP6aS4dF2gH5jK9lZ3x',
    isSuccess: true,
  };

  const sampleLog = {
    protocol: 'PUMP_FUN',
    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    logIndex: 5,
    tokenMint: 'DualPathToken11111111111111111111111111111',
    userPubkey: 'TraderAccount11111111111111111111111111111',
    logDiscriminator: 'Program log: Trade',
    rawAmountIn: 1_500_000_000n,
    rawAmountOut: 75_000_000_000n,
    logMessage: 'Program log: Trade: 1.5 SOL -> 75 Tokens',
    slot: 290001000,
    signature: '5w7D9kQ7Y4F8s2P1vL3kZ8jX6mN9bV4cT2rE1wQ8uI7oP6aS4dF2gH5jK9lZ3x',
    isSuccess: true,
  };

  it('Pass 66 Test 1: DualPathReconciliationEngine reconciles congruent instruction & log into UNIFIED_MATCH (Sol Parser SDK merger.rs)', () => {
    const engine = new DualPathReconciliationEngine();
    const report = engine.reconcile(sampleIx, sampleLog);
    assert.equal(report.status, 'UNIFIED_MATCH');
    assert.equal(report.isConflicted, false);
    assert.equal(report.conflictReason, null);
    assert.equal(report.tokenMint, sampleIx.tokenMint);
    assert.equal(report.reconciledAmountIn, 1_500_000_000n);
    assert.equal(report.reconciledAmountOut, 75_000_000_000n);
    assert.ok(report.reconciliationHash);

    const cert = engine.certify(report);
    assert.equal(cert.isApproved, true);
    assert.equal(cert.isConflicted, false);
    assert.match(cert.certificateId, /^dpr_[a-f0-9]{16}$/);
    assert.equal(cert.authority, 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY');
  });

  it('Pass 66 Test 2: DualPathReconciliationEngine preserves raw observations and flags DISCREPANCY_CONFLICT on divergence', () => {
    const engine = new DualPathReconciliationEngine();
    const conflictingLog = {
      ...sampleLog,
      rawAmountIn: 2_500_000_000n, // Disagrees with instruction's 1_500_000_000n
    };

    const report = engine.reconcile(sampleIx, conflictingLog);
    assert.equal(report.status, 'DISCREPANCY_CONFLICT');
    assert.equal(report.isConflicted, true);
    assert.match(report.conflictReason || '', /AMOUNT_IN_MISMATCH/);
    assert.equal(report.reconciledAmountIn, null);
    assert.equal(report.reconciledAmountOut, null);
    assert.equal(report.instructionEvidence?.rawAmountIn, sampleIx.rawAmountIn);
    assert.equal(report.logEvidence?.rawAmountIn, conflictingLog.rawAmountIn);

    const cert = engine.certify(report);
    assert.equal(cert.isApproved, false);
    assert.equal(cert.isConflicted, true);
    assert.match(cert.rejectionReason || '', /AMOUNT_IN_MISMATCH/);
  });

  it('Pass 66 Test 3: BoundedReplayCoordinator enforces strict buffer bounds and discards unfinalized or footer-missing banks (Yellowstone dedup.rs)', () => {
    const engine = new DualPathReconciliationEngine({ maxReplayQueueSize: 2, requireFinalizedBanks: true });

    // Incomplete bank lacking footer
    assert.equal(engine.stageReplayBatch({
      slot: 290001000,
      blockhash: '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM',
      isFinalized: true,
      hasBankFooter: false,
    }, [{ id: 1 }]), false);

    // Incomplete bank unfinalized
    assert.equal(engine.stageReplayBatch({
      slot: 290001000,
      blockhash: '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM',
      isFinalized: false,
      hasBankFooter: true,
    }, [{ id: 1 }]), false);

    // Valid bank 1
    const bank1 = {
      slot: 290001001,
      blockhash: '5uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM',
      isFinalized: true,
      hasBankFooter: true,
    };
    assert.equal(engine.stageReplayBatch(bank1, [{ tx: 1 }]), true);

    // Valid bank 2
    const bank2 = {
      slot: 290001002,
      blockhash: '6uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM',
      isFinalized: true,
      hasBankFooter: true,
    };
    assert.equal(engine.stageReplayBatch(bank2, [{ tx: 2 }]), true);

    // Overflow bank 3 (capacity = 2)
    const bank3 = {
      slot: 290001003,
      blockhash: '7uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM',
      isFinalized: true,
      hasBankFooter: true,
    };
    assert.equal(engine.stageReplayBatch(bank3, [{ tx: 3 }]), false);
    assert.equal(engine.getReplayBatchCount(), 2);
  });

  const baseContext = {
    tokenAgeSec: 40,
    marketCapSol: 120,
    liquiditySol: 35,
    targetTradeSizeSol: 0.5,
    txCount: 12,
    rawWallets: [
      { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
      { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
      { address: 'w3', solFundedAmount: 4.5, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.5 },
      { address: 'w4', solFundedAmount: 7.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 6.0 },
    ],
    isMintRenounced: true,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 12,
  };

  it('Pass 66 Test 4: MasterIntelligenceEngine integrates DualPathReconciliation and exposes public helpers', async () => {
    const master = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(master);

    const event = createMockEvent();
    const result = await master.processEvent(event, {
      ...baseContext,
      dualPathInstructionEvidence: sampleIx,
      dualPathLogEvidence: sampleLog,
    });

    assert.ok(result.viewModel);
    assert.ok(result.viewModel.dualPathReconciliation);
    assert.ok(result.viewModel.dualPathCertificate);
    assert.equal(result.viewModel.dualPathReconciliation.status, 'UNIFIED_MATCH');
    assert.equal(result.viewModel.dualPathCertificate.isApproved, true);

    assert.ok(master.getDualPathReconciliationEngine() instanceof DualPathReconciliationEngine);
    const helperResult = master.reconcileDualPathEvidence(sampleIx, sampleLog);
    assert.equal(helperResult.report.status, 'UNIFIED_MATCH');
    assert.equal(helperResult.certificate.isApproved, true);
  });

  it('Pass 66 Test 5: Decision Kernel fail-closed gating denies capital on parser discrepancy conflict (REQ-085)', async () => {
    const master = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(master);

    const conflictingLog = {
      ...sampleLog,
      tokenMint: 'DifferentTokenMint222222222222222222222222222',
    };

    const event = createMockEvent();
    const blockedResult = await master.processEvent(event, {
      ...baseContext,
      enforceDualPathReconciliationGating: true,
      dualPathInstructionEvidence: sampleIx,
      dualPathLogEvidence: conflictingLog,
    });

    assert.equal(blockedResult.decision, 'CHALLENGED_ABSTAIN');
    assert.match(blockedResult.whyExecutionBlocked || '', /PARSER DUAL-PATH DISCREPANCY CONFLICT DETECTED/);
    assert.equal(blockedResult.viewModel.dualPathReconciliation?.isConflicted, true);
    assert.equal(blockedResult.viewModel.dualPathCertificate?.isApproved, false);
  });
});
