import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TailLatticeEngine,
  MultiStateRunnerEngine,
  NearMissEngine,
  HistoricalTransportEngine,
} from '../../dist/intelligence/science/multiplier-x.js';

test('TailLatticeEngine: enforces mathematical monotonicity across barriers, horizons, and capturability', () => {
  // Raw unconstrained probabilities violating monotonicity (e.g. P100 > P50)
  const unconstrained = {
    p2x: 0.60,
    p5x: 0.70, // Inverted!
    p10x: 0.40,
    p20x: 0.50, // Inverted!
    p50x: 0.20,
    p100x: 0.25, // Inverted!
    pCapturable10x: 0.45, // Greater than p10x!
  };

  const lattice = TailLatticeEngine.enforceLatticeMonotonicity(unconstrained);

  // Invariant 1: P100 <= P50 <= P20 <= P10 <= P5 <= P2
  assert.equal(lattice.p2x, 0.60);
  assert.equal(lattice.p5x <= lattice.p2x, true);
  assert.equal(lattice.p10x <= lattice.p5x, true);
  assert.equal(lattice.p20x <= lattice.p10x, true);
  assert.equal(lattice.p50x <= lattice.p20x, true);
  assert.equal(lattice.p100x <= lattice.p50x, true);

  // Invariant 2: P(Capturable N) <= P(Observed N)
  assert.equal(lattice.pCapturable10x, 0.4);
  assert.equal(lattice.pCapturable100x, null);

  // Horizon monotonicity: P(30s) <= P(1m) <= ... <= P(24h)
  const horizons = TailLatticeEngine.enforceHorizonMonotonicity({
    '30s': 0.50,
    '1m': 0.40, // Inverted!
    '5m': 0.65,
    '15m': 0.60, // Inverted!
    '1h': 0.75,
    '6h': 0.70, // Inverted!
    '24h': 0.85,
  });

  assert.equal(horizons['30s'] <= horizons['1m'], true);
  assert.equal(horizons['1m'] <= horizons['5m'], true);
  assert.equal(horizons['5m'] <= horizons['15m'], true);
  assert.equal(horizons['15m'] <= horizons['1h'], true);
  assert.equal(horizons['1h'] <= horizons['6h'], true);
  assert.equal(horizons['6h'] <= horizons['24h'], true);
});

test('MultiStateRunnerEngine: evaluates semi-Markov runner state and validates first-passage path', () => {
  // Healthy runner path
  const healthy = MultiStateRunnerEngine.evaluateRunner({
    currentMultiplier: 5.5,
    effectiveBuyers: 15,
    sellHazard: 0.2,
    liquidityDepthSol: 50,
    mfePct: 450,
    maePct: -12, // healthy shallow pullback
  });

  assert.equal(healthy.currentState, 'S2_5X');
  assert.equal(healthy.pFirstPassageValid, false);
  assert.equal(healthy.firstPassageAuthority, 'NOT_ESTIMATED_RESEARCH_ONLY');
  assert.equal(healthy.authority, 'RESEARCH_ONLY');
  assert.equal(healthy.pTransitionNext > 0.3, true);
  assert.equal(healthy.netExecutableEv > 0, true);

  // Pathological pump fake: dipped to -45% drawdown before pumping
  const pathological = MultiStateRunnerEngine.evaluateRunner({
    currentMultiplier: 2.0,
    effectiveBuyers: 3,
    sellHazard: 0.8,
    liquidityDepthSol: 5,
    mfePct: 100,
    maePct: -45, // Unacceptable severe drawdown!
  });

  assert.equal(pathological.pFirstPassageValid, false);
});

test('NearMissEngine: issues 100X Bridge Certificate only when structural metrics survive', () => {
  // Scenario 1: Survives bridge (dispersed supply, high replenishment, low defection)
  const cert1 = NearMissEngine.evaluate100xBridge({
    mint: 'mint_moonshot_1',
    currentMultiple: 20,
    top10HolderConcentrationPct: 15, // Low concentration
    liquidityReplenishmentPerMinuteSol: 4.5, // High replenishment
    runnerDefectionRate: 0.04, // Very low defection
  });

  assert.equal(cert1.qualifiesFor100xBridge, true);
  assert.equal(cert1.is100xCertificate, false);
  assert.equal(cert1.authority, 'RESEARCH_ONLY');
  assert.equal(cert1.bridgeScore >= 0.70, true);
  assert.equal(cert1.hash.length, 64);

  // Scenario 2: Near-miss that dies (cabal concentration 38%, no replenishment, high defection)
  const cert2 = NearMissEngine.evaluate100xBridge({
    mint: 'mint_near_miss_2',
    currentMultiple: 20,
    top10HolderConcentrationPct: 38,
    liquidityReplenishmentPerMinuteSol: 0.2,
    runnerDefectionRate: 0.40,
  });

  assert.equal(cert2.qualifiesFor100xBridge, false);
});

test('HistoricalTransportEngine: adapts domain authority and abstains on out-of-support regimes', () => {
  // Live PumpSwap AMM regime -> HIGH_AUTHORITY
  const live = HistoricalTransportEngine.classifyDomain({
    solanaProtocolEpoch: 650,
    pumpProtocolGeneration: 'PUMPSWAP_AMM',
    feeScheduleMatchesLive: true,
  });
  assert.equal(live.authorityLevel, 'UNVERIFIED_RESEARCH_ONLY');
  assert.equal(live.shouldAbstain, false);
  assert.equal(live.weightMultiplier, 0);

  // Unknown obsolete protocol regime -> OUT_OF_SUPPORT & ABSTAIN
  const unknown = HistoricalTransportEngine.classifyDomain({
    solanaProtocolEpoch: 400,
    pumpProtocolGeneration: 'UNKNOWN',
    feeScheduleMatchesLive: false,
  });
  assert.equal(unknown.authorityLevel, 'OUT_OF_SUPPORT');
  assert.equal(unknown.shouldAbstain, true);
  assert.equal(unknown.weightMultiplier, 0.0);
});
