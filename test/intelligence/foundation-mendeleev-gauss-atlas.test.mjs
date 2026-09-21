import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MendeleevDataOntology } from '../../dist/intelligence/ontology/mendeleev-ontology.js';
import { GaussNumericalIntegrityEngine } from '../../dist/intelligence/math/gauss-integrity.js';
import { AtlasTemporalKnowledgeFabric } from '../../dist/intelligence/temporal/atlas-fabric.js';

test('Layer 1 - Mendeleev Universal Data Ontology contracts', () => {
  // Check spec retrieval
  const priceSpec = MendeleevDataOntology.getSpec('price_usd');
  assert.ok(priceSpec);
  assert.equal(priceSpec.unit, 'USD');
  assert.equal(priceSpec.evidence_type, 'DERIVED');

  // Valid feature creation
  const now = Date.now();
  const val = MendeleevDataOntology.createValue('price_usd', 0.00245, now, 'jupiter_quote', 0.95);
  assert.equal(val.raw_value, 0.00245);
  assert.equal(val.is_null, false);
  assert.equal(val.is_unknown, false);
  assert.equal(val.evidence_type, 'DERIVED');
  assert.ok(MendeleevDataOntology.isFresh(val, now + 1000));

  // Unknown preservation (ZERO !== UNKNOWN)
  const unknownVal = MendeleevDataOntology.createValue('hsi', null, now, 'cold_start');
  assert.equal(unknownVal.raw_value, null);
  assert.equal(unknownVal.is_unknown, true);
  assert.equal(unknownVal.confidence, 0.0);

  // Rejection of null when forbidden
  assert.throws(() => {
    MendeleevDataOntology.createValue('lamports', null, now, 'rpc');
  }, /rejects null/);

  // Invalid range rejection
  assert.throws(() => {
    MendeleevDataOntology.createValue('pod', 1.5, now, 'model'); // pod must be <= 1.0
  }, /failed validation/);
});

test('Layer 1 - Gauss Numerical Integrity Engine', () => {
  // Finite non-negative
  assert.equal(GaussNumericalIntegrityEngine.assertFiniteNonNegative(10.5, 'liq'), 10.5);
  assert.throws(() => GaussNumericalIntegrityEngine.assertFiniteNonNegative(-1, 'liq'), /negative/);
  assert.throws(() => GaussNumericalIntegrityEngine.assertFiniteNonNegative(NaN, 'liq'), /NaN/);

  // Lamport conversions
  assert.equal(GaussNumericalIntegrityEngine.solToLamports(1.5), 1_500_000_000);
  assert.equal(GaussNumericalIntegrityEngine.lamportsToSol(1_500_000_000), 1.5);

  // Raw to UI tokens
  assert.equal(GaussNumericalIntegrityEngine.rawToUiTokens(1_000_000_000n, 6), 1000);

  // Balance debit checks
  const validDebit = GaussNumericalIntegrityEngine.verifyDebit(10.0, 4.5);
  assert.equal(validDebit.is_valid, true);
  assert.equal(validDebit.post_balance, 5.5);

  const invalidDebit = GaussNumericalIntegrityEngine.verifyDebit(5.0, 5.5);
  assert.equal(invalidDebit.is_valid, false);
  assert.ok(invalidDebit.violation_reason?.includes('exceeds current balance'));

  // Multi-source price reconciliation without naive averaging
  const sources = [
    { name: 'jupiter', priceSol: 0.000100, priceUsd: 0.0150, weight: 1.0 },
    { name: 'dexscreener', priceSol: 0.000102, priceUsd: 0.0153, weight: 0.8 },
    { name: 'manipulated_pool', priceSol: 0.000250, priceUsd: 0.0375, weight: 0.5 } // 150% divergence outlier
  ];
  const recon = GaussNumericalIntegrityEngine.reconcilePrices(sources, 500); // 5% divergence threshold
  assert.ok(recon.outliers_rejected.includes('manipulated_pool'));
  assert.ok(recon.reconciled_sources.includes('jupiter'));
  assert.ok(recon.reconciled_sources.includes('dexscreener'));
  assert.ok(recon.consensus_confidence > 0.6);
});

test('Layer 1 - Atlas Temporal Knowledge Fabric', () => {
  const atlas = new AtlasTemporalKnowledgeFabric();
  const t0 = Date.now();

  // Monotonic clocks
  const rec1 = atlas.append(
    'MARKET_EVENT',
    'evt_1',
    { event_time_ms: t0, knowledge_time_ms: t0 + 10, processing_time_ms: t0 + 20 },
    { type: 'SWAP', amount_sol: 1.2 },
    'pump_portal_ws',
    'MINT_ABC'
  );
  assert.equal(rec1.sequence_num, 1);
  assert.equal(atlas.getRecordCount(), 1);

  // Point in time query
  const resBefore = atlas.queryPointInTime(t0 + 5);
  assert.equal(resBefore.length, 0);

  const resAfter = atlas.queryPointInTime(t0 + 15);
  assert.equal(resAfter.length, 1);
  assert.equal(resAfter[0].record_id, rec1.record_id);

  // Inverted clocks rejection
  assert.throws(() => {
    atlas.append(
      'MARKET_EVENT',
      'evt_inv',
      { event_time_ms: t0 + 2000, knowledge_time_ms: t0, processing_time_ms: t0 + 10 },
      {},
      'test'
    );
  }, /Clock inversion/);
});
