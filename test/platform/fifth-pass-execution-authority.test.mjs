import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../../dist/config.js';
import {
  SimulationExecutionAuthority,
  LiveExecutionAuthority,
} from '../../dist/platform/execution/authority.js';
import {
  ProviderHealthTracker,
} from '../../dist/platform/ingestion/provider-health.js';
import { PumpPortalFrameValidator } from '../../dist/platform/ingestion/pumpportal-validator.js';
import {
  observedEvidence,
  derivedEvidence,
  unavailableEvidence,
  staleEvidence,
} from '../../dist/intelligence/evidence/provenance.js';
import {
  CapitalYieldRegimeEngine,
} from '../../dist/intelligence/research/capital-regime.js';
import {
  ReleaseCertificationAuthority,
} from '../../dist/platform/certification/release-certification.js';

test('Fifth Pass: SimulationExecutionAuthority enforces paper isolation and rejects live actions', async () => {
  const cfg = config({ MODE: 'paper', RPC_URLS: 'https://rpc.invalid', WS_URLS: 'wss://ws.invalid' });
  const mockMarket = {
    buyQuote: () => 1_000_000n,
    sellQuote: () => 900_000n,
  };

  const simAuthority = new SimulationExecutionAuthority(cfg, mockMarket);
  assert.equal(simAuthority.mode, 'SIMULATION');
  assert.equal(simAuthority.isLive, false);
  assert.equal(simAuthority.canExecuteLive(), false);

  const mockSnapshot = {
    mint: Keypair.generate().publicKey,
    tokenProgram: Keypair.generate().publicKey,
    at: Date.now(),
    slot: 1000,
    curve: {
      complete: false,
      realQuoteReserves: 30_000_000_000n,
      virtualQuoteReserves: 30_000_000_000n,
      virtualTokenReserves: 1_073_000_000_000_000n,
    },
  };

  const built = await simAuthority.build(
    mockSnapshot,
    'buy',
    100_000_000n,
    Keypair.generate().publicKey.toBase58(),
    0,
    'test_entry',
    false
  );

  assert.ok(built.pending.signature.startsWith('sim_'));
  assert.equal(built.pending.wire, '');
  assert.ok(built.tokenDelta > 0n);
  assert.ok(built.solDelta < 0n);

  // Cannot broadcast a live signature from simulation authority
  await assert.rejects(
    simAuthority.broadcast({ ...built.pending, signature: '5J4Z7RealLiveOnChainSigFake11111111111111111111111111111111111111111111111111111111111' }),
    /SimulationAuthority cannot broadcast live signature/
  );
});

test('Fifth Pass: LiveExecutionAuthority fails closed without valid live credentials and forbids placeholder signatures', async () => {
  const paperCfg = config({ MODE: 'paper', RPC_URLS: 'https://rpc.invalid', WS_URLS: 'wss://ws.invalid' });
  const mockRpc = {
    connection: {},
    endpoints: [{}],
  };
  const mockMarket = {};

  // 1. Rejects non-live mode
  assert.throws(
    () => new LiveExecutionAuthority(paperCfg, mockRpc, mockMarket, Keypair.generate()),
    /cannot be initialized with non-live config mode/
  );

  const liveCfg = config({ MODE: 'live', KEYPAIR_PATH: 'keypair.json', RPC_URLS: 'https://rpc1.invalid,https://rpc2.invalid', WS_URLS: 'wss://ws.invalid' });

  // 2. Rejects placeholder zero-seed keypair
  const testSeedKey = Keypair.fromSeed(Buffer.alloc(32, 7));
  assert.throws(
    () => new LiveExecutionAuthority(liveCfg, mockRpc, mockMarket, testSeedKey),
    /rejected placeholder test seed keypair/
  );

  // 3. Rejects empty RPC pool
  const realKey = Keypair.generate();
  assert.throws(
    () => new LiveExecutionAuthority(liveCfg, { endpoints: [] }, mockMarket, realKey),
    /requires an active RpcPool/
  );
});

test('Fifth Pass: Provider Capability Model independently exposes 15 fields and ignores unconfigured optional providers', () => {
  const tracker = new ProviderHealthTracker();
  const report = tracker.getReport();

  // Active authoritative provider has valid capability entry
  const pump = report.providers.PUMPPORTAL_WS;
  assert.ok(pump);
  assert.equal(pump.configured, true);
  assert.equal(pump.enabled, true);
  assert.equal(typeof pump.transportReachable, 'boolean');
  assert.equal(typeof pump.authenticated, 'boolean');
  assert.equal(typeof pump.capabilityAvailable, 'boolean');
  assert.equal(typeof pump.observationValidated, 'boolean');
  assert.ok(['FRESH', 'DEGRADED', 'STALE', 'UNKNOWN'].includes(pump.freshness));
  assert.ok(['CLOSED', 'DEGRADED', 'OPEN', 'PROBING', 'RECOVERING', 'HEALTHY'].includes(pump.circuitState));
  assert.equal(typeof pump.lastAttempt, 'number');
  assert.equal(typeof pump.lastSuccess, 'number');
  assert.equal(typeof pump.lastValidatedObservation, 'number');

  // Inactive optional provider (HELIOS_DIRECT_TPU) is unconfigured and does NOT make platform CRITICAL
  const helios = report.providers.HELIOS_DIRECT_TPU;
  assert.ok(helios);
  assert.equal(helios.configured, false);
  assert.equal(helios.enabled, false);
  assert.equal(helios.failureReason, 'PROVIDER_NOT_CONFIGURED');
  assert.ok(report.activeAlerts.every(a => a.source !== 'HELIOS_DIRECT_TPU'));
});

