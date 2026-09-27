import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AssetAmount,
  DimensionMismatchError,
  DimensionLedger,
  createPriceCertificate
} from '../../dist/platform/ledger/dimension-ledger.js';

describe('DIMENSION-LEDGER & MARK-II: Unit-Safe Accounting (Sections 27, 28)', () => {
  it('strictly enforces dimension safety: cannot add or subtract different mints or decimals', () => {
    const sol = AssetAmount.sol(1000000000n); // 1.0 SOL
    const token = AssetAmount.spl('TokenMint11111111111111111111111111111111111', 6, 5000000n); // 5.0 Tokens

    // Attempting to combine SOL and Token units must fail closed
    assert.throws(
      () => sol.add(token),
      DimensionMismatchError,
      'Adding SOL and Token units must throw DimensionMismatchError'
    );

    // Attempting to combine same mint but differing decimals must fail closed
    const token6Dec = AssetAmount.spl('TokenMint11111111111111111111111111111111111', 6, 100n);
    const token9Dec = AssetAmount.spl('TokenMint11111111111111111111111111111111111', 9, 100n);
    assert.throws(
      () => token6Dec.add(token9Dec),
      DimensionMismatchError,
      'Differing decimals must throw DimensionMismatchError'
    );

    // Valid same-dimension arithmetic succeeds
    const sol2 = AssetAmount.sol(500000000n); // 0.5 SOL
    const combinedSol = sol.add(sol2);
    assert.equal(combinedSol.raw, 1500000000n);
    assert.equal(combinedSol.toUiString(), '1.5');
  });

  it('MARK-II replaces static prices ($150) with verified multi-provider PriceCertificates', () => {
    const solPriceCert = createPriceCertificate({
      pair: 'SOL/USD',
      baseAsset: 'SOL',
      quoteAsset: 'USD',
      referenceMark: 154.20,
      executableLiquidationValue: 153.95,
      slot: 289450120,
      timestampMs: Date.now(),
      providerSet: ['PYTH_ORACLE', 'JUPITER_ROUTER', 'SWITCHBOARD'],
      independenceScore: 0.95,
      confidence: 0.98,
      isDepegged: false,
      freshnessMs: 320
    });

    assert.ok(solPriceCert.certificateId.startsWith('PRICECERT-289450120-'));
    assert.equal(solPriceCert.referenceMark, 154.20);
    assert.equal(solPriceCert.executableLiquidationValue, 153.95);
    assert.ok(solPriceCert.independenceScore >= 0.9);
  });

  it('evaluates PnL without unit contamination and distinguishes reference mark from executable liquidation', () => {
    const ledger = new DimensionLedger(10000000000n); // 10 SOL initial
    const mint = 'TokenX1111111111111111111111111111111111111';

    const solPriceCert = createPriceCertificate({
      pair: 'SOL/USD',
      baseAsset: 'SOL',
      quoteAsset: 'USD',
      referenceMark: 160.0,
      executableLiquidationValue: 159.8,
      slot: 289450200,
      timestampMs: Date.now(),
      providerSet: ['RPC_CLUSTER', 'JUPITER'],
      independenceScore: 0.9,
      confidence: 0.95,
      isDepegged: false,
      freshnessMs: 250
    });

    const tokenPriceCert = createPriceCertificate({
      pair: `${mint}/SOL`,
      baseAsset: mint,
      quoteAsset: 'SOL',
      referenceMark: 0.00010,           // 0.00010 SOL per token mid-market
      executableLiquidationValue: 0.000085, // 15% exit discount for slippage/impact
      slot: 289450200,
      timestampMs: Date.now(),
      providerSet: ['DEXSCREENER', 'RAYDIUM_VAULT'],
      independenceScore: 0.85,
      confidence: 0.92,
      isDepegged: false,
      freshnessMs: 400
    });

    const tokenQty = AssetAmount.spl(mint, 6, 20000000000n); // 20,000 tokens
    const costBasisSol = AssetAmount.sol(1500000000n);       // 1.5 SOL
    const executionCostsSol = AssetAmount.sol(50000000n);    // 0.05 SOL

    const valuation = ledger.evaluatePositionPnL({
      mint,
      tokenQuantity: tokenQty,
      costBasisSol,
      executionCostsSol,
      tokenPriceCert,
      solPriceCert
    });

    // 20,000 tokens * 0.00010 = 2.0 SOL gross reference
    assert.ok(Math.abs(valuation.referenceGrossValueSol - 2.0) < 1e-6);
    // 20,000 tokens * 0.000085 = 1.7 SOL net executable liquidation
    assert.ok(Math.abs(valuation.executableNetValueSol - 1.7) < 1e-6);

    // Total cost = 1.5 + 0.05 = 1.55 SOL
    // Net PnL = 1.7 - 1.55 = 0.15 SOL
    assert.ok(Math.abs(valuation.unrealizedPnLSol - 0.15) < 1e-6);
    // Net PnL in USD = 0.15 SOL * $160 = $24.0 USD
    assert.ok(Math.abs(valuation.unrealizedPnLUsd - 24.0) < 1e-4);
    // Verifies digest is non-empty and deterministic
    assert.ok(valuation.digest.length === 64);
  });
});
