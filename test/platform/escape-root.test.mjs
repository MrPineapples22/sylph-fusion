import assert from 'node:assert/strict';
import test from 'node:test';
import { EscapeRootAuthority } from '../../dist/platform/execution/escape-root.js';

test('ESCAPEROOT: maintains multi-bracket (25%, 50%, 75%, 100%) real exit execution certificates', () => {
  const escapeRoot = new EscapeRootAuthority();
  const mint = 'EscapeTestMint11111111111111111111111111111';

  // 1. Initial state: No exit proofs recorded
  const initial = escapeRoot.verifyFullExitability(mint);
  assert.equal(initial.isFullyExitReady, false);
  assert.equal(initial.verifiedBracketsCount, 0);

  // 2. Record 25%, 50%, 75%
  escapeRoot.recordExitProof({
    mint,
    bracketPct: 25,
    tokenQuantity: 25_000n,
    proofLevel: 'E3_EXACT_SIMULATION',
    expectedOutputLamports: 250_000_000n,
    expectedPriceImpactBps: 150,
    estimatedTotalFeeLamports: 215_000n,
    venue: 'PUMP_CURVE',
    simulatedAtSlot: 310000000,
  });

  escapeRoot.recordExitProof({
    mint,
    bracketPct: 50,
    tokenQuantity: 50_000n,
    proofLevel: 'E3_EXACT_SIMULATION',
    expectedOutputLamports: 490_000_000n,
    expectedPriceImpactBps: 320,
    estimatedTotalFeeLamports: 215_000n,
    venue: 'PUMP_CURVE',
    simulatedAtSlot: 310000000,
  });

  escapeRoot.recordExitProof({
    mint,
    bracketPct: 75,
    tokenQuantity: 75_000n,
    proofLevel: 'E3_EXACT_SIMULATION',
    expectedOutputLamports: 720_000_000n,
    expectedPriceImpactBps: 510,
    estimatedTotalFeeLamports: 215_000n,
    venue: 'PUMP_CURVE',
    simulatedAtSlot: 310000000,
  });

  // Still not fully ready (100% bracket missing)
  assert.equal(escapeRoot.verifyFullExitability(mint).isFullyExitReady, false);
  assert.equal(escapeRoot.verifyFullExitability(mint).verifiedBracketsCount, 3);

  // 3. Record 100% full exit
  escapeRoot.recordExitProof({
    mint,
    bracketPct: 100,
    tokenQuantity: 100_000n,
    proofLevel: 'E3_EXACT_SIMULATION',
    expectedOutputLamports: 940_000_000n,
    expectedPriceImpactBps: 750,
    estimatedTotalFeeLamports: 215_000n,
    venue: 'PUMP_CURVE',
    simulatedAtSlot: 310000000,
  });

  const full = escapeRoot.verifyFullExitability(mint);
  assert.equal(full.isFullyExitReady, true);
  assert.equal(full.verifiedBracketsCount, 4);
});

test('ESCAPEROOT: registers and retrieves prewarmed ExitTemplates', () => {
  const escapeRoot = new EscapeRootAuthority();
  const mint = 'PrewarmedMint111111111111111111111111111111';

  escapeRoot.registerPrewarmedTemplate({
    templateId: 'tmpl-1',
    mint,
    venue: 'PUMPSWAP_AMM',
    routeType: 'PUMPSWAP_AMM',
    addressLookupTables: ['Alt111111111111111111111111111111111111111'],
    writableAccounts: ['PoolVault', 'FeeVault'],
    builtAtSlot: 310000050,
    builtAtMs: Date.now(),
  });

  const tmpl = escapeRoot.getPrewarmedTemplate(mint);
  assert.ok(tmpl);
  assert.equal(tmpl.venue, 'PUMPSWAP_AMM');
  assert.equal(tmpl.addressLookupTables.length, 1);
});

test('SurvivalTreasury: enforces Invariant 10 and blocks entries that deplete emergency SOL reserve', () => {
  const escapeRoot = new EscapeRootAuthority();

  // Wallet has 10.0 SOL (10,000,000,000 lamports)
  const currentLiquidSol = 10_000_000_000n;

  // Scenario 1: Reasonable entry (0.5 SOL commitment with 1 existing position)
  const check1 = escapeRoot.verifySurvivalTreasuryInvariant({
    currentLiquidSolLamports: currentLiquidSol,
    proposedEntryCommitmentLamports: 500_000_000n,
    currentOpenPositionsCount: 1,
  });
  assert.equal(check1.isPermitted, true);
  assert.ok(check1.remainingLiquidSolLamports > check1.requiredSurvivalReserveLamports);

  // Scenario 2: Over-aggressive entry (9.998 SOL commitment, leaving almost 0 SOL for emergency exits)
  const check2 = escapeRoot.verifySurvivalTreasuryInvariant({
    currentLiquidSolLamports: currentLiquidSol,
    proposedEntryCommitmentLamports: 9_998_000_000n,
    currentOpenPositionsCount: 3,
  });
  assert.equal(check2.isPermitted, false);
  assert.match(check2.reason, /SURVIVAL_TREASURY_INSUFFICIENT/);
});
