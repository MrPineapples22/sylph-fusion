/**
 * SYLPH FUSION — LIVE PRODUCTION READINESS & EXACT BYTES AUTHORITY TEST SUITE
 * Specifications: Sections 36-51, 61-64
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  ExactBytesAuthority,
} from '../../dist/platform/execution/exact-bytes-authority.js';
import {
  IsolatedSignerGateway,
} from '../../dist/platform/execution/isolated-signer.js';
import {
  ProtocolCompatibilityManager,
  CANONICAL_PROGRAM_IDENTITIES,
} from '../../dist/platform/execution/protocol-compatibility-lease.js';
import {
  LiveCanaryController,
} from '../../dist/platform/execution/live-canary-controller.js';
import {
  LiveReadinessEvaluator,
} from '../../dist/platform/execution/live-readiness.js';

test('1. Exact Bytes Authority: 5-stage identity verification and tamper detection', () => {
  const dummyTxBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const permit = ExactBytesAuthority.issueOneShotPermit({
    mint: 'Mint111111111111111111111111111111111111111',
    side: 'BUY',
    maxInputLamportsOrTokens: 50_000_000n,
    minOutputLamportsOrTokens: 100_000n,
    maxSlippageBps: 200,
    route: 'PUMP_BONDING_CURVE',
    allowedProgramIds: [CANONICAL_PROGRAM_IDENTITIES.PUMP_FUN],
    writableAccounts: ['Account1111111111111111111111111111111111111'],
    blockhash: '5EYkt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    currentSlot: 300_000_000n,
    slotValidityWindow: 150n,
    policyRoot: '0x_policy_root',
    stateRoot: '0x_state_root',
    releaseRoot: '0x_release_root',
    capitalReservationId: 'res_12345',
  });

  // Stage 1-5 with exact identical bytes -> PASS
  const result = ExactBytesAuthority.verifyExactBytesPipeline({
    permitId: permit.permitId,
    builtBytes: dummyTxBytes,
    simulatedBytes: dummyTxBytes,
    authorizedBytes: dummyTxBytes,
    signedMessageBytes: dummyTxBytes,
    submittedMessageBytes: dummyTxBytes,
  });
  assert.equal(result.allStagesIdentical, true);
  assert.equal(result.exactWireBytesLength, dummyTxBytes.byteLength);

  // Adversarial: 1-byte mutation in simulation stage -> FAIL
  const mutatedBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 9]); // Changed last byte
  assert.throws(
    () => {
      ExactBytesAuthority.verifyExactBytesPipeline({
        permitId: permit.permitId,
        builtBytes: dummyTxBytes,
        simulatedBytes: mutatedBytes,
        authorizedBytes: dummyTxBytes,
        signedMessageBytes: dummyTxBytes,
        submittedMessageBytes: dummyTxBytes,
      });
    },
    /EXACT_BYTES_MUTATION_DETECTED/,
    'Must throw EXACT_BYTES_MUTATION_DETECTED if simulation bytes diverge'
  );
});

test('2. One-Shot Execution Permit: Single use and strict anti-replay protection', () => {
  const permit = ExactBytesAuthority.issueOneShotPermit({
    mint: 'Mint111111111111111111111111111111111111111',
    side: 'BUY',
    maxInputLamportsOrTokens: 50_000_000n,
    minOutputLamportsOrTokens: 100_000n,
    maxSlippageBps: 200,
    route: 'PUMP_BONDING_CURVE',
    allowedProgramIds: [CANONICAL_PROGRAM_IDENTITIES.PUMP_FUN],
    writableAccounts: [],
    blockhash: '5EYkt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    currentSlot: 300_000_000n,
    slotValidityWindow: 150n,
    policyRoot: '0x_policy',
    stateRoot: '0x_state',
    releaseRoot: '0x_release',
    capitalReservationId: 'res_abc',
  });

  // First consumption succeeds
  assert.doesNotThrow(() => {
    ExactBytesAuthority.consumePermit(permit, 300_000_050n);
  });

  // Second consumption attempt on same permit must FAIL (anti-replay)
  assert.throws(
    () => {
      ExactBytesAuthority.consumePermit(permit, 300_000_055n);
    },
    /PERMIT_REUSE_DETECTED/,
    'Permit cannot be consumed twice'
  );

  // Expired slot range must FAIL
  const expiredPermit = ExactBytesAuthority.issueOneShotPermit({
    mint: 'Mint111111111111111111111111111111111111111',
    side: 'BUY',
    maxInputLamportsOrTokens: 50_000_000n,
    minOutputLamportsOrTokens: 100_000n,
    maxSlippageBps: 200,
    route: 'PUMP_BONDING_CURVE',
    allowedProgramIds: [],
    writableAccounts: [],
    blockhash: '5EYkt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    currentSlot: 100n,
    slotValidityWindow: 50n,
    policyRoot: '0x_policy',
    stateRoot: '0x_state',
    releaseRoot: '0x_release',
    capitalReservationId: 'res_def',
  });

  assert.throws(
    () => {
      ExactBytesAuthority.consumePermit(expiredPermit, 200n); // Slot 200 > validUntilSlot 150
    },
    /PERMIT_SLOT_OUT_OF_RANGE/
  );
});

test('3. Isolated Signer Gateway: Isolated signing, zero secret exposure, and binding enforcement', async () => {
  const dummyPublicKey = new PublicKey('11111111111111111111111111111111');
  const mockKeyStore = {
    publicKey: dummyPublicKey,
    async signBytes(bytes) {
      // Mock isolated Ed25519 signature (64 bytes)
      return new Uint8Array(64).fill(7);
    },
  };

  const expectedReleaseRoot = '0x_release_root_certified_hash_1234567890';
  const signerGateway = new IsolatedSignerGateway(mockKeyStore, () => expectedReleaseRoot);

  const txBytes = new Uint8Array([10, 20, 30, 40]);
  const txHash = createHash('sha256').update(txBytes).digest('hex');

  const permit = ExactBytesAuthority.issueOneShotPermit({
    mint: 'Mint111111111111111111111111111111111111111',
    side: 'BUY',
    maxInputLamportsOrTokens: 50_000_000n,
    minOutputLamportsOrTokens: 100_000n,
    maxSlippageBps: 200,
    route: 'PUMP',
    allowedProgramIds: [],
    writableAccounts: [],
    blockhash: '5EYkt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    currentSlot: 1000n,
    slotValidityWindow: 100n,
    policyRoot: '0x_policy',
    stateRoot: '0x_state',
    releaseRoot: expectedReleaseRoot,
    capitalReservationId: 'res_xyz',
  });

  // Legitimate signing request
  const signResponse = await signerGateway.signExactTransaction({
    exactTransactionBytes: txBytes,
    exactTransactionHash: txHash,
    actionHash: '0x_action_hash',
    permit,
    currentSlot: 1050n,
    configRoot: '0x_config',
  });

  assert.equal(signResponse.signature.length, 64);
  assert.equal(signResponse.signerPublicKey.equals(dummyPublicKey), true);
  assert.ok(signResponse.bindingDigest.length >= 32);

  // Adversarial: Tampered Release Root -> Rejected
  const tamperedPermit = { ...permit, releaseRoot: '0x_tampered_root' };
  await assert.rejects(
    async () => {
      await signerGateway.signExactTransaction({
        exactTransactionBytes: txBytes,
        exactTransactionHash: txHash,
        actionHash: '0x_action_hash',
        permit: tamperedPermit,
        currentSlot: 1050n,
        configRoot: '0x_config',
      });
    },
    /SIGNING_AUTHORITY_REJECTED.*Release root mismatch/
  );
});

test('4. Protocol Compatibility Lease: Enforces valid Solana program identities & expiry', () => {
  const manager = new ProtocolCompatibilityManager();
  const currentSlot = 300_000_000n;
  const lease = manager.issueLease(currentSlot, 3600_000, 7200n);

  assert.equal(lease.isExpired, false);
  assert.equal(lease.protocols.length, 5);

  // Valid program: Pump.fun
  const pumpProgram = new PublicKey(CANONICAL_PROGRAM_IDENTITIES.PUMP_FUN);
  assert.doesNotThrow(() => {
    manager.assertProgramCompatible(pumpProgram, currentSlot + 100n);
  });

  // Invalid / Untrusted program ID
  const untrustedProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DB'); // Malformed / Fake program
  assert.throws(
    () => {
      manager.assertProgramCompatible(untrustedProgram, currentSlot + 100n);
    },
    /PROTOCOL_COMPATIBILITY_ERROR.*not covered/
  );

  // Slot boundary exceeded
  assert.throws(
    () => {
      manager.assertProgramCompatible(pumpProgram, currentSlot + 10_000n); // Exceeds 7200n span
    },
    /PROTOCOL_COMPATIBILITY_ERROR.*Current slot.*exceeds lease slot boundary/
  );
});

test('5. Live Canary Controller: Strict A3 capital constraints, circuit breakers, and emergency exit', () => {
  const canary = new LiveCanaryController({
    maxPerPositionExposureLamports: 50_000_000n, // 0.05 SOL
    maxConcurrentPositions: 1,
    maxDailyLossLamports: 100_000_000n, // 0.10 SOL
    maxDailyTransactions: 5,
    maxConsecutiveFailures: 2,
  });

  // Initial mode is A1_PAPER
  assert.equal(canary.getMode(), 'A1_PAPER');

  // Jump from A1_PAPER directly to A5_CERTIFIED_LIVE is ILLEGAL
  assert.throws(() => {
    canary.promoteMode('A5_CERTIFIED_LIVE', '0x_evidence_hash_12345678901234567890');
  }, /ILLEGAL_CAPITAL_PROMOTION/);

  // Proper linear step: A1_PAPER -> A2_SHADOW_LIVE_DATA -> A3_LIVE_CANARY
  canary.promoteMode('A2_SHADOW_LIVE_DATA', '0x_evidence_hash_12345678901234567890');
  canary.promoteMode('A3_LIVE_CANARY', '0x_evidence_hash_12345678901234567890');
  assert.equal(canary.getMode(), 'A3_LIVE_CANARY');

  // Legitimate entry: 0.04 SOL (< 0.05 SOL limit)
  canary.registerEntry('MintA', 40_000_000n);

  // Adversarial: Exceeding concurrent position count (already have 1 open)
  assert.throws(() => {
    canary.registerEntry('MintB', 30_000_000n);
  }, /CANARY_ENTRY_BLOCKED.*Max concurrent positions reached/);

  // Adversarial: Averaging down / duplicate position forbidden
  assert.throws(() => {
    canary.registerEntry('MintA', 10_000_000n);
  }, /CANARY_ENTRY_BLOCKED.*duplicate position/);

  // Consecutive failures trip circuit breaker
  canary.registerExecutionFailure('RPC timeout 1');
  canary.registerExecutionFailure('RPC timeout 2');
  const riskState = canary.getRiskState();
  assert.equal(riskState.circuitBreakerTripped, true);
  assert.equal(riskState.entriesHalted, true);
  // Emergency exit MUST ALWAYS be permitted
  assert.equal(riskState.emergencyExitPermitted, true);
});

test('6. Live Readiness Evaluator: distinguishes failed, unknown, and passing observations', () => {
  // Synthetic inputs exercise aggregation logic only; caller assertions are not runtime proof.
  const offlineReport = LiveReadinessEvaluator.evaluate({
    hasIsolatedSigner: false,
    signerPublicKeyBase58: undefined,
    hasActiveProtocolLease: true,
    protocolLeaseExpired: false,
    exactBytesAuthorityReady: true,
    terminalityWitnessCount: 2,
    noLandSearchEngineReady: true,
    reservationEngineReady: true,
    reconciliationLedgerClean: true,
    executionHurdleCalibrated: true,
    canaryRiskLimitsEnforced: true,
    releaseRootDigest: undefined,
    releaseCertificateVerified: undefined,
  });

  assert.equal(offlineReport.liveReady, false);
  assert.equal(offlineReport.liveSigningUnavailable, true, 'Must derive liveSigningUnavailable = true');
  assert.equal(offlineReport.productionCapitalAuthorityBlocked, true, 'Must derive productionCapitalAuthorityBlocked = true');
  assert.equal(offlineReport.passedGatesCount, 8);
  assert.equal(offlineReport.failedGatesCount, 1);
  assert.equal(offlineReport.unknownGatesCount, 1);
  assert.equal(offlineReport.gates.signingAuthority.status, 'FAIL');
  assert.equal(offlineReport.gates.releaseCertification.status, 'UNKNOWN');
  assert.equal(offlineReport.gates.exactBytesAuthority.status, 'PASS');
  assert.equal(offlineReport.gates.protocolCompatibility.status, 'PASS');

  // Case B: complete synthetic inputs exercise the aggregator, not runtime authority.
  const certifiedReport = LiveReadinessEvaluator.evaluate({
    hasIsolatedSigner: true,
    signerPublicKeyBase58: '11111111111111111111111111111111',
    hasActiveProtocolLease: true,
    protocolLeaseExpired: false,
    exactBytesAuthorityReady: true,
    terminalityWitnessCount: 3,
    noLandSearchEngineReady: true,
    reservationEngineReady: true,
    reconciliationLedgerClean: true,
    executionHurdleCalibrated: true,
    canaryRiskLimitsEnforced: true,
    releaseCertificateVerified: true,
    releaseRootDigest: 'a'.repeat(64),
  });

  assert.equal(certifiedReport.liveReady, true);
  assert.equal(certifiedReport.liveSigningUnavailable, false);
  assert.equal(certifiedReport.productionCapitalAuthorityBlocked, false);
  assert.equal(certifiedReport.passedGatesCount, 10);
  assert.equal(certifiedReport.unknownGatesCount, 0);
});

test('terminal live-readiness route does not turn disconnected research components into PASS', () => {
  const server = readFileSync(new URL('../../terminal/server.mjs', import.meta.url), 'utf8');
  const routeStart = server.indexOf("if (req.method === 'GET' && reqUrl.pathname === '/api/live/readiness')");
  assert.notEqual(routeStart, -1);
  const routeEnd = server.indexOf("if(req.method==='POST'&&reqUrl.pathname==='/live/api/command')", routeStart);
  assert.notEqual(routeEnd, -1);
  const route = server.slice(routeStart, routeEnd);
  for (const field of [
    'hasActiveProtocolLease', 'protocolLeaseExpired', 'exactBytesAuthorityReady',
    'terminalityWitnessCount', 'noLandSearchEngineReady', 'reservationEngineReady',
    'reconciliationLedgerClean', 'executionHurdleCalibrated', 'canaryRiskLimitsEnforced',
  ]) {
    assert.match(route, new RegExp(`${field}: undefined`), `${field} must remain unknown until runtime evidence is wired`);
  }
  assert.match(route, /releaseCertificateVerified: certReport\.isProductionPermitted === true/);
});
