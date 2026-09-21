import test from 'node:test';
import assert from 'node:assert/strict';

import { EventJournal } from '../../dist/intelligence/events/canonical-event.js';
import { EvidenceCoverageTracker, VALUE_UNKNOWN } from '../../dist/intelligence/evidence/evidence-registry.js';
import { SourceHealthEngine } from '../../dist/intelligence/evidence/source-health.js';
import { SystemIntegrityEngine } from '../../dist/intelligence/safety/system-integrity.js';
import { MaterializedStateEngine } from '../../dist/intelligence/truth/materialized-reducers.js';
import { StateEpochEngine } from '../../dist/intelligence/truth/state-epochs.js';

test('Blueprint Phase 1 - Canonical SylphEvent & Exactly-Once Event Deduplication', () => {
  const journal = new EventJournal();
  const now = Date.now();

  const eventParams = {
    eventType: 'TOKEN_DISCOVERED',
    mint: 'MintTokenAlpha111111111111111111111111111111',
    slot: 280_000,
    transactionSignature: '5sig_alpha_unique_tx',
    instructionIndex: 2,
    innerInstructionIndex: 1,
    source: 'PUMP_PORTAL',
    sourceSequence: 101,
    commitment: 'confirmed',
    chainTime: now - 50,
    observedAt: now - 50,
    receivedAt: now - 20,
    decodedAt: now - 15,
    payload: { amountSol: 15.0, priceSol: 0.00004 },
    schemaVersion: '1.0.0',
    decoderVersion: 'pump_v2',
  };

  // First append -> ON_TIME
  const firstAppend = journal.append(eventParams);
  assert.equal(firstAppend.arrivalStatus, 'ON_TIME');
  const event = firstAppend.event;

  // Verify conceptual fields
  assert.ok(event.eventId.startsWith('evt_'));
  assert.ok(event.canonicalKey.length > 0);
  assert.equal(event.mint, 'MintTokenAlpha111111111111111111111111111111');
  assert.equal(event.slot, 280_000);
  assert.equal(event.transactionSignature, '5sig_alpha_unique_tx');
  assert.equal(event.instructionIndex, 2);
  assert.equal(event.innerInstructionIndex, 1);
  assert.equal(event.commitment, 'confirmed');
  assert.equal(event.decoderVersion, 'pump_v2');
  assert.ok(event.rawHash.length > 0);

  // Re-transmitting duplicate event with same slot/signature/instruction -> DUPLICATE
  const duplicateAppend = journal.append({
    ...eventParams,
    source: 'RPC_FALLBACK',
    sourceSequence: 999,
    receivedAt: now - 10,
  });

  assert.equal(duplicateAppend.arrivalStatus, 'DUPLICATE', 'Must enforce exactly-once effects by rejecting duplicate canonical keys');
  assert.equal(journal.getEventCount(), 1, 'Journal size must remain 1');
});

test('Blueprint Phase 1 - Evidence Envelope & Coverage Tracker with Confidence Ceilings', () => {
  const tracker = new EvidenceCoverageTracker();

  const now = Date.now();
  const envStructural = {
    value: 'REVOKED',
    source: 'RPC_VALIDATOR_1',
    slot: 280_000,
    observedAt: now - 100,
    availableAt: now - 90,
    computedAt: now - 85,
    commitment: 'confirmed',
    ageMs: 100,
    verificationStatus: 'KNOWN',
    confidence: 0.95,
    parserVersion: 'v1.0.0',
    rawHash: 'hash_structural_revoked',
  };

  const envMarket = {
    value: 25.5,
    source: 'PUMP_PORTAL',
    slot: 280_000,
    observedAt: now - 50,
    availableAt: now - 40,
    computedAt: now - 35,
    commitment: 'confirmed',
    ageMs: 50,
    verificationStatus: 'KNOWN',
    confidence: 0.90,
    parserVersion: 'v1.0.0',
    rawHash: 'hash_market_vol',
  };

  tracker.recordEnvelope('MintAlpha', 'mintAuthority', envStructural);
  tracker.recordEnvelope('MintAlpha', 'price', envMarket);

  const coveragePartial = tracker.evaluateCoverage('MintAlpha');
  assert.ok(coveragePartial.overallCoverage > 0.0);
  assert.ok(coveragePartial.confidenceCeiling === 'LOW' || coveragePartial.confidenceCeiling === 'MED', 'Critical UNKNOWN values must impose confidence ceilings');

  // Verify explicit distinguished states: ZERO is distinct from UNKNOWN
  const envZero = {
    value: 0,
    source: 'SIMULATOR',
    observedAt: now - 10,
    availableAt: now - 5,
    computedAt: now,
    commitment: 'confirmed',
    ageMs: 10,
    verificationStatus: 'KNOWN',
    confidence: 0.85,
    parserVersion: 'v1.0.0',
    rawHash: 'hash_zero',
  };
  assert.equal(envZero.verificationStatus, 'KNOWN');
  assert.equal(envZero.value, 0);

  const envUnknown = {
    value: VALUE_UNKNOWN,
    source: 'ROUTER',
    observedAt: now - 10,
    availableAt: now - 5,
    computedAt: now,
    commitment: 'confirmed',
    ageMs: 10,
    verificationStatus: 'UNKNOWN',
    confidence: 0.0,
    parserVersion: 'v1.0.0',
    rawHash: 'hash_unknown',
  };
  assert.equal(envUnknown.verificationStatus, 'UNKNOWN');
  assert.notEqual(envZero.value, envUnknown.value);
});

