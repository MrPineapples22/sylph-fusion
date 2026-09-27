import assert from 'node:assert/strict';
import test from 'node:test';
import { ClearingAuthority } from '../../dist/platform/ledger/clearing.js';

test('ClearingAuthority: UNKNOWN Transaction Rule preserves 100% capital reservation (Invariant 1)', () => {
  const clearing = new ClearingAuthority();
  const intentId = 'intent-unknown-timeout';
  const reservedAmount = 1_000_000_000n; // 1.0 SOL

  clearing.reserveCapital(intentId, reservedAmount);
  assert.equal(clearing.getReservedCapital(intentId), reservedAmount);

  // Scenario 1: RPC call timed out, but blockheight has not expired
  const eval1 = clearing.evaluateTransactionStatus({
    intentId,
    signature: 'SigTimedOut11111111111111111111111111111111111111',
    lastValidBlockHeight: 310000150,
    currentBlockHeight: 310000100, // Not expired yet!
    independentCoverages: [
      { providerId: 'rpc-helius', lowestSlot: 310000000, highestSlot: 310000100, transactionFound: false, checkedAtSlot: 310000100 },
    ],
    onChainWalletBalanceConfirmed: true,
  });

  // Capital must NOT be released!
  assert.equal(eval1.status, 'UNKNOWN_RESERVE_HELD');
  assert.equal(eval1.capitalReleased, false);
  assert.equal(clearing.getReservedCapital(intentId), reservedAmount);
  assert.match(eval1.reason, /Capital remains 100% reserved/);
});

test('ClearingAuthority: Provably Expired transaction safely releases capital only after multi-provider proof', () => {
  const clearing = new ClearingAuthority();
  const intentId = 'intent-provably-expired';
  const reservedAmount = 500_000_000n;

  clearing.reserveCapital(intentId, reservedAmount);

  // Scenario: Blockheight is strictly past expiry (+32) AND 2 independent RPCs verify non-inclusion
  const evalExpired = clearing.evaluateTransactionStatus({
    intentId,
    signature: 'SigExpired1111111111111111111111111111111111111111',
    lastValidBlockHeight: 310000150,
    currentBlockHeight: 310000200, // Exceeded lastValidBlockHeight + 32
    independentCoverages: [
      { providerId: 'rpc-triton', lowestSlot: 310000100, highestSlot: 310000200, transactionFound: false, checkedAtSlot: 310000200 },
      { providerId: 'rpc-quicknode', lowestSlot: 310000100, highestSlot: 310000200, transactionFound: false, checkedAtSlot: 310000200 },
    ],
    onChainWalletBalanceConfirmed: true,
  });

  assert.equal(evalExpired.status, 'PROVABLY_EXPIRED');
  assert.equal(evalExpired.capitalReleased, true);
  assert.equal(clearing.getReservedCapital(intentId), 0n);
  assert.match(evalExpired.reason, /Reservation safely released/);
});

test('ClearingAuthority: Finalized clearing commits AssetDeltaSet and releases reservation', () => {
  const clearing = new ClearingAuthority();
  const intentId = 'intent-finalized-buy';
  const reservedAmount = 1_050_000_000n;

  clearing.reserveCapital(intentId, reservedAmount);

  const receipt = clearing.executeFinalizedClearing({
    transactionSignature: '5eUm8K9YiCqAxtyZgmmN1NGhmD3D2C9Azp2Za7nxwhiN',
    economicIntentId: intentId,
    finalizedSlot: 310000120,
    deltas: {
      mint: 'TestMint11111111111111111111111111111111111',
      solDeltaLamports: -1_000_000_000n,
      tokenDeltaRaw: 50_000_000n,
      networkFeeLamports: 5_000n,
      priorityFeeLamports: 200_000n,
      jitoTipLamports: 10_000n,
      rentRefundLamports: 0n,
      token2022WithheldFeeRaw: 0n,
      netCapitalImpactLamports: -1_000_215_000n,
    },
  });

  assert.equal(receipt.isFinalized, true);
  assert.equal(receipt.economicIntentId, intentId);
  assert.equal(clearing.getReservedCapital(intentId), 0n); // Converted from reservation
  assert.ok(clearing.getReceipt(intentId));
});
