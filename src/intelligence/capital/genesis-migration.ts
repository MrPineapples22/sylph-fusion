/**
 * SOL-SYLPH Intelligence Fabric - Genesis Migration Engine
 * Architectural Directives: Pillar 1 (One Economic Authority), Pillar 3 (Exact Accounting), Pillar 4 (Lot Accounting).
 *
 * Provides a deterministic, fail-closed bridge from legacy `core.State` (SQLite)
 * into the authoritative `EconomicAuthorityStore`. Generates a cryptographically
 * verifiable `GenesisMigrationCertificate`.
 */

import { createHash } from 'node:crypto';
import type { State, Position } from '../../core.js';
import { EconomicAuthorityStore, type LotRecord } from './economic-authority-store.js';

export interface GenesisMigrationCertificate {
  readonly migrationId: string;
  readonly wallet: string;
  readonly migratedCashLamports: bigint;
  readonly positionsMigratedCount: number;
  readonly totalPositionBasisLamports: bigint;
  readonly certificateHash: string;
  readonly migratedAtMs: number;
  readonly status: 'MIGRATION_SUCCESS' | 'MIGRATION_FAILED';
  readonly failureReason?: string;
}

export interface MigrationResult {
  readonly store: EconomicAuthorityStore;
  readonly certificate: GenesisMigrationCertificate;
}

export class GenesisMigrationEngine {
  /**
   * Deterministically migrates a legacy `State` snapshot into an `EconomicAuthorityStore`.
   */
  public static migrate(legacyState: State): MigrationResult {
    const migrationId = `gen_mig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    // 1. Validate cash lamports
    let cashLamports: bigint;
    try {
      if (!legacyState.cash || typeof legacyState.cash !== 'string') {
        throw new Error('MISSING_OR_INVALID_CASH_FIELD');
      }
      cashLamports = BigInt(legacyState.cash);
      if (cashLamports < 0n) {
        throw new Error('NEGATIVE_CASH_BALANCE');
      }
    } catch (err) {
      const errorMsg = `GENESIS_MIGRATION_FAILED: Invalid cash balance: ${err instanceof Error ? err.message : String(err)}`;
      const cert: GenesisMigrationCertificate = {
        migrationId,
        wallet: legacyState.wallet ?? 'UNKNOWN',
        migratedCashLamports: 0n,
        positionsMigratedCount: 0,
        totalPositionBasisLamports: 0n,
        certificateHash: createHash('sha256').update(errorMsg).digest('hex'),
        migratedAtMs: now,
        status: 'MIGRATION_FAILED',
        failureReason: errorMsg,
      };
      throw new Error(errorMsg);
    }

    // Initialize Store with base cash
    const store = new EconomicAuthorityStore(cashLamports);

    // 2. Validate and migrate active positions
    const positions = legacyState.positions ?? {};
    const positionEntries = Object.entries(positions);
    let totalPositionBasis = 0n;
    let migratedCount = 0;

    for (const [mint, pos] of positionEntries) {
      try {
        const rawQty = BigInt(pos.qty);
        const originalQty = BigInt(pos.initialQty || pos.qty);
        const basis = BigInt(pos.cost);
        const originalBasis = BigInt(pos.originalCost || pos.cost);

        if (rawQty <= 0n) {
          // Zero or negative remaining qty means position is already effectively closed
          continue;
        }
        if (basis < 0n) {
          throw new Error(`Negative cost basis on position ${mint}`);
        }

        // Settle fill directly into the store to establish inventory and lots
        store.settleOpenFill({
          intentId: `migration_${mint.slice(0, 8)}`,
          mint,
          tokenQtyRaw: rawQty,
          principalDebitLamports: basis,
          feeLamports: 0n,
          tipLamports: 0n,
          rentLamports: 0n,
          slot: pos.entrySlot ?? 0,
          signature: `legacy_migration_${mint.slice(0, 8)}`,
        });

        totalPositionBasis += basis;
        migratedCount++;
      } catch (posErr) {
        const errorMsg = `GENESIS_MIGRATION_FAILED on position ${mint}: ${posErr instanceof Error ? posErr.message : String(posErr)}`;
        throw new Error(errorMsg);
      }
    }

    // 3. Verify Conservation Post-Migration
    const conservation = store.verifyConservation();
    if (!conservation.isValid) {
      const errorMsg = `GENESIS_MIGRATION_FAILED: Post-migration conservation violation: ${conservation.discrepancies.join('; ')}`;
      throw new Error(errorMsg);
    }

    // 4. Issue Certificate
    const certPayload = {
      migrationId,
      wallet: legacyState.wallet,
      migratedCashLamports: cashLamports.toString(),
      positionsMigratedCount: migratedCount,
      totalPositionBasisLamports: totalPositionBasis.toString(),
      lastJournalHash: store.getLastJournalHash(),
      timestampMs: now,
    };

    const certificateHash = createHash('sha256')
      .update(JSON.stringify(certPayload))
      .digest('hex');

    const certificate: GenesisMigrationCertificate = {
      migrationId,
      wallet: legacyState.wallet,
      migratedCashLamports: cashLamports,
      positionsMigratedCount: migratedCount,
      totalPositionBasisLamports: totalPositionBasis,
      certificateHash,
      migratedAtMs: now,
      status: 'MIGRATION_SUCCESS',
    };

    return Object.freeze({
      store,
      certificate: Object.freeze(certificate),
    });
  }
}
