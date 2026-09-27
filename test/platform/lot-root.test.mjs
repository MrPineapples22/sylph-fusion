import assert from 'node:assert/strict';
import test from 'node:test';
import { LotRootAuthority } from '../../dist/platform/ledger/lot-root.js';

test('LOTROOT: supports complete OPEN -> INCREASE -> REDUCE -> INCREASE -> CLOSE sequence', () => {
  const lotRoot = new LotRootAuthority();
  const mint = 'LotTestMint1111111111111111111111111111111';

  // 1. OPEN: Buy 100,000 tokens for 1.0 SOL (1,000,000,000 lamports) + 5,000 lamports fee
  const lot1 = lotRoot.addLot({
    mint,
    tokenQuantity: 100_000n,
    costBasisLamports: 1_000_000_000n,
    executionCostsLamports: 5_000n,
    entryEconomicIntentId: 'intent-open-1',
    executionGeneration: 1,
  });
  assert.equal(lot1.remainingRawQuantity, 100_000n);

  let proj = lotRoot.getPositionProjection(mint);
  assert.ok(proj);
  assert.equal(proj.totalRemainingQuantity, 100_000n);
  assert.equal(proj.activeLotCount, 1);

  // Conservation check: matches 100,000 tokens
  assert.ok(lotRoot.verifyConservation(mint, 100_000n).isConserved);

  // 2. INCREASE: Buy 50,000 more tokens for 0.6 SOL (600,000,000 lamports)
  const lot2 = lotRoot.addLot({
    mint,
    tokenQuantity: 50_000n,
    costBasisLamports: 600_000_000n,
    executionCostsLamports: 5_000n,
    entryEconomicIntentId: 'intent-increase-2',
    executionGeneration: 2,
  });
  assert.equal(lot2.remainingRawQuantity, 50_000n);

  proj = lotRoot.getPositionProjection(mint);
  assert.ok(proj);
  assert.equal(proj.totalRemainingQuantity, 150_000n);
  assert.equal(proj.totalCostBasisLamports, 1_600_000_000n);
  assert.equal(proj.activeLotCount, 2);
  assert.ok(lotRoot.verifyConservation(mint, 150_000n).isConserved);

  // 3. REDUCE: Sell 120,000 tokens using FIFO
  // Should exhaust entire lot 1 (100,000 tokens, 1.0 SOL basis)
  // and 20,000 tokens from lot 2 (proportional basis = 600M * 20k / 50k = 240,000,000 lamports)
  const exit1 = lotRoot.allocateExit(mint, 120_000n, 'FIFO');
  assert.equal(exit1.totalTokensSold, 120_000n);
  assert.equal(exit1.remainingPositionTokens, 30_000n);
  assert.equal(exit1.exhaustedLots.length, 2);

  // Lot 1 fully exhausted
  assert.equal(exit1.exhaustedLots[0].tokensDeducted, 100_000n);
  assert.equal(exit1.exhaustedLots[0].costBasisDeducted, 1_000_000_000n);
  assert.equal(exit1.exhaustedLots[0].remainingInLot, 0n);

  // Lot 2 partially exhausted (20k deducted, 30k remaining)
  assert.equal(exit1.exhaustedLots[1].tokensDeducted, 20_000n);
  assert.equal(exit1.exhaustedLots[1].costBasisDeducted, 240_000_000n);
  assert.equal(exit1.exhaustedLots[1].remainingInLot, 30_000n);

  proj = lotRoot.getPositionProjection(mint);
  assert.ok(proj);
  assert.equal(proj.totalRemainingQuantity, 30_000n);
  assert.equal(proj.totalCostBasisLamports, 360_000_000n);
  assert.equal(proj.activeLotCount, 1);
  assert.ok(lotRoot.verifyConservation(mint, 30_000n).isConserved);

  // 4. INCREASE AGAIN: Buy 70,000 more tokens for 1.0 SOL
  lotRoot.addLot({
    mint,
    tokenQuantity: 70_000n,
    costBasisLamports: 1_000_000_000n,
    entryEconomicIntentId: 'intent-increase-3',
  });

  proj = lotRoot.getPositionProjection(mint);
  assert.ok(proj);
  assert.equal(proj.totalRemainingQuantity, 100_000n);
  assert.equal(proj.totalCostBasisLamports, 1_360_000_000n);
  assert.equal(proj.activeLotCount, 2);
  assert.ok(lotRoot.verifyConservation(mint, 100_000n).isConserved);

  // 5. FULL CLOSE: Sell remaining 100,000 tokens
  const exit2 = lotRoot.allocateExit(mint, 100_000n, 'FIFO');
  assert.equal(exit2.isFullyClosed, true);
  assert.equal(exit2.remainingPositionTokens, 0n);
  assert.equal(lotRoot.getPositionProjection(mint), null);
  assert.ok(lotRoot.verifyConservation(mint, 0n).isConserved);
});

test('LOTROOT: PRO_RATA exit policy allocates across all lots proportionally', () => {
  const lotRoot = new LotRootAuthority();
  const mint = 'ProRataTestMint111111111111111111111111111';

  // Lot A: 60,000 tokens (60% of position)
  lotRoot.addLot({
    mint,
    tokenQuantity: 60_000n,
    costBasisLamports: 600_000_000n,
    entryEconomicIntentId: 'intent-a',
  });

  // Lot B: 40,000 tokens (40% of position)
  lotRoot.addLot({
    mint,
    tokenQuantity: 40_000n,
    costBasisLamports: 400_000_000n,
    entryEconomicIntentId: 'intent-b',
  });

  // Sell 50,000 tokens PRO_RATA (50% scale-out)
  // Lot A should yield 30,000 tokens (50% of 60k)
  // Lot B should yield 20,000 tokens (50% of 40k)
  const exit = lotRoot.allocateExit(mint, 50_000n, 'PRO_RATA');
  assert.equal(exit.totalTokensSold, 50_000n);
  assert.equal(exit.remainingPositionTokens, 50_000n);

  assert.equal(exit.exhaustedLots[0].tokensDeducted, 30_000n);
  assert.equal(exit.exhaustedLots[0].costBasisDeducted, 300_000_000n);

  assert.equal(exit.exhaustedLots[1].tokensDeducted, 20_000n);
  assert.equal(exit.exhaustedLots[1].costBasisDeducted, 200_000_000n);

  assert.ok(lotRoot.verifyConservation(mint, 50_000n).isConserved);
});

test('LOTROOT: Invariant check detects any conservation breach', () => {
  const lotRoot = new LotRootAuthority();
  const mint = 'BreachTestMint111111111111111111111111111';

  lotRoot.addLot({
    mint,
    tokenQuantity: 50_000n,
    costBasisLamports: 500_000_000n,
    entryEconomicIntentId: 'intent-breach',
  });

  // Actual wallet has 45,000 tokens (5,000 missing)
  const check = lotRoot.verifyConservation(mint, 45_000n);
  assert.equal(check.isConserved, false);
  assert.equal(check.deltaTokens, 5_000n);
});
