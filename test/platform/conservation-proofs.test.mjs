import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConservationProofAuthority,
  OutcomeMaturityGate,
} from '../../dist/platform/pipeline/index.js';

test('CONSERVATION: exact token, basis, and PnL conservation issues valid proof certificate', () => {
  const authority = new ConservationProofAuthority();

  // Exactly balanced:
  // Acquired: 1,000,000 tokens
  // Disposed: 600,000 tokens | Remaining: 400,000 tokens
  // Opening Basis: 10,000,000,000 lamports (10 SOL)
  // Relieved Basis: 6,000,000,000 lamports (6 SOL) | Remaining Basis: 4,000,000,000 lamports (4 SOL)
  // Gross Proceeds: 7,500,000,000 lamports (7.5 SOL)
  // Exit Costs (fees/tips/rent): 50,000,000 lamports (0.05 SOL)
  // Expected Net PnL = 7,500,000,000 - 6,000,000,000 - 50,000,000 = 1,450,000,000 lamports (1.45 SOL)
  const cert = authority.certifyConservation(
    'lot_test_001',
    '9dSMwFfPezQ8WPcW1uZV7ns4rcviEj2LssSAg75WBLXd',
    1000000n,
    600000n,
    400000n,
    10000000000n,
    6000000000n,
    4000000000n,
    7500000000n,
    50000000n,
    1450000000n,
    '2026-10-03T20:00:00.000Z'
  );

  assert.equal(cert.isConserved, true);
  assert.equal(cert.lotId, 'lot_test_001');
  assert.equal(cert.accountingPnLLamports, 1450000000n);
  assert.equal(typeof cert.certificateHash, 'string');
  assert.equal(cert.certificateHash.length, 64);
});

test('CONSERVATION: token balance leak throws CONSERVATION_VIOLATION', () => {
  const authority = new ConservationProofAuthority();

  // Leaking 1 token: 1000 != 600 + 399
  assert.throws(() => {
    authority.certifyConservation(
      'lot_leak_001',
      'mint_abc',
      1000n,
      600n,
      399n, // Leak!
      10000n,
      6000n,
      4000n,
      7000n,
      100n,
      900n,
      '2026-10-03T20:00:00.000Z'
    );
  }, /CONSERVATION_VIOLATION \[TOKEN_LOT\]/);
});

test('CONSERVATION: cost basis leak throws CONSERVATION_VIOLATION', () => {
  const authority = new ConservationProofAuthority();

  // Leaking 1 lamport basis: 10000 != 6000 + 3999
  assert.throws(() => {
    authority.certifyConservation(
      'lot_leak_002',
      'mint_abc',
      1000n,
      600n,
      400n,
      10000n,
      6000n,
      3999n, // Leak!
      7000n,
      100n,
      900n,
      '2026-10-03T20:00:00.000Z'
    );
  }, /CONSERVATION_VIOLATION \[BASIS\]/);
});

test('CONSERVATION: incorrect accounting PnL throws CONSERVATION_VIOLATION', () => {
  const authority = new ConservationProofAuthority();

  // Proceeds 7000 - BasisRelieved 6000 - Costs 100 = Expected 900.
  // Supplying 950 must throw!
  assert.throws(() => {
    authority.certifyConservation(
      'lot_leak_003',
      'mint_abc',
      1000n,
      600n,
      400n,
      10000n,
      6000n,
      4000n,
      7000n,
      100n,
      950n, // Fabricated PnL!
      '2026-10-03T20:00:00.000Z'
    );
  }, /CONSERVATION_VIOLATION \[PNL\]/);
});

test('OUTCOME MATURITY: mature outcome issues LEARNING_READY certificate with isolated dataset tag', () => {
  const gate = new OutcomeMaturityGate();

  const maturePaperInput = {
    tradeId: 'trd_paper_001',
    economicFactId: 'fact_paper_001',
    accountMode: 'paper',
    settledSlot: 1000n,
    currentSlot: 1150n, // Delta = 150 slots
    settledAtMs: 1000000,
    currentAtMs: 1065000, // Delta = 65,000 ms (65s)
    minMaturityDelayMs: 60000, // Requires 60s
    minMaturitySlotDelta: 100n, // Requires 100 slots
    mfePct: 15.2,
    maePct: -2.1,
    realizedNetPnLLamports: 50000000n,
  };

  const cert = gate.evaluateMaturity(maturePaperInput, '2026-10-03T20:01:05.000Z');

  assert.equal(cert.isMature, true);
  assert.equal(cert.learningReady, true);
  assert.equal(cert.labelDatasetTag, 'RESEARCH_COUNTERFACTUAL');
  assert.equal(cert.maturitySlotDelta, 150n);
  assert.equal(cert.observationWindowMs, 65000);
  assert.equal(typeof cert.certificateHash, 'string');
  assert.equal(cert.certificateHash.length, 64);
});

test('OUTCOME MATURITY: premature observation rejects with INSUFFICIENT_TIME_MATURITY', () => {
  const gate = new OutcomeMaturityGate();

  const prematureInput = {
    tradeId: 'trd_paper_002',
    economicFactId: 'fact_paper_002',
    accountMode: 'live',
    settledSlot: 1000n,
    currentSlot: 1050n, // 50 slots < 100
    settledAtMs: 1000000,
    currentAtMs: 1010000, // 10s < 60s
    minMaturityDelayMs: 60000,
    minMaturitySlotDelta: 100n,
    mfePct: 2.0,
    maePct: -0.5,
    realizedNetPnLLamports: 1000000n,
  };

  const cert = gate.evaluateMaturity(prematureInput, '2026-10-03T20:00:10.000Z');

  assert.equal(cert.isMature, false);
  assert.equal(cert.learningReady, false);
  assert.ok(cert.rejectionReason?.includes('INSUFFICIENT_SLOT_MATURITY'));
});
