import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DependencyImpactGraph,
} from '../../dist/intelligence/graph/dependency-impact-graph.js';

import {
  PairResolver,
  PriceAuthority,
  SupplyAuthority,
  MCAPAuthority,
  TokenCapabilityEngine,
} from '../../dist/intelligence/lifecycle/venue-resolver.js';

import {
  ProtectionLeaseManager,
  GhostTownEngine,
  AuditLifecycleTracker,
} from '../../dist/intelligence/lifecycle/protection-lease.js';

import {
  CanonicalTokenStore,
} from '../../dist/intelligence/truth/canonical-store.js';

test('Dependency & Impact Graph: Failure propagation affects downstream signals and policies', () => {
  const graph = new DependencyImpactGraph();

  // Test failure of DexScreener
  const affected = graph.propagateFailure('src_dexscreener', 'FAILED');

  assert.ok(affected.includes('src_dexscreener'));
  assert.ok(affected.includes('fact_price'));
  assert.ok(affected.includes('fact_liquidity'));
  assert.ok(affected.includes('sig_hsi'));
  assert.ok(affected.includes('pol_protection'));

  const surface = graph.getImpactSurface('src_solana_rpc');
  assert.ok(surface.affectedSignals.includes('sig_hsi'));
  assert.ok(surface.affectedPolicies.includes('pol_protection'));
  assert.ok(surface.affectedUI.includes('ui_inspector'));
});

test('Venue Resolver: Selects dominant pool without last-write-wins overwrite and computes executable liquidity', () => {
  const resolver = new PairResolver();
  const mint = 'MintVenue11111111111111111111111111111111';

  // Pool 1: Small Raydium pool (5 SOL)
  resolver.recordPool({
    poolId: 'pool_raydium_1',
    venueId: 'RAYDIUM',
    mint,
    baseReserves: 1000000n,
    quoteReservesSol: 5.0,
    spotPriceSol: 0.001,
    isPrimary: false,
    lastSeenMs: Date.now() - 5000,
  });

  // Pool 2: Main Meteora pool (65 SOL)
  const resolved = resolver.recordPool({
    poolId: 'pool_meteora_1',
    venueId: 'METEORA',
    mint,
    baseReserves: 8000000n,
    quoteReservesSol: 65.0,
    spotPriceSol: 0.0011,
    isPrimary: true,
    lastSeenMs: Date.now(),
  });

  assert.equal(resolved.dominantVenue, 'METEORA');
  assert.equal(resolved.primaryPool?.poolId, 'pool_meteora_1');
  assert.equal(resolved.aggregateLiquiditySol, 70.0);
  assert.equal(resolved.executableLiquiditySol, 65.0 * 0.90);
  assert.equal(resolved.lifecycle, 'MULTI_VENUE');
});

test('Price, Supply, and MCAP Authorities produce single coherent numerical truth', () => {
  const priceAuth = new PriceAuthority();
  const supplyAuth = new SupplyAuthority();
  const mcapAuth = new MCAPAuthority(priceAuth, supplyAuth);

  const mint = 'MintPrice1111111111111111111111111111111111';
  supplyAuth.setSupply(mint, 1_000_000_000n * 1_000_000n); // 1 Billion tokens

  priceAuth.updatePrice({
    mint,
    priceSol: 0.00005,
    solUsdPrice: 200,
    source: 'authoritative_feed',
  });

  const mcap = mcapAuth.calculateMCAP(mint, 200);
  assert.equal(mcap.mcapSol, 50000); // 1B * 0.00005
  assert.equal(mcap.mcapUsd, 10000000); // 50,000 * $200 = $10M
});

test('Token Capabilities Engine: Decodes transfer fees and freeze authority', () => {
  const engine = new TokenCapabilityEngine();

  const clean = engine.decodeCapabilities({
    mint: 'CleanMint111111111111111111111111111111111111',
    freezeAuthority: null,
    permanentDelegate: null,
    transferFeeBps: 0,
  });
  assert.equal(clean.isBackdoorFree, true);

  const backdoor = engine.decodeCapabilities({
    mint: 'HoneypotMint11111111111111111111111111111111',
    freezeAuthority: 'AttackerKey11111111111111111111111111111111',
    transferFeeBps: 2500, // 25% fee
  });
  assert.equal(backdoor.isBackdoorFree, false);
  assert.equal(backdoor.hasFreezeAuthority, true);
  assert.equal(backdoor.transferFeeBps, 2500);
});

