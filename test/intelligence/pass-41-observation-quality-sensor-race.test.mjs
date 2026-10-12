import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 41: Observation Quality Engine & Invariant Verification (Section VIII & Study OBSERVABILITY-GAP-X)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. High-quality nominal inputs -> sufficient
  const nominalCert = engine.evaluateObservationQuality({
    observationCount: 10,
    historySpanSeconds: 30,
    slotLag: 2,
    wallAgeMs: 80,
    maxObservedGapSeconds: 5,
    sourceCount: 3,
    sourcesInAgreement: 3,
    unobservedDropCount: 0,
  });

  assert.equal(nominalCert.sufficient, true, 'Nominal observation stream must pass quality certificate');
  assert.equal(nominalCert.blockers.length, 0);
  assert.ok(nominalCert.certificateDigest.length === 64, 'Digest must be 64-char SHA-256');
  assert.ok(nominalCert.observationCoverage >= 0.40);
  assert.ok(nominalCert.missingnessRisk <= 0.70);
  assert.equal(nominalCert.sourceAgreement, 1.0);

  // 2. Insufficient observation count (< 2) -> SINGLE_OBSERVATION_INSUFFICIENT
  const singleObsCert = engine.evaluateObservationQuality({
    observationCount: 1,
    historySpanSeconds: 10,
    slotLag: 1,
    wallAgeMs: 50,
    maxObservedGapSeconds: 2,
    sourceCount: 1,
    sourcesInAgreement: 1,
    unobservedDropCount: 0,
  });

  assert.equal(singleObsCert.sufficient, false);
  assert.ok(singleObsCert.blockers.includes('SINGLE_OBSERVATION_INSUFFICIENT'));

  // 3. Stale wall age (> 5000ms) -> WALL_AGE_EXCEEDS_FRESHNESS_LIMIT
  const staleWallCert = engine.evaluateObservationQuality({
    observationCount: 10,
    historySpanSeconds: 30,
    slotLag: 1,
    wallAgeMs: 6500,
    maxObservedGapSeconds: 5,
    sourceCount: 2,
    sourcesInAgreement: 2,
    unobservedDropCount: 0,
  });

  assert.equal(staleWallCert.sufficient, false);
  assert.ok(staleWallCert.blockers.includes('WALL_AGE_EXCEEDS_FRESHNESS_LIMIT'));

  // 4. Excessive slot lag (> 12 slots) -> SLOT_LAG_EXCESSIVE
  const excessiveSlotLagCert = engine.evaluateObservationQuality({
    observationCount: 10,
    historySpanSeconds: 30,
    slotLag: 15,
    wallAgeMs: 50,
    maxObservedGapSeconds: 5,
    sourceCount: 2,
    sourcesInAgreement: 2,
    unobservedDropCount: 0,
  });

  assert.equal(excessiveSlotLagCert.sufficient, false);
  assert.ok(excessiveSlotLagCert.blockers.includes('SLOT_LAG_EXCESSIVE'));

  // 5. Large observation gap (> 60s) -> OBSERVATION_GAP_EXCEEDS_60S
  const largeGapCert = engine.evaluateObservationQuality({
    observationCount: 10,
    historySpanSeconds: 120,
    slotLag: 1,
    wallAgeMs: 50,
    maxObservedGapSeconds: 75,
    sourceCount: 2,
    sourcesInAgreement: 2,
    unobservedDropCount: 0,
  });

  assert.equal(largeGapCert.sufficient, false);
  assert.ok(largeGapCert.blockers.includes('OBSERVATION_GAP_EXCEEDS_60S'));

  // 6. Future leakage (negative wall age or slot lag) -> FUTURE_LEAKAGE_DETECTED
  const futureLeakCert = engine.evaluateObservationQuality({
    observationCount: 10,
    historySpanSeconds: 30,
    slotLag: 1,
    wallAgeMs: -100,
    maxObservedGapSeconds: 5,
    sourceCount: 2,
    sourcesInAgreement: 2,
    unobservedDropCount: 0,
  });

  assert.equal(futureLeakCert.sufficient, false);
  assert.ok(futureLeakCert.blockers.some((b) => b.includes('FUTURE_LEAKAGE_DETECTED')));

  // 7. Multi-source disagreement (< 60% agreement) -> CROSS_SOURCE_DISAGREEMENT
  const disagreeCert = engine.evaluateObservationQuality({
    observationCount: 10,
    historySpanSeconds: 30,
    slotLag: 1,
    wallAgeMs: 50,
    maxObservedGapSeconds: 5,
    sourceCount: 4,
    sourcesInAgreement: 1, // 25% < 60%
    unobservedDropCount: 0,
  });

  assert.equal(disagreeCert.sufficient, false);
  assert.ok(disagreeCert.blockers.includes('CROSS_SOURCE_DISAGREEMENT'));
});