test('Fifth Pass: Bounded Rolling-Window Circuit Breaker requires 3 consecutive observations to recover', () => {
  const tracker = new ProviderHealthTracker();

  // Record initial successes
  tracker.recordSuccess('SOLANA_RPC', 50);
  assert.equal(tracker.getReport().providers.SOLANA_RPC.circuitState, 'HEALTHY');

  // Inject consecutive failures to trip circuit
  for (let i = 0; i < 5; i++) {
    tracker.recordFailure('SOLANA_RPC', 'SIMULATED_RPC_FAILURE');
  }
  assert.equal(tracker.getReport().providers.SOLANA_RPC.circuitState, 'OPEN');

  // Simulate cooldown expiry and first probe observation
  const cooldownNow = Date.now() + 15_000;
  tracker.recordValidatedObservation('SOLANA_RPC', 60, undefined, cooldownNow);
  assert.ok(['PROBING', 'RECOVERING'].includes(tracker.getReport().providers.SOLANA_RPC.circuitState));

  // A single failure during probing drops immediately back to OPEN
  tracker.recordFailure('SOLANA_RPC', 'PROBE_FAILED', cooldownNow + 100);
  assert.equal(tracker.getReport().providers.SOLANA_RPC.circuitState, 'OPEN');

  // Now simulate successful 3-observation recovery sequence
  const recoveryStart = cooldownNow + 20_000;
  tracker.recordValidatedObservation('SOLANA_RPC', 40, undefined, recoveryStart);
  tracker.recordValidatedObservation('SOLANA_RPC', 45, undefined, recoveryStart + 100);
  tracker.recordValidatedObservation('SOLANA_RPC', 42, undefined, recoveryStart + 200);
  tracker.recordValidatedObservation('SOLANA_RPC', 42, undefined, recoveryStart + 300);

  // After 3 consecutive validated observations, circuit returns to HEALTHY
  assert.equal(tracker.getReport().providers.SOLANA_RPC.circuitState, 'HEALTHY');
});

test('Fifth Pass: Endpoint failover is only reported when an actual transition occurs', () => {
  const tracker = new ProviderHealthTracker();
  assert.equal(tracker.getReport().providers.SOLANA_RPC.failoverActive, false);

  // Record transition
  tracker.recordEndpointTransition('SOLANA_RPC', 'https://primary-rpc.solana.com', 'https://backup-rpc.solana.com');
  const report = tracker.getReport();
  assert.equal(report.providers.SOLANA_RPC.failoverActive, true);
  assert.equal(report.providers.SOLANA_RPC.failoverProviderId, 'https://backup-rpc.solana.com');
});

test('Fifth Pass: PumpPortalFrameValidator enforces schema, slot ordering, deduplication, and numeric integrity', () => {
  const validator = new PumpPortalFrameValidator();
  const validMint = Keypair.generate().publicKey.toBase58();
  const validUser = Keypair.generate().publicKey.toBase58();
  const validSig = bs58.encode(Buffer.alloc(64, 1));

  // 1. Valid create frame
  const now = Date.now();
  const validFrame = {
    txType: 'create',
    mint: validMint,
    user: validUser,
    signature: validSig,
    slot: 250_000,
    timestamp: now - 50,
    solAmount: 1.5,
    name: 'Validated Token',
    symbol: 'VAL',
  };
  const res1 = validator.validateRaw(validFrame, now);
  assert.equal(res1.isValid, true);
  assert.ok(res1.measuredLatencyMs >= 50);

  // 2. Reject duplicate signature
  const resDup = validator.validateRaw(validFrame, now);
  assert.equal(resDup.isValid, false);
  assert.equal(resDup.rejectionReason, 'DUPLICATE_TRANSACTION_FRAME');

  // 3. Reject slot replay (>64 slots behind latest)
  const replayedFrame = {
    ...validFrame,
    signature: bs58.encode(Buffer.alloc(64, 2)),
    slot: 249_900,
  };
  const resReplay = validator.validateRaw(replayedFrame, now);
  assert.equal(resReplay.isValid, false);
  assert.match(resReplay.rejectionReason || '', /SLOT_REPLAY_DETECTED/);

  // 4. Reject malformed mint address
  const badMintFrame = { ...validFrame, signature: bs58.encode(Buffer.alloc(64, 3)), mint: 'not_a_valid_solana_address' };
  const resBadMint = validator.validateRaw(badMintFrame, now);
  assert.equal(resBadMint.isValid, false);
  assert.equal(resBadMint.rejectionReason, 'INVALID_TOKEN_MINT_ADDRESS');

  // 5. Reject negative numeric amount
  const negSolFrame = { ...validFrame, signature: bs58.encode(Buffer.alloc(64, 4)), solAmount: -5.0 };
  const resNeg = validator.validateRaw(negSolFrame, now);
  assert.equal(resNeg.isValid, false);
  assert.equal(resNeg.rejectionReason, 'INVALID_SOL_AMOUNT');
});

