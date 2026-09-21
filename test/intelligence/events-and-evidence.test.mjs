import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EventJournal,
  WatermarkEngine,
  LiveClock,
  ReplayClock,
  TestClock,
} from '../../dist/intelligence/events/canonical-event.js';

import {
  EvidenceRegistry,
  SourceReliabilityTracker,
  VALUE_UNKNOWN,
  VALUE_MISSING,
} from '../../dist/intelligence/evidence/evidence-registry.js';

import {
  CanonicalTokenStore,
} from '../../dist/intelligence/truth/canonical-store.js';

test('Canonical Events: EventJournal appends, assigns sequences, and calculates checksums', () => {
  const journal = new EventJournal();
  const mint = 'So11111111111111111111111111111111111111112';

  const { event, arrivalStatus } = journal.append({
    eventType: 'TOKEN_DISCOVERED',
    mint,
    source: 'pumpportal_ws',
    payload: { symbol: 'TEST', name: 'Test Token' },
    observedAt: Date.now(),
  });

  assert.equal(event.sequence, 1);
  assert.equal(event.mint, mint);
  assert.equal(event.eventType, 'TOKEN_DISCOVERED');
  assert.equal(arrivalStatus, 'ON_TIME');
  assert.ok(event.checksum && event.checksum.length === 64, 'Checksum must be SHA-256');
  assert.equal(journal.getEventCount(), 1);

  const retrieved = journal.getEvent(1);
  assert.equal(retrieved?.eventId, event.eventId);
});

test('Multi-Clock & Watermark: ReplayClock advances deterministically and flags late arrivals', () => {
  const replayClock = new ReplayClock(1000000);
  const watermark = new WatermarkEngine({ maxAllowedLatenessMs: 5000, hardExpiryMs: 30000 });

  // On-time event
  const status1 = watermark.evaluateArrival(1000000, replayClock.now());
  assert.equal(status1, 'ON_TIME');

  // Advance time by 10s
  replayClock.advance(10000);

  // Late accepted event (6s old)
  const status2 = watermark.evaluateArrival(1004000, replayClock.now());
  assert.equal(status2, 'LATE_ACCEPTED');

  // Too late event (45s old)
  const status3 = watermark.evaluateArrival(965000, replayClock.now());
  assert.equal(status3, 'TOO_LATE');
});

test('Evidence Registry: Enforces ZERO != UNKNOWN and UNKNOWN != MISSING axioms', () => {
  const tracker = new SourceReliabilityTracker();
  tracker.registerSource('dexscreener');
  const registry = new EvidenceRegistry(tracker);

  const mint = 'Mint111111111111111111111111111111111111111';
  const now = Date.now();

  // Test Missing value
  const { fact: missingFact } = registry.ingestFact({
    factId: 'fact_miss_1',
    mint,
    field: 'price',
    value: VALUE_MISSING,
    unit: 'SOL',
    source: 'dexscreener',
    eventTime: now,
    receivedTime: now,
    ageMs: 0,
    reliability: 1.0,
    quality: 1.0,
    confidence: 0.0,
    completeness: false,
    status: 'FRESH',
    epistemicType: 'OBSERVED',
    provenance: { source: 'dexscreener' },
  }, now);

  assert.equal(missingFact.status, 'MISSING');
  assert.notEqual(missingFact.value, 0, 'Missing must not equal 0');
  assert.notEqual(missingFact.value, VALUE_UNKNOWN, 'Missing must not equal Unknown');

  // Test numerical Zero value
  const { fact: zeroFact } = registry.ingestFact({
    factId: 'fact_zero_1',
    mint,
    field: 'price',
    value: 0.0,
    unit: 'SOL',
    source: 'dexscreener',
    eventTime: now,
    receivedTime: now,
    ageMs: 0,
    reliability: 1.0,
    quality: 1.0,
    confidence: 1.0,
    completeness: true,
    status: 'FRESH',
    epistemicType: 'OBSERVED',
    provenance: { source: 'dexscreener' },
  }, now);

  assert.equal(zeroFact.value, 0.0);
  assert.notEqual(zeroFact.value, VALUE_MISSING);
  assert.notEqual(zeroFact.value, VALUE_UNKNOWN);
});

test('Evidence Fusion: Detects severe source disagreement between providers', () => {
  const tracker = new SourceReliabilityTracker();
  tracker.registerSource('pumpportal');
  tracker.registerSource('dexscreener');
  const registry = new EvidenceRegistry(tracker);

  const mint = 'Mint222222222222222222222222222222222222222';
  const now = Date.now();

  // Primary source says 100.0 SOL liquidity
  registry.ingestFact({
    factId: 'fact_pumpportal_liq',
    mint,
    field: 'liquidity',
    value: 100.0,
    unit: 'SOL',
    source: 'pumpportal',
    eventTime: now,
    receivedTime: now,
    ageMs: 0,
    reliability: 0.95,
    quality: 1.0,
    confidence: 0.90,
    completeness: true,
    status: 'FRESH',
    epistemicType: 'OBSERVED',
    provenance: { source: 'pumpportal' },
  }, now);

  // Conflicting source says 10.0 SOL liquidity (90% disagreement)
  const { fused } = registry.ingestFact({
    factId: 'fact_dex_liq',
    mint,
    field: 'liquidity',
    value: 10.0,
    unit: 'SOL',
    source: 'dexscreener',
    eventTime: now,
    receivedTime: now,
    ageMs: 0,
    reliability: 0.90,
    quality: 1.0,
    confidence: 0.90,
    completeness: true,
    status: 'FRESH',
    epistemicType: 'OBSERVED',
    provenance: { source: 'dexscreener' },
  }, now);

  assert.equal(fused.status, 'CONFLICTED');
  assert.ok(fused.conflicts.length > 0);
  assert.equal(fused.conflicts[0].category, 'SEVERE_SOURCE_DISAGREEMENT');
  assert.ok(fused.uncertainty > 0.50, 'Severe disagreement increases uncertainty');
});

test('Canonical Store: Atomic State Transactions update StateVersion without torn state', () => {
  const store = new CanonicalTokenStore();
  const mint = 'Mint333333333333333333333333333333333333333';

  const initial = store.registerToken({
    mint,
    symbol: 'ATOMIC',
    name: 'Atomic Token',
    creatorAddress: 'Creator1111111111111111111111111111111111',
    initialPriceSol: 0.0005,
    initialLiquiditySol: 35.0,
  });

  assert.equal(initial.stateVersion, 1);
  assert.equal(initial.protectionState, 'ACTIVE');

  // Commit atomic update with PoD transitioning to D
  const updated = store.commitTransaction({
    transactionId: 'tx_update_01',
    mint,
    mutation: (curr) => ({
      podState: 'D',
      hsi: 20,
      realLiquiditySol: 12.0,
    }),
    reason: 'PoD Dump triggered by massive creator sell',
    timestampMs: Date.now(),
  });

  assert.equal(updated.stateVersion, 2);
  assert.equal(updated.podState, 'D');
  // State Invariant: PoD=D automatically demotes protection to REVIEW
  assert.equal(updated.protectionState, 'REVIEW');
  assert.equal(updated.hsi, 20);
});
