import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TransactionCompatibilityAuthority,
} from '../../dist/platform/execution/transaction-compatibility.js';
import {
  ExecutionAssertionLayer,
} from '../../dist/platform/execution/assertion-layer.js';
import {
  TokenSemanticsAuthority,
} from '../../dist/platform/security/token-semantics.js';
import {
  StreamIntegrityAuthority,
} from '../../dist/platform/ingestion/stream-integrity.js';
import {
  ProgramPolicyRegistry,
} from '../../dist/platform/security/program-policy-registry.js';

test('TransactionCompatibilityAuthority: identifies supported versions and rejects unsupported versions', () => {
  assert.equal(TransactionCompatibilityAuthority.isSupportedVersion('legacy'), true);
  assert.equal(TransactionCompatibilityAuthority.isSupportedVersion(0), true);
  assert.equal(TransactionCompatibilityAuthority.isSupportedVersion(1), true);
  assert.equal(TransactionCompatibilityAuthority.isSupportedVersion(2), false);

  assert.equal(TransactionCompatibilityAuthority.normalizeVersion(undefined), 'LEGACY');
  assert.equal(TransactionCompatibilityAuthority.normalizeVersion(0), 'V0');
  assert.equal(TransactionCompatibilityAuthority.normalizeVersion(1), 'V1');
  assert.throws(() => TransactionCompatibilityAuthority.normalizeVersion(2), /UNSUPPORTED_CHAIN_TRANSACTION_VERSION/);
});

test('TransactionCompatibilityAuthority: enforces version-aware resource limits and generates fingerprint', () => {
  const legacyLimits = TransactionCompatibilityAuthority.validateResourcePolicy('LEGACY', {
    computeLimit: 200_000,
    priorityFeeMicroLamports: 10_000n,
  });
  assert.equal(legacyLimits.version, 'LEGACY');
  assert.equal(legacyLimits.computeLimit, 200_000);

  // V1 requires explicit loadedAccountsLimit
  assert.throws(() => TransactionCompatibilityAuthority.validateResourcePolicy('V1', {
    computeLimit: 300_000,
    priorityFeeMicroLamports: 5_000n,
  }), /loadedAccountsDataSizeLimit/);

  const v1Limits = TransactionCompatibilityAuthority.validateResourcePolicy('V1', {
    computeLimit: 300_000,
    loadedAccountsDataSizeLimit: 64 * 1024,
    heapLimitBytes: 64 * 1024,
    priorityFeeMicroLamports: 5_000n,
  });
  assert.equal(v1Limits.version, 'V1');
  assert.equal(v1Limits.loadedAccountsLimit, 65536);

  // Review certificate
  const cert = TransactionCompatibilityAuthority.createReviewCertificate({
    reviewId: 'rev-001',
    intentId: 'intent-001',
    version: 'V1',
    limits: v1Limits,
    estimatedCompute: 250_000,
    simulationSlot: 280_000_100,
    simulationResult: 'SUCCESS',
  });
  assert.equal(cert.transactionVersion, 'V1');
  assert.equal(cert.simulationResult, 'SUCCESS');

  // Transaction Fingerprint
  const txBytes = new Uint8Array([1, 2, 3, 4, 5]);
  const fp1 = TransactionCompatibilityAuthority.computeFingerprint(txBytes, 'intent-001', 'rev-001', 'v1');
  const fp2 = TransactionCompatibilityAuthority.computeFingerprint(txBytes, 'intent-001', 'rev-001', 'v1');
  assert.equal(fp1.fingerprint, fp2.fingerprint);

  const mutatedBytes = new Uint8Array([1, 2, 3, 4, 6]);
  const fpMutated = TransactionCompatibilityAuthority.computeFingerprint(mutatedBytes, 'intent-001', 'rev-001', 'v1');
  assert.notEqual(fp1.fingerprint, fpMutated.fingerprint);
});

test('ExecutionAssertionLayer: verifies preconditions and postconditions for Jito uncle safety', () => {
  const pre = {
    expectedWallet: 'Wallet111111111111111111111111111111111111',
    expectedMint: 'Mint1111111111111111111111111111111111111111',
    maxAuthorizedInputLamports: 1_000_000_000n,
    maxQuoteAgeMs: 5000,
    quoteObservedAtMs: 1_000_000,
    minAcceptableSlot: 100,
    expectedPositionVersion: 2,
  };

  const validPre = ExecutionAssertionLayer.verifyPreconditions(pre, {
    wallet: 'Wallet111111111111111111111111111111111111',
    mint: 'Mint1111111111111111111111111111111111111111',
    inputLamports: 500_000_000n,
    currentSlot: 105,
    positionVersion: 2,
    nowMs: 1_002_000,
  });
  assert.equal(validPre.valid, true);

  const staleSlotPre = ExecutionAssertionLayer.verifyPreconditions(pre, {
    wallet: 'Wallet111111111111111111111111111111111111',
    mint: 'Mint1111111111111111111111111111111111111111',
    inputLamports: 500_000_000n,
    currentSlot: 99, // < 100
    positionVersion: 2,
    nowMs: 1_002_000,
  });
  assert.equal(staleSlotPre.valid, false);
  assert.match(staleSlotPre.violations[0], /Stale context slot/);

  // Postconditions
  const post = {
    minExpectedTokenDelta: 10_000n,
    maxExpectedSolOutflowLamports: 1_000_000_000n,
    maxApprovedFeeLamports: 50_000n,
    maxAllowedPositionExposureLamports: 5_000_000_000n,
  };

  const validPost = ExecutionAssertionLayer.verifyPostconditions(post, {
    tokenDelta: 12_000n,
    solDelta: -900_000_000n,
    feeLamports: 30_000n,
    resultingExposureLamports: 2_000_000_000n,
  });
  assert.equal(validPost.valid, true);

  const slippagePost = ExecutionAssertionLayer.verifyPostconditions(post, {
    tokenDelta: 9_000n, // < 10_000
    solDelta: -900_000_000n,
    feeLamports: 30_000n,
    resultingExposureLamports: 2_000_000_000n,
  });
  assert.equal(slippagePost.valid, false);
  assert.match(slippagePost.violations[0], /POSTCONDITION_FAILED/);
});