test('Pass 41: Sensor Race Multi-Feed Arbitration & Latency Dynamics (Section VIII & Study MULTI-FEED-RACE-X)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Multi-feed arrivals with clear winner and negligible price divergence
  const arrivals = [
    {
      sensorId: 'Jito-Shred-Fast',
      mint: 'MintSensorRace111111111111111111111111111',
      arrivalTimestampMs: 1000,
      reportedSlot: 510000n,
      priceSol: 0.000100,
      quoteReservesLamports: 50_000_000_000n,
    },
    {
      sensorId: 'PumpPortal-Ws',
      mint: 'MintSensorRace111111111111111111111111111',
      arrivalTimestampMs: 1045,
      reportedSlot: 510000n,
      priceSol: 0.000101, // 1% divergence (100 bps)
      quoteReservesLamports: 50_000_000_000n,
    },
    {
      sensorId: 'Helius-Geyser',
      mint: 'MintSensorRace111111111111111111111111111',
      arrivalTimestampMs: 1070,
      reportedSlot: 510000n,
      priceSol: 0.000100,
      quoteReservesLamports: 50_000_000_000n,
    },
  ];

  const raceResult = engine.evaluateSensorRace(arrivals);
  assert.ok(raceResult, 'Race result must not be null');
  assert.equal(raceResult.winnerSensorId, 'Jito-Shred-Fast');
  assert.equal(raceResult.arrivalLeadMs, 45, 'Lead must be 45ms over second fastest sensor');
  assert.equal(raceResult.maxSensorDivergenceBps, 100);
  assert.equal(raceResult.consensusPriceSol, 0.000100);
  assert.equal(raceResult.hasSignificantDivergence, false, '100 bps divergence <= 150 bps threshold');
  assert.equal(raceResult.participatingSensors.length, 3);

  // 2. Severe price divergence between sensors (> 150 bps)
  const divergentArrivals = [
    {
      sensorId: 'Sensor-A',
      mint: 'MintSensorRace111111111111111111111111111',
      arrivalTimestampMs: 1000,
      reportedSlot: 510000n,
      priceSol: 0.000100,
      quoteReservesLamports: 50_000_000_000n,
    },
    {
      sensorId: 'Sensor-B',
      mint: 'MintSensorRace111111111111111111111111111',
      arrivalTimestampMs: 1020,
      reportedSlot: 510000n,
      priceSol: 0.000103, // 300 bps divergence
      quoteReservesLamports: 50_000_000_000n,
    },
  ];

  const divergentResult = engine.evaluateSensorRace(divergentArrivals);
  assert.ok(divergentResult);
  assert.equal(divergentResult.maxSensorDivergenceBps, 300);
  assert.equal(divergentResult.hasSignificantDivergence, true, '300 bps divergence > 150 bps threshold');
});

