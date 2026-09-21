import test from 'node:test';
import assert from 'node:assert/strict';

import { EvidenceGraphEngine } from '../../dist/intelligence/evidence/evidence-graph.js';

test('Scientific Evidence Graph Engine - Registration, Provenance, Lineage, and Retraction', async () => {
  const graph = new EvidenceGraphEngine();

  // 1. Register base evidence
  const e1 = graph.registerEvidence({
    evidence_id: 'evi_price_001',
    claim: 'Price is 0.000025 SOL',
    epistemic_type: 'OBSERVED',
    fact_status: 'FRESH',
    confidence: 0.95,
    observed_at_ms: 1000,
    known_at_ms: 1005,
    provider: 'PumpPortal',
    slot: 290000,
    source_event_id: 'evt_price_001',
  });

  assert.ok(e1.content_hash.length > 0, 'Evidence must contain cryptographic digest');
  assert.equal(e1.epistemic_type, 'OBSERVED');
  assert.equal(e1.confidence, 0.95);

  // 2. Register derived evidence depending on e1
  const e2 = graph.registerEvidence({
    evidence_id: 'evi_mcap_001',
    claim: 'Market Cap is 150 SOL',
    epistemic_type: 'DERIVED',
    fact_status: 'FRESH',
    confidence: 0.90,
    observed_at_ms: 1010,
    known_at_ms: 1012,
    provider: 'PricingEngine',
    slot: 290001,
    dependencies: [e1.evidence_id],
  });

  // 3. Register high-level hypothesis evidence depending on e2
  const e3 = graph.registerEvidence({
    evidence_id: 'evi_momentum_001',
    claim: 'Expansion thesis supported by price & mcap',
    epistemic_type: 'INFERRED',
    fact_status: 'FRESH',
    confidence: 0.85,
    observed_at_ms: 1015,
    known_at_ms: 1018,
    provider: 'ThesisEngine',
    slot: 290002,
    dependencies: [e2.evidence_id],
  });

  // 4. Trace upstream lineage for e3
  const lineage = graph.traceLineage(e3.evidence_id);
  assert.ok(lineage.evidence !== undefined);
  assert.equal(lineage.evidence?.evidence_id, e3.evidence_id);
  assert.equal(lineage.ancestors.length, 2, 'Lineage must trace upstream dependencies e2 and e1');
  assert.equal(lineage.ancestors[0].evidence_id, e2.evidence_id);
  assert.equal(lineage.ancestors[1].evidence_id, e1.evidence_id);
  assert.ok(lineage.is_fully_active, 'Lineage should be fully active prior to retraction');

  // 5. Test Evidence Revision by re-registering with updated claim
  const revisedE1 = graph.registerEvidence({
    evidence_id: e1.evidence_id,
    claim: 'Price is revised to 0.000026 SOL',
    epistemic_type: 'OBSERVED',
    fact_status: 'FRESH',
    confidence: 0.98,
    observed_at_ms: 1020,
    known_at_ms: 1022,
    provider: 'PumpPortal',
    slot: 290005,
  });
  assert.equal(revisedE1.claim, 'Price is revised to 0.000026 SOL');
  assert.equal(revisedE1.revision_number, 2);
  assert.equal(graph.getRevisions().length, 1);

  // 6. Test Cascade Retraction
  // Retracting e1 should retract e1 and invalidate downstream e2 and e3
  const retraction = graph.retractEvidence(e1.evidence_id, 'Provider reported false ticks', 290010);
  assert.equal(retraction.evidence_id, e1.evidence_id);
  assert.equal(retraction.invalidated_downstream_evidence.length, 2, 'Must invalidate e2 and e3');
  assert.ok(retraction.invalidated_downstream_evidence.includes(e2.evidence_id));
  assert.ok(retraction.invalidated_downstream_evidence.includes(e3.evidence_id));

  // Check state of retracted node and downstream node
  const retractedBase = graph.getEvidence(e1.evidence_id);
  assert.equal(retractedBase?.is_retracted, true);
  assert.equal(retractedBase?.fact_status, 'INVALID');

  const invalidDownstream = graph.getEvidence(e3.evidence_id);
  assert.equal(invalidDownstream?.fact_status, 'INVALID');
  assert.equal(invalidDownstream?.confidence, 0.0);
});
