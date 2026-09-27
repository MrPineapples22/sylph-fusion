import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  asLamports,
  asBasisPoints,
  divExact,
  mulBpsExact,
  NumeraireAuthority
} from '../../dist/platform/ledger/numeraire.js';

describe('NUMERAIRE: Exact Economic Arithmetic Authority (Upgrade 3)', () => {
  it('enforces exact rational division across explicit rounding modes', () => {
    // 10 / 3 = 3.3333...
    assert.equal(divExact(10n, 3n, 'FLOOR'), 3n);
    assert.equal(divExact(10n, 3n, 'CEIL'), 4n);

    // Negative division: -10 / 3 = -3.3333...
    assert.equal(divExact(-10n, 3n, 'FLOOR'), -4n);
    assert.equal(divExact(-10n, 3n, 'CEIL'), -3n);

    // Conservative Out (maximize required reserves/fees):
    assert.equal(divExact(1001n, 10n, 'CONSERVATIVE_OUT'), 101n);
    // Conservative In (minimize credited proceeds):
    assert.equal(divExact(1009n, 10n, 'CONSERVATIVE_IN'), 100n);

    // Bankers rounding (round half to even)
    // 2.5 -> 2
    assert.equal(divExact(5n, 2n, 'BANKERS'), 2n);
    // 3.5 -> 4
    assert.equal(divExact(7n, 2n, 'BANKERS'), 4n);
  });

  it('computes exact basis points across extreme and micro balances', () => {
    const microLamports = 100n;
    const bps = asBasisPoints(250n); // 2.5%
    // 100 * 250 / 10000 = 2.5
    assert.equal(mulBpsExact(microLamports, bps, 'FLOOR'), 2n);
    assert.equal(mulBpsExact(microLamports, bps, 'CEIL'), 3n);

    // Extreme balance: 100,000,000 SOL (100M * 10^9 lamports)
    const massive = 100_000_000_000_000_000n;
    const halfBps = asBasisPoints(50n); // 0.5%
    assert.equal(mulBpsExact(massive, halfBps, 'FLOOR'), 500_000_000_000_000n);
  });

  it('verifies financial conservation and flags 1-lamport discrepancies', () => {
    const validState = {
      openingCapital: asLamports(10_000_000_000n), // 10 SOL
      externalDeposits: asLamports(5_000_000_000n), // 5 SOL
      externalWithdrawals: asLamports(1_000_000_000n), // 1 SOL
      realizedEconomicResult: asLamports(200_000_000n), // +0.2 SOL profit
      // Total available net = 10 + 5 - 1 + 0.2 = 14.2 SOL = 14_200_000_000n
      availableBalance: asLamports(4_200_000_000n),
      reservedCapital: asLamports(3_000_000_000n),
      deployedInPositions: asLamports(6_000_000_000n),
      pendingSettlement: asLamports(1_000_000_000n)
      // 4.2 + 3 + 6 + 1 = 14.2 SOL exact!
    };

    const res = NumeraireAuthority.assertConservation(validState);
    assert.equal(res.isConserved, true);
    assert.equal(res.discrepancyLamports, 0n);

    // Tamper with available balance by just 1 lamport
    const leakyState = {
      ...validState,
      availableBalance: asLamports(4_200_000_001n)
    };

    assert.throws(
      () => NumeraireAuthority.assertConservation(leakyState),
      /NUMERAIRE CONSERVATION VIOLATION: Discrepancy of -1 lamports detected!/
    );
  });
});
