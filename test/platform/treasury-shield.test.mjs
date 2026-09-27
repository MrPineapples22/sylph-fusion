import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TreasuryShieldAuthority
} from '../../dist/platform/ledger/treasury-shield.js';

describe('TREASURY-SHIELD: Capital Custody & Blast-Radius Segmentation (Upgrade 6)', () => {
  const mockPolicy = {
    tradingWalletCeilingLamports: 10_000_000_000n, // 10 SOL max in trading wallet
    minEmergencyReserveLamports: 1_000_000_000n,  // 1 SOL reserve
    autoSweepThresholdLamports: 10_000_000_000n,
    approvedTreasuryDestinations: new Set(['ColdStorageMultisig11111111111111111111111111']),
    maxSingleTransferLamports: 5_000_000_000n,     // 5 SOL max per transfer
    maxHourlyTransferVelocityLamports: 10_000_000_000n, // 10 SOL max per hour
    isIncidentLockActive: false
  };

  it('sweeps accumulated realized profits above ceiling into cold treasury', () => {
    const shield = new TreasuryShieldAuthority(mockPolicy, {
      TRADING_CAPITAL: 8_000_000_000n,
      REALIZED_PROFIT_PENDING_SWEEP: 5_000_000_000n, // Total 13 SOL (> 10 SOL ceiling)
      TREASURY_CAPITAL: 20_000_000_000n
    });

    const sweep = shield.sweepRealizedProfits();
    // Swept 3 SOL excess
    assert.equal(sweep.sweptLamports, 3_000_000_000n);
    assert.equal(sweep.newTradingBalance, 10_000_000_000n);
    assert.equal(shield.getBalance('TREASURY_CAPITAL'), 23_000_000_000n);
  });

  it('rejects external transfers to unapproved destinations', () => {
    const shield = new TreasuryShieldAuthority(mockPolicy, {
      TREASURY_CAPITAL: 10_000_000_000n
    });

    const res = shield.authorizeExternalTransfer({
      transferId: 'TX-ATTACK-001',
      destinationAddress: 'AttackerHackerWallet11111111111111111111111',
      amountLamports: 1_000_000_000n,
      sourceDomain: 'TREASURY_CAPITAL',
      requestedAtMs: Date.now(),
      authorizationSignature: 'sig_unauth'
    });

    assert.equal(res.isAuthorized, false);
    assert.ok(res.reason?.includes('UNAPPROVED_DESTINATION'));
  });

  it('incident lock immediately freezes external transfers during safety halts', () => {
    const shield = new TreasuryShieldAuthority(mockPolicy, {
      TREASURY_CAPITAL: 10_000_000_000n
    });

    // Activate incident lock
    shield.setIncidentLock(true);

    const res = shield.authorizeExternalTransfer({
      transferId: 'TX-VALID-DEST-BLOCKED',
      destinationAddress: 'ColdStorageMultisig11111111111111111111111111',
      amountLamports: 1_000_000_000n,
      sourceDomain: 'TREASURY_CAPITAL',
      requestedAtMs: Date.now(),
      authorizationSignature: 'sig_valid'
    });

    assert.equal(res.isAuthorized, false);
    assert.ok(res.reason?.includes('INCIDENT_LOCK_ACTIVE'));
  });
});