test('TokenSemanticsAuthority: evaluates Token-2022 transfer fees and transfer hooks', () => {
  const token2022ProgramId = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

  // Standard safe Token-2022
  const safe = TokenSemanticsAuthority.evaluateSemantics({
    mint: 'SafeToken2022',
    programId: token2022ProgramId,
    isMintAuthorityRevoked: true,
    isFreezeAuthorityRevoked: true,
    verifiedAtSlot: 100,
  });
  assert.equal(safe.classification, 'BENIGN_METADATA_EXTENSIONS');
  assert.equal(safe.executionPolicy, 'ELIGIBLE');

  // Token-2022 with permanent delegate -> immediate BLOCK
  const backdoor = TokenSemanticsAuthority.evaluateSemantics({
    mint: 'BackdoorToken2022',
    programId: token2022ProgramId,
    isMintAuthorityRevoked: true,
    isFreezeAuthorityRevoked: true,
    hasPermanentDelegate: true,
    verifiedAtSlot: 100,
  });
  assert.equal(backdoor.classification, 'MALICIOUS_BACKDOOR');
  assert.equal(backdoor.executionPolicy, 'BLOCKED');

  // Token-2022 with transfer hook without verified program -> UNVERIFIED
  const unverifiedHook = TokenSemanticsAuthority.evaluateSemantics({
    mint: 'HookToken2022',
    programId: token2022ProgramId,
    isMintAuthorityRevoked: true,
    isFreezeAuthorityRevoked: true,
    hasTransferHook: true,
    verifiedAtSlot: 100,
  });
  assert.equal(unverifiedHook.classification, 'TRANSFER_HOOK_ACTIVE');
  assert.equal(unverifiedHook.executionPolicy, 'TRANSFER_SEMANTICS_UNVERIFIED');

  // Transfer fee calculation: gross vs net
  const split = TokenSemanticsAuthority.calculateGrossNetTransfer(100_000n, 300); // 3% fee
  assert.equal(split.grossTokens, 100_000n);
  assert.equal(split.feeWithheldTokens, 3_000n);
  assert.equal(split.netReceivedTokens, 97_000n);
});

test('StreamIntegrityAuthority: tracks slot continuity and gap detection for 3D watermark', () => {
  const stream = new StreamIntegrityAuthority();
  stream.onStreamConnected();

  // Continuous slots
  assert.equal(stream.registerSlotNotification({ slot: 100, timestamp: Date.now() }).hasGap, false);
  assert.equal(stream.registerSlotNotification({ slot: 101, timestamp: Date.now() }).hasGap, false);

  const watermark1 = stream.getWatermark();
  assert.equal(watermark1.streamIntegrity, 'CONTINUOUS');
  assert.equal(watermark1.observedHeadSlot, 101);
  assert.equal(stream.isDataCurrent(), true);

  // Jump from 101 to 110 -> Gap detected
  const gapNotif = stream.registerSlotNotification({ slot: 110, timestamp: Date.now() });
  assert.equal(gapNotif.hasGap, true);
  assert.equal(gapNotif.gapStart, 102);
  assert.equal(gapNotif.gapEnd, 109);

  const watermark2 = stream.getWatermark();
  assert.equal(watermark2.streamIntegrity, 'GAP_DETECTED');
  assert.equal(stream.isDataCurrent(), false); // Gap invalidates CURRENT

  // Resolve gap
  stream.markGapResolved(102, 109);
  const watermark3 = stream.getWatermark();
  assert.equal(watermark3.streamIntegrity, 'CONTINUOUS');
  assert.equal(stream.isDataCurrent(), true);
});

test('StreamIntegrityAuthority: delayed slots and unrelated repair claims cannot restore continuity', () => {
  const stream = new StreamIntegrityAuthority();
  stream.onStreamConnected();
  stream.registerSlotNotification({ slot: 100, timestamp: Date.now() });
  stream.registerSlotNotification({ slot: 110, timestamp: Date.now() });

  // A delayed duplicate is not proof that all missing slots were recovered.
  stream.registerSlotNotification({ slot: 105, timestamp: Date.now() });
  stream.markGapResolved(1, 99);
  assert.equal(stream.getWatermark().streamIntegrity, 'GAP_DETECTED');
  assert.equal(stream.isDataCurrent(), false);

  // Partial reconciliation retains the unresolved portion of the gap.
  stream.markGapResolved(101, 105);
  assert.equal(stream.getWatermark().streamIntegrity, 'GAP_DETECTED');
  stream.markGapResolved(106, 109);
  assert.equal(stream.getWatermark().streamIntegrity, 'CONTINUOUS');
});

test('ProgramPolicyRegistry: allows approved programs and blocks unknown or unsafe programs', () => {
  // System Program
  assert.equal(ProgramPolicyRegistry.evaluateProgram('11111111111111111111111111111111').allowed, true);
  // Jupiter v6
  assert.equal(ProgramPolicyRegistry.evaluateProgram('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4').allowed, true);
  // Unknown malicious program
  assert.equal(ProgramPolicyRegistry.evaluateProgram('MaliciousHackerProgram111111111111111111111').allowed, false);
  assert.equal(ProgramPolicyRegistry.evaluateProgram('MaliciousHackerProgram111111111111111111111').rule, 'BLOCK');
});