test('Fifth Pass: Evidence<T> Provenance Contract maintains nulls and prevents false defaults', () => {
  // 1. Observed evidence
  const obs = observedEvidence(42.5, 'DEXSCREENER_API');
  assert.equal(obs.status, 'OBSERVED');
  assert.equal(obs.value, 42.5);
  assert.equal(obs.confidence, 1.0);

  // 2. Derived evidence
  const der = derivedEvidence(150.0, 'SOL_SYNTHETIC_INDEX');
  assert.equal(der.status, 'DERIVED');
  assert.equal(der.value, 150.0);

  // 3. Unavailable evidence: value MUST be null, not 0
  const unavail = unavailableEvidence('RUGCHECK_API');
  assert.equal(unavail.status, 'UNAVAILABLE');
  assert.equal(unavail.value, null);
  assert.notEqual(unavail.value, 0);

  // 4. Stale evidence
  const stale = staleEvidence(10.0, 'SOLANA_RPC', Date.now() - 30_000);
  assert.equal(stale.status, 'STALE');
  assert.equal(stale.value, 10.0);
  assert.ok(stale.confidence < 0.5);
});

test('Fifth Pass: CapitalYieldRegimeEngine isolates fixtures and fails closed without live evidence', () => {
  const engine = new CapitalYieldRegimeEngine();

  // 1. Starts empty in operational state: no synthetic 8% or 6.5% defaults
  const emptySnap = engine.createRegimeSnapshot();
  assert.equal(emptySnap.activeYieldBenchmarksCount, 0);
  assert.equal(emptySnap.hasLiveEvidence, false);
  assert.equal(emptySnap.regimeState, 'EVIDENCE_UNAVAILABLE');
  assert.equal(emptySnap.opportunityCostScore, null);

  // Opportunity evaluation fails closed when no evidence exists
  const unavailEval = engine.evaluateOpportunityCost({
    mint: 'MemeMint11111111111111111111111111111111111111111',
    expectedAnnualizedReturnPct: 50.0,
  });
  assert.equal(unavailEval.isMemeRiskWorthwhile, false);
  assert.equal(unavailEval.recommendation, 'GATING_BLOCKED_UNAVAILABLE');

  // 2. Fixture quotes are explicitly tagged as FIXTURE
  engine.loadFixtureQuotes('FIXTURE');
  const fixtureSnap = engine.createRegimeSnapshot();
  assert.equal(fixtureSnap.hasLiveEvidence, false);
  assert.ok(fixtureSnap.notes.includes('ILLUSTRATIVE_FIXTURE_DATA_ONLY'));

  // Fixture quotes cannot satisfy live opportunity gating
  const fixtureEval = engine.evaluateOpportunityCost({
    mint: 'MemeMint11111111111111111111111111111111111111111',
    expectedAnnualizedReturnPct: 150.0,
  });
  assert.equal(fixtureEval.isMemeRiskWorthwhile, false);
  assert.equal(fixtureEval.recommendation, 'ALLOCATION_UNFAVORABLE');
  assert.ok(fixtureEval.explanation.includes('Capital is better allocated to safe yield protocols'));
});

test('Fifth Pass: ReleaseCertificationAuthority evaluates 13 gates and maintains release BLOCKED', () => {
  const authority = ReleaseCertificationAuthority.getInstance();
  const report = authority.getReport();

  assert.equal(report.releaseStatus, 'UNVERIFIED_CANDIDATE — PRODUCTION RELEASE BLOCKED');
  assert.equal(report.isProductionPermitted, false);
  assert.equal(report.gatesCount, 13);
  assert.ok(report.passedGatesCount >= 10);
  assert.ok(report.blockedGatesCount >= 1); // soakGate is BLOCKED
  assert.ok(report.primaryBlockers.length > 0);

  // Verify mandatory gates exist
  const expectedGates = [
    'sourceBuildGate',
    'testGate',
    'dependencyGate',
    'configurationGate',
    'securityGate',
    'providerGate',
    'executionGate',
    'reconciliationGate',
    'persistenceGate',
    'recoveryGate',
    'performanceGate',
    'soakGate',
    'artifactGate',
  ];

  for (const gateId of expectedGates) {
    assert.ok(report.gates[gateId], `Missing required certification gate: ${gateId}`);
    assert.equal(report.gates[gateId].isMandatory, true);
  }

  // soakGate must be BLOCKED
  assert.equal(report.gates.soakGate.state, 'BLOCKED');
  // artifactGate must be INCOMPLETE
  assert.equal(report.gates.artifactGate.state, 'INCOMPLETE');
});