test('Pass 41: Decision Kernel Gating & Fail-Closed Protection Under Observation Defects', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_800_000;
  const canonicalEvent = {
    eventId: 'evt_pass41_obs_001',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenObsGate111111111111111111111111111111',
    signature: '5obs_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 38010,
    slot: 510_000,
    parentSlot: 509_999,
    blockhash: 'BhashPass41Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'OBSQ',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const defaultWallets = [
    { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
    { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
    { address: 'w3', solFundedAmount: 4.5, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.5 },
    { address: 'w4', solFundedAmount: 7.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 6.0 },
  ];

  // Case 1: Sufficient observation quality -> normal pipeline execution
  const validResult = await engine.processEvent(canonicalEvent, {
    tokenAgeSec: 25.0,
    marketCapSol: 130.0,
    liquiditySol: 65.0,
    txCount: 40,
    rawWallets: defaultWallets,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
    enforceObservationQualityGating: true,
  });

  assert.ok(validResult.observationQuality);
  assert.equal(validResult.observationQuality.sufficient, true);
  assert.equal(validResult.viewModel.isObservationQualitySufficient, true);

  // Case 2: Insufficient observation quality (stale wall age > 5000ms) -> fail-closed CHALLENGED_ABSTAIN
  const staleObsResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass41_stale_002', signature: 'sig_stale_002' },
    {
      tokenAgeSec: 25.0,
      marketCapSol: 130.0,
      liquiditySol: 65.0,
      txCount: 40,
      rawWallets: defaultWallets,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 10,
      observationQualityInputs: {
        observationCount: 10,
        historySpanSeconds: 30,
        slotLag: 1,
        wallAgeMs: 8000, // Stale!
        maxObservedGapSeconds: 5,
        sourceCount: 2,
        sourcesInAgreement: 2,
        unobservedDropCount: 0,
      },
      enforceObservationQualityGating: true,
    }
  );

  assert.equal(staleObsResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(staleObsResult.whyExecutionBlocked?.includes('BLOCKED — OBSERVATION QUALITY INSUFFICIENT'));
  assert.equal(staleObsResult.observationQuality?.sufficient, false);
  assert.equal(staleObsResult.viewModel.isObservationQualitySufficient, false);

  // Case 3: Significant sensor divergence (> 150 bps) -> fail-closed CHALLENGED_ABSTAIN
  const divergentSensorResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass41_div_003', signature: 'sig_div_003' },
    {
      tokenAgeSec: 25.0,
      marketCapSol: 130.0,
      liquiditySol: 65.0,
      txCount: 40,
      rawWallets: defaultWallets,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 10,
      sensorArrivals: [
        {
          sensorId: 'Feed-Primary',
          mint: canonicalEvent.mint,
          arrivalTimestampMs: eventTime,
          reportedSlot: 510000n,
          priceSol: 0.000050,
          quoteReservesLamports: 50_000_000_000n,
        },
        {
          sensorId: 'Feed-Secondary',
          mint: canonicalEvent.mint,
          arrivalTimestampMs: eventTime + 15,
          reportedSlot: 510000n,
          priceSol: 0.000052, // 400 bps divergence > 150 bps
          quoteReservesLamports: 50_000_000_000n,
        },
      ],
      enforceSensorDivergenceGating: true,
    }
  );

  assert.equal(divergentSensorResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(divergentSensorResult.whyExecutionBlocked?.includes('BLOCKED — SENSOR FEED DIVERGENCE EXCESSIVE'));
  assert.equal(divergentSensorResult.sensorRace?.hasSignificantDivergence, true);
});

test('Pass 41: ViewModel and Telemetry Strip Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_800_000;
  const canonicalEvent = {
    eventId: 'evt_pass41_telem_test',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenObsTelem11111111111111111111111111111',
    signature: '5obs_sig_telem',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 38010,
    slot: 510_000,
    parentSlot: 509_999,
    blockhash: 'BhashPass41Telem',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'OBSQ',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const defaultWallets = [
    { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
  ];

  const result = await engine.processEvent(canonicalEvent, {
    tokenAgeSec: 25.0,
    marketCapSol: 130.0,
    liquiditySol: 65.0,
    txCount: 40,
    rawWallets: defaultWallets,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 15,
    sensorArrivals: [
      {
        sensorId: 'Jito-Shred-Fast',
        mint: canonicalEvent.mint,
        arrivalTimestampMs: eventTime,
        reportedSlot: 510000n,
        priceSol: 0.000050,
        quoteReservesLamports: 50_000_000_000n,
      },
      {
        sensorId: 'PumpPortal-Ws',
        mint: canonicalEvent.mint,
        arrivalTimestampMs: eventTime + 30,
        reportedSlot: 510000n,
        priceSol: 0.000050,
        quoteReservesLamports: 50_000_000_000n,
      },
    ],
  });

  const vm = result.viewModel;
  assert.ok(vm.observationQuality, 'observationQuality must be present on viewModel');
  assert.equal(typeof vm.isObservationQualitySufficient, 'boolean');
  assert.equal(vm.isObservationQualitySufficient, true);
  assert.ok(vm.sensorRace, 'sensorRace must be present on viewModel');
  assert.equal(vm.sensorRaceWinner, 'Jito-Shred-Fast');
  assert.equal(vm.sensorRace.arrivalLeadMs, 30);
  assert.equal(vm.sensorRace.hasSignificantDivergence, false);

  assert.ok(result.observationQuality);
  assert.ok(result.sensorRace);
});
