import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TokenLifecycleOmegaAuthority
} from '../../dist/platform/lifecycle/token-lifecycle-omega.js';

describe('LIFECYCLE-Ω: Canonical Pump/PumpSwap Token Lifecycle Authority (Upgrade 2)', () => {
  it('progresses through evidence-driven lifecycle from bonding curve to active AMM', () => {
    const authority = new TokenLifecycleOmegaAuthority();
    const mint = 'TokenLifecycleTest111111111111111111111111';

    // 1. Initial discovery
    const c1 = authority.transitionLifecycle(mint, {
      evidenceId: 'EV-1',
      slot: 289450000,
      timestampMs: Date.now(),
      source: 'ON_CHAIN_PROGRAM',
      details: 'Token mint discovered'
    });
    assert.equal(c1.currentState, 'DISCOVERED');
    assert.equal(c1.isTradingAllowed, false);

    // 2. Active bonding curve
    const c2 = authority.transitionLifecycle(mint, {
      evidenceId: 'EV-2',
      slot: 289450010,
      timestampMs: Date.now(),
      source: 'RPC_STATE',
      virtualSolReserves: 30_000_000_000n, // 30 SOL
      virtualTokenReserves: 1_000_000_000n,
      details: 'Active curve trading'
    });
    assert.equal(c2.currentState, 'BONDING_ACTIVE');
    assert.equal(c2.valuationStatus, 'PRICED_BONDING_CURVE');
    assert.equal(c2.isTradingAllowed, true);

    // 3. Near completion (>= 80 SOL)
    const c3 = authority.transitionLifecycle(mint, {
      evidenceId: 'EV-3',
      slot: 289450100,
      timestampMs: Date.now(),
      source: 'YELLOWSTONE_FEED',
      virtualSolReserves: 82_000_000_000n, // 82 SOL
      details: 'Bonding near completion threshold'
    });
    assert.equal(c3.currentState, 'BONDING_NEAR_COMPLETION');
    assert.equal(c3.valuationStatus, 'PRICED_BONDING_CURVE');
    assert.equal(c3.isTradingAllowed, true);

    // 4. Completion observed (>= 85 SOL)
    const c4 = authority.transitionLifecycle(mint, {
      evidenceId: 'EV-4',
      slot: 289450150,
      timestampMs: Date.now(),
      source: 'YELLOWSTONE_FEED',
      virtualSolReserves: 85_500_000_000n,
      details: 'Curve 100% completed'
    });
    assert.equal(c4.currentState, 'COMPLETION_OBSERVED');
    // Invariant: Completed curve is UNPRICED, NEVER 0!
    assert.equal(c4.valuationStatus, 'UNPRICED_MIGRATING');
    assert.equal(c4.isTradingAllowed, false); // New entries blocked
    assert.equal(c4.isHoldingPreserved, true); // Holdings protected from false-zero panic stops

    // 4b. Sits complete unmigrated
    const c4b = authority.transitionLifecycle(mint, {
      evidenceId: 'EV-4b',
      slot: 289450155,
      timestampMs: Date.now(),
      source: 'RPC_STATE',
      details: 'No migration pool yet'
    });
    assert.equal(c4b.currentState, 'COMPLETE_UNMIGRATED');
    assert.equal(c4b.valuationStatus, 'UNPRICED_MIGRATING');

    // 5. Migration observed with transaction signature
    const c5 = authority.transitionLifecycle(mint, {
      evidenceId: 'EV-5',
      slot: 289450160,
      timestampMs: Date.now(),
      source: 'ON_CHAIN_PROGRAM',
      transactionSignature: '5MigrateTxSignature11111111111111111111111111111111111111111111111111111111111111',
      details: 'Raydium/PumpSwap migration tx broadcast'
    });
    assert.equal(c5.currentState, 'MIGRATION_OBSERVED');
    assert.equal(c5.isHoldingPreserved, true);

    // 6. Destination pool verifying
    const c6 = authority.transitionLifecycle(mint, {
      evidenceId: 'EV-6',
      slot: 289450170,
      timestampMs: Date.now(),
      source: 'DEX_OBSERVER',
      destinationPoolAddress: 'PoolAddressPumpSwap11111111111111111111111111111',
      details: 'Destination pool detected on-chain'
    });
    assert.equal(c6.currentState, 'DESTINATION_POOL_VERIFYING');

    // 7. Canonical verification of pool and AMM active
    const c7 = authority.transitionLifecycle(mint, {
      evidenceId: 'EV-7',
      slot: 289450180,
      timestampMs: Date.now(),
      source: 'ON_CHAIN_PROGRAM',
      destinationPoolAddress: 'PoolAddressPumpSwap11111111111111111111111111111',
      migrationProgramId: 'pumpswap_program_id_verified',
      details: 'PumpSwap AMM open for live swaps'
    });
    assert.equal(c7.currentState, 'CANONICAL_PUMPSWAP_VERIFIED');

    const c8 = authority.transitionLifecycle(mint, {
      evidenceId: 'EV-8',
      slot: 289450190,
      timestampMs: Date.now(),
      source: 'DEX_OBSERVER',
      details: 'Two-way liquidity verified on AMM'
    });
    assert.equal(c8.currentState, 'AMM_ACTIVE');
    assert.equal(c8.valuationStatus, 'PRICED_AMM');
    assert.equal(c8.isTradingAllowed, true);
    assert.equal(c8.isHoldingPreserved, true);
  });

  it('protects open positions during curve graduation: no false-zero stopouts', () => {
    const authority = new TokenLifecycleOmegaAuthority();
    const mint = 'TokenOpenPositionGraduation111111111111111';

    // Set to COMPLETE_UNMIGRATED
    const cert = authority.transitionLifecycle(mint, {
      evidenceId: 'EV-GRAD-1',
      slot: 289450000,
      timestampMs: Date.now(),
      source: 'YELLOWSTONE_FEED',
      details: 'Bonding curve completed while bot was in position'
    }, 'COMPLETE_UNMIGRATED');

    // Invariant check:
    assert.equal(cert.valuationStatus, 'UNPRICED_MIGRATING');
    assert.notEqual(cert.valuationStatus, 'UNPRICED_UNKNOWN');
    assert.equal(cert.isHoldingPreserved, true);
    assert.equal(cert.isTradingAllowed, false);
    assert.ok(cert.unresolvedFacts.some(f => f.includes('destination pool liquidity verification')));
  });
});
