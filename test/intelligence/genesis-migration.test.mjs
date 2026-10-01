import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GenesisMigrationEngine } from '../../dist/intelligence/capital/genesis-migration.js';

test('GenesisMigrationEngine: Successfully migrates valid legacy state and issues certificate', () => {
  const legacyState = {
    version: 1,
    wallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    mode: 'paper',
    cash: '50000000000', // 50 SOL in lamports
    day: '2026-09-30',
    dayPnl: '0',
    closed: {},
    halted: false,
    pending: null,
    positions: {
      'PumpTokenAAA111111111111111111111111111111111': {
        mint: 'PumpTokenAAA111111111111111111111111111111111',
        creator: 'Creator111111111111111111111111111111111111',
        tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        qty: '1000000000',
        initialQty: '1000000000',
        cost: '2000000000', // 2 SOL
        originalCost: '2000000000',
        peak: '2500000000',
        stage: 1,
        opened: 1727700000,
        reserve: '30000000000',
        panic: false,
        creatorTokens: '0',
        entrySlot: 250000,
      },
      'PumpTokenBBB222222222222222222222222222222222': {
        mint: 'PumpTokenBBB222222222222222222222222222222222',
        creator: 'Creator222222222222222222222222222222222222',
        tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        qty: '500000000',
        initialQty: '500000000',
        cost: '1000000000', // 1 SOL
        originalCost: '1000000000',
        peak: '1200000000',
        stage: 0,
        opened: 1727701000,
        reserve: '30000000000',
        panic: false,
        creatorTokens: '0',
        entrySlot: 250100,
      },
    },
  };

  const { store, certificate } = GenesisMigrationEngine.migrate(legacyState);

  assert.equal(certificate.status, 'MIGRATION_SUCCESS');
  assert.equal(certificate.migratedCashLamports, 50_000_000_000n);
  assert.equal(certificate.positionsMigratedCount, 2);
  assert.equal(certificate.totalPositionBasisLamports, 3_000_000_000n);
  assert.equal(certificate.certificateHash.length, 64);

  // Store assertions
  // Base 50 SOL - (2 SOL + 1 SOL settled fills) = 47 SOL confirmed cash
  assert.equal(store.getConfirmedCash(), 47_000_000_000n);
  assert.equal(store.getTokenInventory('PumpTokenAAA111111111111111111111111111111111'), 1_000_000_000n);
  assert.equal(store.getTokenInventory('PumpTokenBBB222222222222222222222222222222222'), 500_000_000n);

  const lotsA = store.getActiveLots('PumpTokenAAA111111111111111111111111111111111');
  assert.equal(lotsA.length, 1);
  assert.equal(lotsA[0].remainingBasisLamports, 2_000_000_000n);

  const conservation = store.verifyConservation();
  assert.equal(conservation.isValid, true);
});

test('GenesisMigrationEngine: Rejects invalid or corrupt legacy state', () => {
  // 1. Missing or non-string cash
  assert.throws(
    () => GenesisMigrationEngine.migrate({ cash: null, positions: {} }),
    /GENESIS_MIGRATION_FAILED/
  );

  // 2. Negative cash
  assert.throws(
    () => GenesisMigrationEngine.migrate({ cash: '-100', positions: {} }),
    /NEGATIVE_CASH_BALANCE/
  );

  // 3. Negative cost basis in position
  assert.throws(
    () =>
      GenesisMigrationEngine.migrate({
        cash: '1000000000',
        positions: {
          bad_mint: {
            mint: 'bad_mint',
            qty: '100',
            cost: '-500',
          },
        },
      }),
    /Negative cost basis/
  );
});
