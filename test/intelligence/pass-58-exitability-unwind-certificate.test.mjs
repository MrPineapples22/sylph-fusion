/**
 * SYLPH FUSION — PASS 58 VERIFICATION SUITE
 * Stressed Liquidity Unwind Curve & Exitability Certificate Master Integration
 * Specifications: Master Blueprint Section 28 (Priority Item 8), Section 7 (Token Semantic Root & Priority Item 7).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExitabilityEngine,
} from '../../dist/intelligence/exitability/exitability-certificate.js';
import {
  TokenSemanticEngine,
} from '../../dist/platform/truth/token-semantic-root.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 58 Test 1: ExitabilityEngine Stressed Liquidity Unwind Curve & BigInt AMM Invariants (Section 28 & Priority Item 8)', async () => {
  const mint = 'MintExitabilityTest11111111111111111111111111';

  // 1. Evaluate clean semantics (sell path feasible)
  const tokenSemanticRoot = TokenSemanticEngine.evaluateSemantics({
    mint,
    slot: 120_000,
  });
  assert.equal(tokenSemanticRoot.isSellPathFeasible, true);

  // 2. Evaluate exitability with conservative position (0.5 SOL in 30 SOL pool)
  const poolSolReserve = 30.0;
  const poolTokenReserve = 1_000_000_000;
  const intendedPositionTokensRaw = 10_000_000n; // 1% of pool tokens
  const intendedPositionSolValue = 0.3; // 0.3 SOL

  const certPermitted = ExitabilityEngine.evaluateExitability({
    mint,
    intendedPositionTokensRaw,
    intendedPositionSolValue,
    tokenSemanticRoot,
    poolSolReserve,
    poolTokenReserve,
    slot: 120_000,
  });

  // Stressed 50% capacity = 30 * 0.5 = 15 SOL
  assert.equal(certPermitted.stressed50PctSolCapacity, 15.0);
  // Max safe size = 15 SOL * 0.08 = 1.200 SOL
  assert.equal(certPermitted.maxSafePositionSol, 1.2);
  assert.equal(certPermitted.verdict, 'PERMITTED');
  assert.equal(certPermitted.isApprovedForExecution, true);
  assert.equal(certPermitted.unwindSchedule.length, 5);

  // Verify 5-step schedule (10%, 25%, 50%, 75%, 100%)
  const fractions = [0.10, 0.25, 0.50, 0.75, 1.00];
  certPermitted.unwindSchedule.forEach((step, idx) => {
    assert.equal(step.exitFraction, fractions[idx]);
    assert.ok(step.baseExitProceedsSol > 0);
    assert.ok(step.stressed25PctDropProceedsSol > 0);
    assert.ok(step.stressed50PctDropProceedsSol > 0);
    assert.ok(step.baseExitProceedsSol >= step.stressed25PctDropProceedsSol);
    assert.ok(step.stressed25PctDropProceedsSol >= step.stressed50PctDropProceedsSol);
    assert.equal(step.isLiquidatable, true);
  });

  // 3. Sizing Reduced: Intended size (2.0 SOL) exceeds maxSafePositionSol (1.2 SOL)
  const certReduced = ExitabilityEngine.evaluateExitability({
    mint,
    intendedPositionTokensRaw: 70_000_000n,
    intendedPositionSolValue: 2.0,
    tokenSemanticRoot,
    poolSolReserve,
    poolTokenReserve,
    slot: 120_000,
  });
  assert.equal(certReduced.verdict, 'SIZING_REDUCED');
  assert.equal(certReduced.isApprovedForExecution, true);
  assert.ok(certReduced.rationale.includes('reduced to safe ceiling'));
});

test('Pass 58 Test 2: TokenSemanticRoot Invariant: BUY PATH SUCCESS does NOT prove SELL PATH SUCCESS', async () => {
  const mint = 'MintTrapSellBlocked11111111111111111111111111';

  // 1. Token with punitive transfer fee (15% = 1500 bps)
  const tokenWithFee = TokenSemanticEngine.evaluateSemantics({
    mint,
    decodedState: {
      transferFeeBps: 1500n,
    },
    slot: 120_000,
  });
  assert.equal(tokenWithFee.isSellPathFeasible, false);
  assert.ok(tokenWithFee.sellPathRiskFactors.some(f => f.includes('PUNITIVE_TRANSFER_FEE')));

  // Invariant: Exitability must FAIL CLOSED immediately
  const certBlockedFee = ExitabilityEngine.evaluateExitability({
    mint,
    intendedPositionTokensRaw: 10_000_000n,
    intendedPositionSolValue: 0.3,
    tokenSemanticRoot: tokenWithFee,
    poolSolReserve: 30.0,
    poolTokenReserve: 1_000_000_000,
    slot: 120_000,
  });
  assert.equal(certBlockedFee.verdict, 'DENIED_EXIT_COLLAPSE');
  assert.equal(certBlockedFee.isApprovedForExecution, false);
  assert.equal(certBlockedFee.maxSafePositionSol, 0);
  assert.ok(certBlockedFee.rationale.includes('DENIED_SELL_PATH_BLOCKED'));

  // 2. Token with Non-Transferable extension (Extension 9 - Soulbound)
  const tokenNonTransferable = TokenSemanticEngine.evaluateSemantics({
    mint,
    decodedState: {
      parsedExtensions: [9],
    },
    slot: 120_000,
  });
  assert.equal(tokenNonTransferable.isNonTransferable, true);
  assert.equal(tokenNonTransferable.isSellPathFeasible, false);

  const certBlockedNonTransferable = ExitabilityEngine.evaluateExitability({
    mint,
    intendedPositionTokensRaw: 10_000_000n,
    intendedPositionSolValue: 0.3,
    tokenSemanticRoot: tokenNonTransferable,
    poolSolReserve: 30.0,
    poolTokenReserve: 1_000_000_000,
    slot: 120_000,
  });
  assert.equal(certBlockedNonTransferable.verdict, 'DENIED_EXIT_COLLAPSE');
  assert.equal(certBlockedNonTransferable.isApprovedForExecution, false);
});

test('Pass 58 Test 3: MasterIntelligenceEngine Public Helper Method evaluateExitability', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const mint = 'MintPublicHelperExit1111111111111111111111111';
  const tokenSemanticRoot = TokenSemanticEngine.evaluateSemantics({
    mint,
    slot: 125_000,
  });

  const cert = engine.evaluateExitability({
    mint,
    intendedPositionTokensRaw: 5_000_000n,
    intendedPositionSolValue: 0.25,
    tokenSemanticRoot,
    poolSolReserve: 25.0,
    poolTokenReserve: 1_000_000_000,
    slot: 125_000,
  });

  assert.ok(cert.certificateId.startsWith('exit_'));
  assert.ok(cert.certificateHash.length === 64);
  assert.equal(cert.mint, mint);
  assert.equal(cert.verdict, 'PERMITTED');
  assert.equal(cert.isApprovedForExecution, true);
  assert.equal(cert.unwindSchedule.length, 5);
});

test('Pass 58 Test 4: Decision Kernel Fail-Closed Gating Under DENIED_EXIT_COLLAPSE & Unexecutable Liquidation', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const mint = 'MintGatingExitability111111111111111111111111';

  // 1. Create a blocked token semantic root
  const blockedSemantic = TokenSemanticEngine.evaluateSemantics({
    mint,
    decodedState: {
      transferFeeBps: 2000n, // 20% punitive fee
    },
    slot: 130_000,
  });

  const blockedCert = ExitabilityEngine.evaluateExitability({
    mint,
    intendedPositionTokensRaw: 10_000_000n,
    intendedPositionSolValue: 0.5,
    tokenSemanticRoot: blockedSemantic,
    poolSolReserve: 30.0,
    poolTokenReserve: 1_000_000_000,
    slot: 130_000,
  });
  assert.equal(blockedCert.verdict, 'DENIED_EXIT_COLLAPSE');

  const eventTime = Date.now() - 500;
  const baseEvent = {
    eventId: 'evt_pass58_gating_exit_01',
    eventType: 'TRADE',
    mint,
    signature: '5sig_pass58_gating',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 51320,
    slot: 593_500,
    parentSlot: 593_499,
    blockhash: 'BhashPass58Gating',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'EXIT58',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const baseWallets = [
    { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
    { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
    { address: 'w3', solFundedAmount: 4.5, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.5 },
    { address: 'w4', solFundedAmount: 7.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 6.0 },
  ];

  const normalContext = {
    tokenAgeSec: 45,
    marketCapSol: 100,
    liquiditySol: 30,
    txCount: 8,
    rawWallets: baseWallets,
    isMintRenounced: true,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
  };

  const contextBlocked = {
    ...normalContext,
    enforceExitabilityGating: true,
    exitabilityCertificate: blockedCert,
  };

  const resultBlocked = await engine.processEvent(baseEvent, contextBlocked);
  assert.equal(resultBlocked.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(resultBlocked.whyExecutionBlocked?.includes('BLOCKED — UNWIND EXITABILITY DENIED'));
  assert.ok(resultBlocked.whyExecutionBlocked?.includes('DENIED_SELL_PATH_BLOCKED'));

  // 2. Permitted exitability does NOT block execution
  const permittedSemantic = TokenSemanticEngine.evaluateSemantics({
    mint,
    slot: 130_000,
  });
  const permittedCert = ExitabilityEngine.evaluateExitability({
    mint,
    intendedPositionTokensRaw: 5_000_000n,
    intendedPositionSolValue: 0.25,
    tokenSemanticRoot: permittedSemantic,
    poolSolReserve: 30.0,
    poolTokenReserve: 1_000_000_000,
    slot: 130_000,
  });
  assert.equal(permittedCert.verdict, 'PERMITTED');

  const contextPermitted = {
    ...normalContext,
    enforceExitabilityGating: true,
    exitabilityCertificate: permittedCert,
  };

  const resultPermitted = await engine.processEvent(baseEvent, contextPermitted);
  // Should not be blocked by exitability gating
  assert.notEqual(resultPermitted.whyExecutionBlocked?.includes('UNWIND EXITABILITY DENIED'), true);
});

test('Pass 58 Test 5: ViewModel Projection and Telemetry Strip Invariants (Blueprint Section 28 & Priority Item 8)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const mint = 'MintViewModelExitability1111111111111111111111';
  const now = Date.now();
  const event = {
    eventId: 'evt_pass58_vm_01',
    eventType: 'TRADE',
    mint,
    slot: 135_000,
    sourceTimestampMs: now - 500,
    receivedTimestampMs: now - 490,
    payload: {
      amountSol: 1.0,
      isBuy: true,
    },
  };

  const context = {
    tokenAgeSec: 60,
    liquiditySol: 40.0,
    marketCapSol: 150.0,
    txCount: 80,
    programOwner: 'owner_vm_exit',
    rawWallets: [],
  };

  const result = await engine.processEvent(event, context);
  const vm = result.viewModel;

  // Assert presence and consistency of Exitability telemetry fields
  assert.ok(vm.exitabilityCertificate);
  assert.ok(vm.exitabilityVerdict);
  assert.equal(vm.exitabilityVerdict, vm.exitabilityCertificate.verdict);
  assert.equal(vm.stressed50PctSolCapacity, 20.0); // 40.0 * 0.5
  assert.equal(vm.maxSafePositionSol, 1.6); // 20.0 * 0.08
  assert.ok(vm.minimumRecoverableValueSol !== undefined);
  assert.ok(vm.exitabilityCertificate.certificateId.startsWith('exit_'));
  assert.ok(vm.exitabilityCertificate.certificateHash.length === 64);
  assert.equal(vm.exitabilityCertificate.unwindSchedule.length, 5);
});