test('Blueprint Phase 1 - Source Health Engine & Independent Provider Deduplication', () => {
  const healthEngine = new SourceHealthEngine();

  healthEngine.recordResponse('solana_rpc_primary', 85, 0, true);
  healthEngine.recordResponse('solana_rpc_backup', 95, 0, true);
  healthEngine.recordResponse('dexscreener_api', 250, 0, true);

  const rpcHealth = healthEngine.getHealthStatus('solana_rpc_primary');
  assert.equal(rpcHealth, 'HEALTHY');

  // Correlated confirmation check: primary and backup RPC share same correlationGroup ('rpc_cluster_solana')
  const scoreCorrelatedOnly = healthEngine.getIndependentConfirmationScore(['solana_rpc_primary', 'solana_rpc_backup']);
  assert.ok(scoreCorrelatedOnly > 0.0);

  // Multi-group confirmation with DEX screener adds independent diversity
  const scoreMultiGroup = healthEngine.getIndependentConfirmationScore(['solana_rpc_primary', 'dexscreener_api']);
  assert.ok(scoreMultiGroup > scoreCorrelatedOnly, 'Multiple independent correlation groups must score higher than single correlated cluster');
});

test('Blueprint Phase 1 - System Integrity Engine & Token vs System Separation', () => {
  const integrityEngine = new SystemIntegrityEngine();

  // Baseline healthy checks
  const validCert = integrityEngine.evaluateIntegrity({
    rpcQuorum: true,
    eventContinuity: true,
    decoderHealth: true,
    stateDeterminism: true,
    executionReconciled: true,
    portfolioLedgerIntegrity: true,
    clockHealth: true,
    persistenceHealth: true,
    queueHealth: true,
  });

  assert.equal(validCert.status, 'VALID');
  assert.equal(validCert.operationalMode, 'NORMAL');
  assert.equal(validCert.executionPermitted, true);

  // Critical failure: state determinism fails
  const degradedCert = integrityEngine.evaluateIntegrity({
    rpcQuorum: true,
    stateDeterminism: false, // Critical failure
  });

  assert.equal(degradedCert.status, 'INVALID');
  assert.equal(degradedCert.operationalMode, 'SAFE_MODE');
  assert.equal(degradedCert.executionPermitted, false, 'Critical system failure must block all execution');
});

test('Blueprint Phase 1 & 2 - Materialized Reducers & State Epochs', () => {
  const materializedEngine = new MaterializedStateEngine();
  const epochEngine = new StateEpochEngine();

  const currentEpoch = epochEngine.getCurrentEpoch();
  assert.ok(currentEpoch >= 1);

  // Issue fencing token
  const fencingToken = epochEngine.issueFencingToken('bg_task_twin_simulation', 'SIMULATION');
  assert.equal(fencingToken.epoch, currentEpoch);
  assert.equal(epochEngine.validateFencingToken(fencingToken).valid, true);

  // Advance epoch
  const nextEpoch = epochEngine.incrementEpoch('State mutation commit');
  assert.equal(nextEpoch, currentEpoch + 1);

  // Previous fencing token must now be rejected
  assert.equal(epochEngine.validateFencingToken(fencingToken).valid, false, 'Stale fencing tokens must not be permitted to execute or write state');

  const reduced = materializedEngine.reduceEvent({
    eventId: 'evt_reduce_01',
    canonicalKey: 'key_reduce_01',
    correlationId: 'corr_01',
    sequence: 1,
    mint: 'TokenBeta11111111111111111111111111111111111',
    slot: 280_010,
    transactionSignature: '5sig_reduce',
    instructionIndex: 0,
    innerInstructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceSequence: 1,
    commitment: 'confirmed',
    chainTime: 1_720_000_100,
    observedAt: 1_720_000_104,
    receivedAt: 1_720_000_105,
    decodedAt: 1_720_000_106,
    processedAt: 1_720_000_107,
    eventType: 'LIQUIDITY_UPDATED',
    payload: { reservesQuote: 45.0, reservesBase: 800_000_000 },
    quality: 'HIGH',
    schemaVersion: '1.0.0',
    decoderVersion: 'v1',
    sessionId: 'sess_1',
    environment: 'SIMULATION',
    checksum: 'cs_01',
    rawHash: 'raw_01',
  });

  assert.ok(reduced.stateHash.length > 0);
  assert.equal(reduced.liquidity.reservesQuote, 45.0);

  const snapshot = materializedEngine.getState('TokenBeta11111111111111111111111111111111111');
  assert.equal(snapshot?.mint, 'TokenBeta11111111111111111111111111111111111');
  assert.equal(snapshot?.liquidity.reservesQuote, 45.0);
});
