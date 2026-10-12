import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 43: Liquidation Hypergraph Engine & Multi-Hop Venue Routing (Section XIV & Study 28)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Direct route only (no secondary liquidity)
  const singleVenueHypergraph = engine.buildLiquidationHypergraph({
    primaryPoolLiquidityUsd: 10_000,
    secondaryRoutesLiquidityUsd: 0,
    primaryVenueName: 'PumpFun_Direct',
  });

  assert.equal(singleVenueHypergraph.primaryVenue, 'PumpFun_Direct');
  assert.equal(singleVenueHypergraph.availableRoutes.length, 1);
  assert.equal(singleVenueHypergraph.aggregateExitCapacityUsd, 1500); // 15% of 10k
  assert.equal(singleVenueHypergraph.singlePointOfFailureVenue, 'PumpFun_Direct', 'Must detect SPOF when 100% capacity is on single venue');
  assert.equal(singleVenueHypergraph.venueOutageImpactRatio, 1.0);

  // Multi-venue routing with secondary liquidity aggregator
  const multiVenueHypergraph = engine.buildLiquidationHypergraph({
    primaryPoolLiquidityUsd: 10_000,
    secondaryRoutesLiquidityUsd: 15_000,
    primaryVenueName: 'Raydium_CPMM',
  });

  assert.equal(multiVenueHypergraph.availableRoutes.length, 2);
  const secondary = multiVenueHypergraph.availableRoutes.find(r => r.venue === 'Jupiter_Aggregator');
  assert.ok(secondary);
  assert.equal(secondary.hopCount, 2);
  assert.equal(secondary.maxCapacityUsd, 1500); // 10% of 15k
  assert.equal(multiVenueHypergraph.aggregateExitCapacityUsd, 3000); // 1500 + 1500
  assert.equal(multiVenueHypergraph.venueOutageImpactRatio, 0.5);
  assert.equal(multiVenueHypergraph.singlePointOfFailureVenue, undefined, 'No SPOF when primary share is <= 85%');
});

test('Pass 43: Portfolio Capacity Engine & Open Exposure Ceilings (Section XXVI & Study 34)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Healthy capacity
  const healthy = engine.checkPortfolioCapacity({
    currentAvailableCashUsd: 5000.0,
    activePositionCount: 2,
    maxConcurrentPositions: 5,
    candidateStakeUsd: 250.0,
    minimumCashBufferUsd: 1000.0,
  });

  assert.equal(healthy.canOpenNewPosition, true);
  assert.equal(healthy.remainingPositionSlots, 3);
  assert.equal(healthy.allocatedCapitalUsd, 500.0);
  assert.equal(healthy.availableUnallocatedCashUsd, 4000.0);
  assert.equal(healthy.blockerReason, undefined);

  // Case 2: Position count at ceiling
  const ceiling = engine.checkPortfolioCapacity({
    currentAvailableCashUsd: 5000.0,
    activePositionCount: 5,
    maxConcurrentPositions: 5,
    candidateStakeUsd: 250.0,
    minimumCashBufferUsd: 1000.0,
  });

  assert.equal(ceiling.canOpenNewPosition, false);
  assert.equal(ceiling.remainingPositionSlots, 0);
  assert.ok(ceiling.blockerReason?.includes('CAPACITY_LIMIT_REACHED'));

  // Case 3: Insufficient cash buffer below minimum reserve
  const lowCash = engine.checkPortfolioCapacity({
    currentAvailableCashUsd: 1100.0,
    activePositionCount: 1,
    maxConcurrentPositions: 5,
    candidateStakeUsd: 250.0,
    minimumCashBufferUsd: 1000.0, // only $100 usable < $250 required
  });

  assert.equal(lowCash.canOpenNewPosition, false);
  assert.equal(lowCash.remainingPositionSlots, 4);
  assert.ok(lowCash.blockerReason?.includes('INSUFFICIENT_CASH_BUFFER'));
});

test('Pass 43: Decision Kernel Gating & Fail-Closed Protection Under Portfolio Capacity Exhaustion and Hypergraph Liquidity Deficit', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_900_000;
  const canonicalEvent = {
    eventId: 'evt_pass43_gate_001',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenHyperGate11111111111111111111111111111',
    signature: '5hyper_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 39010,
    slot: 520_000,
    parentSlot: 519_999,
    blockhash: 'BhashPass43Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'HYPER',
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

  // Case 1: Adequate portfolio capacity and hypergraph liquidity -> normal execution
  const adequateResult = await engine.processEvent(canonicalEvent, {
    tokenAgeSec: 25.0,
    marketCapSol: 130.0,
    liquiditySol: 65.0,
    txCount: 40,
    rawWallets: defaultWallets,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
    enforcePortfolioCapacityGating: true,
    enforceHypergraphGating: true,
  });

  assert.ok(adequateResult.portfolioCapacity);
  assert.ok(adequateResult.liquidationHypergraph);
  assert.equal(adequateResult.viewModel.canOpenNewPosition, true);

  // Case 2: Portfolio capacity exhausted (5 active positions) -> fail-closed SAFETY_LOCKED
  const exhaustedCapacityResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass43_exhaust_002', signature: 'sig_exhaust_002' },
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
      activePositionCount: 5,
      maxConcurrentPositions: 5,
      enforcePortfolioCapacityGating: true,
    }
  );

  assert.equal(exhaustedCapacityResult.decision, 'SAFETY_LOCKED');
  assert.ok(exhaustedCapacityResult.whyExecutionBlocked?.includes('BLOCKED — PORTFOLIO CAPACITY EXHAUSTED'));
  assert.equal(exhaustedCapacityResult.viewModel.canOpenNewPosition, false);

  // Case 3: Insufficient hypergraph exit capacity -> fail-closed CHALLENGED_ABSTAIN
  const shallowHypergraphResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass43_shallow_003', signature: 'sig_shallow_003' },
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
      liquidationHypergraph: {
        primaryVenue: 'PumpFun',
        availableRoutes: [],
        aggregateExitCapacityUsd: 20.0, // Insufficient for stake
        venueOutageImpactRatio: 1.0,
        singlePointOfFailureVenue: 'PumpFun',
      },
      requiredStakeUsd: 100.0,
      enforceHypergraphGating: true,
    }
  );

  assert.equal(shallowHypergraphResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(shallowHypergraphResult.whyExecutionBlocked?.includes('BLOCKED — INSUFFICIENT HYPERGRAPH EXIT CAPACITY'));
});

test('Pass 43: ViewModel and Telemetry Strip Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_900_000;
  const canonicalEvent = {
    eventId: 'evt_pass43_telem_test',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenHyperTelem1111111111111111111111111111',
    signature: '5hyper_sig_telem',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 39010,
    slot: 520_000,
    parentSlot: 519_999,
    blockhash: 'BhashPass43Telem',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'HTLM',
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
    poolOpsPerSec: 10,
  });

  const vm = result.viewModel;
  assert.ok(vm.portfolioCapacity, 'portfolioCapacity must be projected into ViewModel');
  assert.ok(vm.liquidationHypergraph, 'liquidationHypergraph must be projected into ViewModel');
  assert.equal(typeof vm.canOpenNewPosition, 'boolean');
  assert.equal(typeof vm.hypergraphExitCapacityUsd, 'number');
  assert.ok(vm.hypergraphExitCapacityUsd > 0);
  assert.ok(result.portfolioCapacity);
  assert.ok(result.liquidationHypergraph);
});