test('Protection Lease: Renews when prerequisites met and expires without fresh evidence', () => {
  const leaseManager = new ProtectionLeaseManager();
  const mint = 'MintLease11111111111111111111111111111111111';
  const now = 1789770000000;

  // Active lease
  const lease1 = leaseManager.requestLease({
    mint,
    isSafe1: true,
    podState: 'P',
    hsiScore: 65,
    pumpScore: 55,
    evidenceQuality: 0.90,
    evidenceIds: ['evi_1', 'evi_2'],
    now,
  });
  assert.equal(lease1.state, 'ACTIVE');

  // Advance time beyond validUntil (300s)
  const evaluated = leaseManager.evaluateLease(mint, now + 400_000);
  assert.equal(evaluated?.state, 'EXPIRED');

  // Dangerous PoD=D demotes to REVIEW immediately
  const lease2 = leaseManager.requestLease({
    mint,
    isSafe1: true,
    podState: 'D',
    hsiScore: 65,
    pumpScore: 55,
    evidenceQuality: 0.90,
    evidenceIds: ['evi_3'],
    now,
  });
  assert.equal(lease2.state, 'REVIEW');
});

test('Ghost-Town Engine: Distinguishes DEX observability failure from actual token inactivity', () => {
  const ghostEngine = new GhostTownEngine();
  const mint = 'MintGhost11111111111111111111111111111111111';
  const now = Date.now();

  // Case 1: DEX feed is degraded (outage) -> must NOT declare ghost-town
  const outageStatus = ghostEngine.recordAppearance({
    mint,
    isDexHealthy: false,
    isTokenActiveOnDex: false,
    lastDexSeenMs: now - 600_000,
    now,
  });
  assert.equal(outageStatus.isGhostTown, false);
  assert.equal(outageStatus.isObservabilityFailure, true);

  // Case 2: DEX feed is healthy, but token has 0 activity for 10 minutes -> Genuine Ghost-Town
  const ghostStatus = ghostEngine.recordAppearance({
    mint,
    isDexHealthy: true,
    isTokenActiveOnDex: false,
    lastDexSeenMs: now - 600_000,
    now,
  });
  assert.equal(ghostStatus.isGhostTown, true);
  assert.equal(ghostStatus.isObservabilityFailure, false);
});

test('Audit Lifecycle Tracker: Correctly records Audit 3 Solar Core and Audit 12 Diamond Core', () => {
  const store = new CanonicalTokenStore();
  const tracker = new AuditLifecycleTracker();
  const mint = 'MintAudit11111111111111111111111111111111111';

  store.registerToken({
    mint,
    symbol: 'AUDIT',
    name: 'Audit Token',
    creatorAddress: 'CreatorAudit111111111111111111111111111111',
    initialLiquiditySol: 55.0,
  });

  // Run audits 1 to 2
  store.commitTransaction({
    transactionId: 'tx_a1',
    mint,
    mutation: () => ({ hsi: 50, auditCount: 1 }),
    reason: 'Audit 1',
    timestampMs: Date.now(),
  });
  tracker.recordAudit(store.get(mint));

  store.commitTransaction({
    transactionId: 'tx_a2',
    mint,
    mutation: () => ({ hsi: 55, auditCount: 2 }),
    reason: 'Audit 2',
    timestampMs: Date.now(),
  });
  tracker.recordAudit(store.get(mint));

  // Audit 3: Should hit Solar Core
  store.commitTransaction({
    transactionId: 'tx_a3',
    mint,
    mutation: () => ({ hsi: 60, auditCount: 3, isSolarCore: true }),
    reason: 'Audit 3 Solar Core',
    timestampMs: Date.now(),
  });
  const res3 = tracker.recordAudit(store.get(mint));
  assert.equal(res3.auditNumber, 3);
  assert.equal(res3.isSolarCore, true);
  assert.equal(res3.snapshot.coreLevel, 'SOLAR_CORE');
  assert.equal(res3.trajectory, 'IMPROVING');

  // Simulate reaching Audit 12 with Diamond Core criteria
  for (let i = 4; i <= 11; i++) {
    tracker.recordAudit(store.get(mint));
  }
  store.commitTransaction({
    transactionId: 'tx_a12',
    mint,
    mutation: () => ({ hsi: 75, auditCount: 12, isDiamondCore: true, realLiquiditySol: 60.0 }),
    reason: 'Audit 12 Diamond Core',
    timestampMs: Date.now(),
  });
  const res12 = tracker.recordAudit(store.get(mint));
  assert.equal(res12.auditNumber, 12);
  assert.equal(res12.isDiamondCore, true);
  assert.equal(res12.snapshot.coreLevel, 'DIAMOND_CORE');
});
