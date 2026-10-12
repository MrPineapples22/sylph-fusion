import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DualPathReconciliationEngine } from '../../src/platform/ingestion/dual-path-reconciler.ts';

describe('DualPathReconciliationEngine (Sol Parser SDK, Richat & Yellowstone Invariants)', () => {
  const engine = new DualPathReconciliationEngine({ maxReplayQueueSize: 5, requireFinalizedBanks: true });

  const validIx = {
    protocol: 'PUMP_FUN',
    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    instructionIndex: 2,
    innerInstructionIndex: null,
    tokenMint: 'TokenMintA111111111111111111111111111111111',
    userPubkey: 'UserWallet111111111111111111111111111111111',
    discriminator: '0x33e685a4017f83ad',
    rawAmountIn: 1_000_000_000n,
    rawAmountOut: 50_000_000_000n,
    slot: 285001000,
    signature: '5w7D9kQ7Y4F8s2P1vL3kZ8jX6mN9bV4cT2rE1wQ8uI7oP6aS4dF2gH5jK9lZ3x',
    isSuccess: true,
  };

  const validLog = {
    protocol: 'PUMP_FUN',
    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    logIndex: 4,
    tokenMint: 'TokenMintA111111111111111111111111111111111',
    userPubkey: 'UserWallet111111111111111111111111111111111',
    logDiscriminator: 'Program log: Trade',
    rawAmountIn: 1_000_000_000n,
    rawAmountOut: 50_000_000_000n,
    logMessage: 'Program log: Trade: 1000000000 SOL -> 50000000000 Tokens',
    slot: 285001000,
    signature: '5w7D9kQ7Y4F8s2P1vL3kZ8jX6mN9bV4cT2rE1wQ8uI7oP6aS4dF2gH5jK9lZ3x',
    isSuccess: true,
  };

  it('reconciles matching instruction and log evidence into UNIFIED_MATCH', () => {
    const report = engine.reconcile(validIx, validLog);
    assert.equal(report.status, 'UNIFIED_MATCH');
    assert.equal(report.isConflicted, false);
    assert.equal(report.conflictReason, null);
    assert.equal(report.tokenMint, validIx.tokenMint);
    assert.equal(report.reconciledAmountIn, 1_000_000_000n);
    assert.equal(report.reconciledAmountOut, 50_000_000_000n);
    assert.ok(report.reconciliationHash);

    const cert = engine.certify(report);
    assert.equal(cert.hasDualPathAgreement, true);
    assert.equal(cert.isConflicted, false);
    assert.match(cert.certificateId, /^dpr_[a-f0-9]{16}$/);
    assert.equal(cert.authority, 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY');
  });

  it('handles INSTRUCTION_ONLY and LOG_ONLY single-path observations cleanly', () => {
    const ixReport = engine.reconcile(validIx, null);
    assert.equal(ixReport.status, 'INSTRUCTION_ONLY');
    assert.equal(ixReport.isConflicted, false);
    assert.equal(ixReport.reconciledAmountIn, 1_000_000_000n);
    const ixCert = engine.certify(ixReport);
    assert.equal(ixCert.hasDualPathAgreement, false);

    const logReport = engine.reconcile(null, validLog);
    assert.equal(logReport.status, 'LOG_ONLY');
    assert.equal(logReport.isConflicted, false);
    assert.equal(logReport.reconciledAmountOut, 50_000_000_000n);
    const logCert = engine.certify(logReport);
    assert.equal(logCert.hasDualPathAgreement, false);
  });

  it('detects DISCREPANCY_CONFLICT on token mint mismatch and preserves both raw records', () => {
    const conflictingLog = {
      ...validLog,
      tokenMint: 'TokenMintB222222222222222222222222222222222',
    };
    const report = engine.reconcile(validIx, conflictingLog);
    assert.equal(report.status, 'DISCREPANCY_CONFLICT');
    assert.equal(report.isConflicted, true);
    assert.match(report.conflictReason, /TOKEN_MINT_MISMATCH/);
    assert.equal(report.reconciledAmountIn, null);
    assert.equal(report.reconciledAmountOut, null);
    assert.equal(report.instructionEvidence.tokenMint, validIx.tokenMint);
    assert.equal(report.logEvidence.tokenMint, conflictingLog.tokenMint);

    const cert = engine.certify(report);
    assert.equal(cert.hasDualPathAgreement, false);
    assert.equal(cert.isConflicted, true);
    assert.match(cert.rejectionReason, /TOKEN_MINT_MISMATCH/);
  });

  it('detects DISCREPANCY_CONFLICT on amount mismatch without fabricating compromise amount', () => {
    const conflictingLog = {
      ...validLog,
      rawAmountIn: 2_000_000_000n, // Disagrees with instruction's 1_000_000_000n
    };
    const report = engine.reconcile(validIx, conflictingLog);
    assert.equal(report.status, 'DISCREPANCY_CONFLICT');
    assert.equal(report.isConflicted, true);
    assert.match(report.conflictReason, /AMOUNT_IN_MISMATCH/);
    assert.equal(report.reconciledAmountIn, null);
    assert.equal(report.reconciledAmountOut, null);

    const cert = engine.certify(report);
    assert.equal(cert.hasDualPathAgreement, false);
  });

  it('rejects MALFORMED_EVIDENCE strictly on invalid inputs', () => {
    const malformedIx = { ...validIx, slot: -1 };
    const report = engine.reconcile(malformedIx, null);
    assert.equal(report.status, 'MALFORMED_EVIDENCE');
    assert.equal(report.isConflicted, false);
    const cert = engine.certify(report);
    assert.equal(cert.hasDualPathAgreement, false);
  });

  it('bounded replay coordinator rejects incomplete banks and respects buffer limits', () => {
    // Missing footer
    const incompleteBank = {
      slot: 285001000,
      blockhash: '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM',
      isFinalized: true,
      hasBankFooter: false,
    };
    assert.equal(engine.stageReplayBatch(incompleteBank, [{ id: 1 }]), false);

    // Unfinalized bank
    const unfinalizedBank = {
      slot: 285001000,
      blockhash: '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM',
      isFinalized: false,
      hasBankFooter: true,
    };
    assert.equal(engine.stageReplayBatch(unfinalizedBank, [{ id: 1 }]), false);

    // Valid finalized bank with footer
    const validBank = {
      slot: 285001000,
      blockhash: '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM',
      isFinalized: true,
      hasBankFooter: true,
    };
    assert.equal(engine.stageReplayBatch(validBank, [{ id: 1 }, { id: 2 }]), true);
    assert.equal(engine.getReplayBatchCount(), 1);

    const drained = engine.drainReplayBatch(285001000, validBank.blockhash);
    assert.ok(drained);
    assert.equal(drained.items.length, 2);
    assert.equal(engine.getReplayBatchCount(), 0);

    const stats = engine.getStats();
    assert.ok(stats.totalIncompleteBanksDiscarded >= 2);
  });

  it('rejects protocol and program identity disagreements instead of unifying them', () => {
    const protocolMismatch = engine.reconcile(validIx, { ...validLog, protocol: 'RAYDIUM_AMM_V4' });
    assert.equal(protocolMismatch.status, 'DISCREPANCY_CONFLICT');
    assert.match(protocolMismatch.conflictReason, /PROGRAM_IDENTITY_MISMATCH/);
    const programMismatch = engine.reconcile(validIx, { ...validLog, programId: '11111111111111111111111111111111' });
    assert.equal(programMismatch.status, 'DISCREPANCY_CONFLICT');
    assert.equal(programMismatch.reconciledAmountOut, null);
  });

  it('marks incomplete corroboration as partial and failed transactions as non-match', () => {
    const partial = engine.reconcile(validIx, { ...validLog, rawAmountIn: null, userPubkey: null });
    assert.equal(partial.status, 'PARTIAL_MATCH');
    assert.equal(partial.reconciledAmountIn, null);
    assert.equal(engine.certify(partial).hasDualPathAgreement, false);
    const failed = engine.reconcile({ ...validIx, isSuccess: false }, { ...validLog, isSuccess: false });
    assert.equal(failed.status, 'FAILED_TRANSACTION');
    assert.equal(failed.reconciledAmountOut, null);
    assert.equal(engine.certify(failed).hasDualPathAgreement, false);
    const successConflict = engine.reconcile(validIx, { ...validLog, isSuccess: false });
    assert.equal(successConflict.status, 'DISCREPANCY_CONFLICT');
  });

  it('certificate verification detects edited report fields and binds all observed evidence', () => {
    const report = engine.reconcile(validIx, validLog);
    const cert = engine.certify(report);
    assert.equal(cert.hasDualPathAgreement, true);
    const tampered = engine.certify({ ...report, reconciledAmountOut: 1n });
    assert.equal(tampered.hasDualPathAgreement, false);
    assert.equal(tampered.isConflicted, true);
    assert.equal(tampered.rejectionReason, 'REPORT_INTEGRITY_MISMATCH');
    const changedDiscriminator = engine.reconcile({ ...validIx, discriminator: 'other' }, validLog);
    assert.notEqual(changedDiscriminator.reconciliationHash, report.reconciliationHash);
  });

  it('bounds replay batch count, bytes and item count and retains an immutable content digest', () => {
    const limited = new DualPathReconciliationEngine({
      maxReplayQueueSize: 2,
      maxReplayItemsPerBatch: 2,
      maxReplayBytesPerBatch: 128,
    });
    const bank = { slot: 1, blockhash: '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM', isFinalized: true, hasBankFooter: true };
    const sourceItems = [{ nested: { amount: 12n } }];
    assert.equal(limited.stageReplayBatch(bank, sourceItems), true);
    const repeat = limited.stageReplayBatch(bank, [{ nested: { amount: 12n } }]);
    assert.equal(repeat, true);
    assert.equal(limited.stageReplayBatch(bank, [{ nested: { amount: 13n } }]), false);
    const batch = limited.drainReplayBatch(bank.slot, bank.blockhash);
    assert.equal(batch.items[0].nested.amount, 12n);
    assert.equal(Object.isFrozen(batch.items[0].nested), true);
    sourceItems[0].nested.amount = 99n;
    assert.equal(batch.items[0].nested.amount, 12n);
    assert.equal(limited.stageReplayBatch({ ...bank, slot: 2 }, [1, 2, 3]), false);
    assert.equal(limited.stageReplayBatch({ ...bank, slot: 3 }, ['x'.repeat(200)]), false);
    const cyclic = {}; cyclic.self = cyclic;
    assert.equal(limited.stageReplayBatch({ ...bank, slot: 4 }, [cyclic]), false);
  });
});
